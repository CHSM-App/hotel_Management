import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { toWhatsAppDigits } from '../../lib/shareLinks';
import PageLoader from '../../components/PageLoader';
import { Modal } from './HousekeepingParts';
import './forms.css';
import './OrdersPanel.css';
import './Billing.css';
import './Enquiries.css';

const KIND_LABEL = { ROOM: 'Room', EVENT: 'Event', SERVICE: 'Service', GENERAL: 'General' };
const STATUS_LABEL = { NEW: 'New', CONTACTED: 'Contacted', CONVERTED: 'Confirmed', CLOSED: 'Closed' };
// Contacted dropped from the filter row: nothing sets that status any more
// now that the manual "Contacted"/"Converted" buttons are gone for a ROOM/
// EVENT enquiry (see the actions column below) — an enquiry here goes
// New -> Converted/Closed directly. STATUS_LABEL keeps the CONTACTED entry
// so an older enquiry already sitting in that status still prints a real
// word rather than "undefined" on its row.
const FILTERS = ['ALL', 'NEW', 'CONVERTED', 'CLOSED'];

const COLUMNS = [
  { key: 'guest', label: 'Guest' },
  { key: 'phone', label: 'Phone' },
  { key: 'kind', label: 'Type' },
  { key: 'looking', label: 'Looking for' },
  { key: 'received', label: 'Received' },
  { key: 'status', label: 'Status' },
];

function shortDay(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function formatDateTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// The full day, for the detail modal — shortDay above drops the year since a
// register row is read against "today", but a modal naming a single date is
// read on its own and the year is part of answering "when".
function formatDateLong(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// What the guest actually asked for, as one short line. Extras aren't folded
// in here — they ride on their own line under this one (see the "Looking
// for" cell below), the same way a note does, since a room/venue summary and
// a list of ticked extras are different kinds of detail.
function lookingFor(e) {
  const guests = e.guests ? `${e.guests} guest${e.guests === 1 ? '' : 's'}` : '';
  if (e.kind === 'ROOM') {
    const range = e.checkInDate ? `${shortDay(e.checkInDate)} → ${shortDay(e.checkOutDate)}` : '';
    return [range, guests].filter(Boolean).join(' · ') || '—';
  }
  if (e.kind === 'EVENT') {
    return [e.eventType, shortDay(e.eventDate), guests].filter(Boolean).join(' · ') || '—';
  }
  return e.notes ? 'See note' : '—';
}

// The enquiry only ever names catalogue entries as bare ids — roomTypeId,
// venueId, addonIds — never duplicates their names onto the row itself, so
// everything here turns ids back into words a desk can read, against the
// id->name maps built from GET /enquiries/catalogue (see the effect below).
// An id with no match — the catalogue entry was deleted outright, not just
// deactivated, or the catalogue hasn't loaded yet — reads as nothing rather
// than a bare number nobody could interpret.
function addonsFor(e, addonNames) {
  if (!e.addonIds?.length) return null;
  const names = e.addonIds.map((id) => addonNames[id]).filter(Boolean);
  return names.length ? names.join(', ') : null;
}

// Which of the two catalogs an enquiry's addonIds actually mean — a ROOM
// enquiry's extras are ticked off the public page's room-addon picker
// (dbo.switchable_charges, via public.service.js's listPublicRoomAddons), an
// EVENT enquiry's off a separate one (dbo.event_addons). Same field name on
// the row, two unrelated id spaces; this is the one place that decides which
// map to resolve against, so every caller agrees.
function extrasFor(e, roomExtraNames, addonNames) {
  return addonsFor(e, e.kind === 'ROOM' ? roomExtraNames : addonNames);
}

// The actions a row offers, shared between the table row itself and the
// detail modal's footer (see the modal below) — the same set of buttons in
// both places, so acting on an enquiry never requires closing the modal
// first just to reach a button that's only on the row.
function EnquiryActions({ e, busy, onConfirmBooking, onConfirmEventBooking, setStatus, roomExtraNames }) {
  const open = e.status === 'NEW' || e.status === 'CONTACTED';
  return (
    <>
      <a className="history-table__btn" href={`https://wa.me/${toWhatsAppDigits(e.phone)}`} target="_blank" rel="noopener noreferrer">
        WhatsApp
      </a>
      {open && (
        <>
          {/* Opens the new booking/event form pre-filled with this
              enquiry's guest/organiser name, phone and dates — nothing is
              saved here. The enquiry is only marked Converted once the
              desk actually saves that booking, which the server links
              back to this enquiry in the same transaction. A ROOM/EVENT
              enquiry has no other way to be marked Converted any more —
              the old manual button read as a second, disconnected
              "confirmation" beside this one and was dropped in favour of
              it. */}
          {e.kind === 'ROOM' && onConfirmBooking && (
            <button
              type="button"
              className="history-table__btn history-table__btn--primary"
              disabled={busy}
              // The room extras checklist only offers whatever the picked
              // room itself has, and picking a room resets it — so an
              // enquiry's requested extras can't be safely auto-ticked.
              // extrasNote rides along instead, as a plain reminder the
              // booking form shows once it opens (see Bookings.jsx's
              // openFromEnquiry).
              onClick={() => onConfirmBooking({ ...e, extrasNote: addonsFor(e, roomExtraNames) })}
            >
              Confirm booking
            </button>
          )}
          {e.kind === 'EVENT' && onConfirmEventBooking && (
            <button
              type="button"
              className="history-table__btn history-table__btn--primary"
              disabled={busy}
              onClick={() => onConfirmEventBooking(e)}
            >
              Confirm booking
            </button>
          )}
          {/* GENERAL/SERVICE enquiries name no booking to confirm into, so
              this is still their only way to mark one handled-and-
              successful rather than just closed. */}
          {e.kind !== 'ROOM' && e.kind !== 'EVENT' && (
            <button
              type="button"
              className="history-table__btn history-table__btn--primary"
              disabled={busy}
              onClick={() => setStatus(e.id, 'CONVERTED')}
            >
              Confirmed
            </button>
          )}
          <button type="button" className="history-table__btn" disabled={busy} onClick={() => setStatus(e.id, 'CLOSED')}>
            Close
          </button>
        </>
      )}
      {/* A confirmed enquiry is settled by its booking, so it can be closed but
          not reopened; a cancelled booking closes it on its own. */}
      {e.status === 'CONVERTED' && (
        <button type="button" className="history-table__btn" disabled={busy} onClick={() => setStatus(e.id, 'CLOSED')}>
          Close
        </button>
      )}
      {!open && e.status !== 'CONVERTED' && (
        <button type="button" className="history-table__btn" disabled={busy} onClick={() => setStatus(e.id, 'NEW')}>
          Reopen
        </button>
      )}
    </>
  );
}

const SORT_VALUE = {
  guest: (e) => e.name.toLowerCase(),
  phone: (e) => e.phone,
  kind: (e) => e.kind,
  looking: (e) => e.checkInDate || e.eventDate || '',
  received: (e) => new Date(e.createdAt).getTime(),
  status: (e) => e.status,
};

export default function Enquiries({ onChanged, onConfirmBooking, onConfirmEventBooking }) {
  const session = getSession();
  const [filter, setFilter] = useState('NEW');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'received', dir: -1 });
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  // id -> name, for turning an enquiry's roomTypeId/venueId/addonIds back
  // into words a desk can read — see the resolver functions above and
  // GET /enquiries/catalogue (enquiries.service.js's loadCatalogue), which
  // reads these off the lodge's own room-category/venue/add-on tables
  // without needing the write-capable permissions those modules' own list
  // endpoints are gated behind. A nice-to-have, not core to the list
  // loading, so a failure here is swallowed rather than banner-ing the
  // whole screen; an enquiry's details just read as blank until this loads
  // or retries.
  const [roomTypeNames, setRoomTypeNames] = useState({});
  const [venueNames, setVenueNames] = useState({});
  const [addonNames, setAddonNames] = useState({});
  const [roomExtraNames, setRoomExtraNames] = useState({});
  // The enquiry a row's click opened, for the full-detail modal — null
  // closes it.
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await apiGet('/enquiries', { token: session?.token });
      setRows(d.enquiries);
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load enquiries.');
    }
  }, [session?.token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    const byName = (list) => {
      const byId = {};
      for (const item of list || []) byId[item.id] = item.name;
      return byId;
    };
    apiGet('/enquiries/catalogue', { token: session?.token })
      .then((d) => {
        setRoomTypeNames(byName(d.roomTypes));
        setVenueNames(byName(d.venues));
        setAddonNames(byName(d.addons));
        setRoomExtraNames(byName(d.roomExtras));
      })
      .catch(() => {});
  }, [session?.token]);

  const matchesSearch = useCallback(
    (e) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return [e.name, e.phone, e.referenceCode, KIND_LABEL[e.kind]].some((v) => String(v || '').toLowerCase().includes(q));
    },
    [search]
  );

  const counts = useMemo(() => {
    const c = { ALL: 0, NEW: 0, CONTACTED: 0, CONVERTED: 0, CLOSED: 0 };
    (rows || []).filter(matchesSearch).forEach((r) => {
      c.ALL += 1;
      c[r.status] += 1;
    });
    return c;
  }, [rows, matchesSearch]);

  const visible = useMemo(() => {
    const list = (rows || []).filter((r) => (filter === 'ALL' || r.status === filter) && matchesSearch(r));
    const get = SORT_VALUE[sort.key];
    return [...list].sort((a, b) => (get(a) > get(b) ? 1 : get(a) < get(b) ? -1 : 0) * sort.dir);
  }, [rows, filter, matchesSearch, sort]);

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'received' ? -1 : 1 }));

  const setStatus = async (id, status) => {
    setBusyId(id);
    try {
      await apiPatch(`/enquiries/${id}`, { status }, { token: session?.token });
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this enquiry.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      {error && <div className="form-banner form-banner--error">{error}</div>}
      {!rows && !error && <PageLoader inline label="Loading" />}

      {rows && rows.length === 0 && (
        <div className="dash-state">No enquiries yet. When a guest sends one from your public page it appears here.</div>
      )}

      {rows && rows.length > 0 && (
        <div className="billing-panel__bill-search-row billing-panel__bill-search-row--compact">
          <div className="field billing-panel__bill-search">
            <svg className="billing-panel__bill-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              aria-label="Search enquiries"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Guest, phone or reference"
            />
            {search && (
              <button type="button" className="billing-panel__bill-search-clear" onClick={() => setSearch('')} aria-label="Clear search">
                ×
              </button>
            )}
          </div>
          <div className="billing-panel__filters">
            {FILTERS.map((f) => (
              <button key={f} type="button" className="billing-panel__filter" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === 'ALL' ? 'All' : f === 'CONVERTED' ? 'Confirmed' : STATUS_LABEL[f]}
                <span className="billing-panel__filter-count">{counts[f]}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {rows && rows.length > 0 && visible.length === 0 && (
        <div className="dash-state">No enquiries match your search or filter.</div>
      )}

      {visible.length > 0 && (
        <section className="history-sheet billing-sheet">
          <div className="history-table-wrap">
            <table className="history-table billing-sheet__ready enquiries-sheet">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key} aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                      <button type="button" className="billing-sheet__sort" onClick={() => toggleSort(c.key)} title={`Sort by ${c.label}`}>
                        {c.label}
                        <span className="billing-sheet__sort-icon" aria-hidden="true">
                          {sort.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : '⇅'}
                        </span>
                      </button>
                    </th>
                  ))}
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => {
                  const busy = busyId === e.id;
                  return (
                    <tr
                      key={e.id}
                      className="history-table__row enquiries-sheet__row"
                      onClick={() => setSelected(e)}
                      tabIndex={0}
                      role="button"
                      aria-label={`View details for ${e.name}`}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          setSelected(e);
                        }
                      }}
                    >
                      <td className="history-table__strong">
                        {e.name}
                        <div className="enquiries-sheet__ref">{e.referenceCode}</div>
                      </td>
                      <td>{e.phone}</td>
                      <td>
                        <span className="history-table__where">{KIND_LABEL[e.kind] || e.kind}</span>
                      </td>
                      <td title={e.notes || undefined}>
                        {lookingFor(e)}
                        {extrasFor(e, roomExtraNames, addonNames) && (
                          <div className="enquiries-sheet__note">+ {extrasFor(e, roomExtraNames, addonNames)}</div>
                        )}
                        {e.bookedRooms && <div className="enquiries-sheet__note">Room {e.bookedRooms}</div>}
                        {e.notes && <div className="enquiries-sheet__note">“{e.notes}”</div>}
                      </td>
                      <td>{formatDateTime(e.createdAt)}</td>
                      <td>
                        <span className={`enquiries-sheet__status enquiries-sheet__status--${e.status.toLowerCase()}`}>{STATUS_LABEL[e.status]}</span>
                      </td>
                      <td className="history-table__actions" onClick={(ev) => ev.stopPropagation()}>
                        <div className="history-table__actions-inner">
                          <EnquiryActions
                            e={e}
                            busy={busy}
                            onConfirmBooking={onConfirmBooking}
                            onConfirmEventBooking={onConfirmEventBooking}
                            setStatus={setStatus}
                            roomExtraNames={roomExtraNames}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7}>
                    {visible.length} enquir{visible.length === 1 ? 'y' : 'ies'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="billing-sheet__note">Enquiries are kept for 30 days. Mark one Confirmed once the booking is made.</p>
        </section>
      )}

      {/* Everything the row's own cells only have room to summarise — the
          full enquiry a click on its row asked for, with the same actions
          as the row so acting on it doesn't mean closing this first. */}
      {selected && (
        <Modal title={selected.name} sub={selected.referenceCode} onClose={() => setSelected(null)}>
          <dl className="enquiries-sheet__detail">
            <dt>Phone</dt>
            <dd>{selected.phone}</dd>

            <dt>Type</dt>
            <dd>{KIND_LABEL[selected.kind] || selected.kind}</dd>

            <dt>Status</dt>
            <dd>
              <span className={`enquiries-sheet__status enquiries-sheet__status--${selected.status.toLowerCase()}`}>
                {STATUS_LABEL[selected.status]}
              </span>
            </dd>

            {selected.kind === 'ROOM' && (
              <>
                <dt>Check-in</dt>
                <dd>{formatDateLong(selected.checkInDate) || '—'}</dd>
                <dt>Check-out</dt>
                <dd>{formatDateLong(selected.checkOutDate) || '—'}</dd>
                <dt>Room type</dt>
                <dd>{roomTypeNames[selected.roomTypeId] || '—'}</dd>
                {selected.bookedRooms && (
                  <>
                    <dt>Booked room</dt>
                    <dd>{selected.bookedRooms}</dd>
                  </>
                )}
              </>
            )}

            {selected.kind === 'EVENT' && (
              <>
                <dt>Event date</dt>
                <dd>{formatDateLong(selected.eventDate) || '—'}</dd>
                <dt>Event type</dt>
                <dd>{selected.eventType || '—'}</dd>
                <dt>Venue</dt>
                <dd>{venueNames[selected.venueId] || '—'}</dd>
              </>
            )}

            <dt>Guests</dt>
            <dd>{selected.guests || '—'}</dd>

            {extrasFor(selected, roomExtraNames, addonNames) && (
              <>
                <dt>Extras</dt>
                <dd>{extrasFor(selected, roomExtraNames, addonNames)}</dd>
              </>
            )}

            {selected.notes && (
              <>
                <dt>Notes</dt>
                <dd>{selected.notes}</dd>
              </>
            )}

            <dt>Received</dt>
            <dd>{formatDateTime(selected.createdAt)}</dd>

            {selected.handledAt && (
              <>
                <dt>Handled</dt>
                <dd>{formatDateTime(selected.handledAt)}</dd>
              </>
            )}
          </dl>
          <div className="history-table__actions-inner enquiries-sheet__detail-actions">
            <EnquiryActions
              e={selected}
              busy={busyId === selected.id}
              onConfirmBooking={
                onConfirmBooking &&
                ((enquiry) => {
                  setSelected(null);
                  onConfirmBooking(enquiry);
                })
              }
              onConfirmEventBooking={
                onConfirmEventBooking &&
                ((enquiry) => {
                  setSelected(null);
                  onConfirmEventBooking(enquiry);
                })
              }
              setStatus={setStatus}
              roomExtraNames={roomExtraNames}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
