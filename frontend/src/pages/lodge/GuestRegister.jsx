import { useEffect, useRef, useState } from 'react';
import { apiGet, apiGetBlob, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { readCache, writeCache } from '../../lib/dataCache';
import { formatPrice } from './priceFormat';
import BillDocument from './BillDocument';
import '../internal/LodgesDashboard.css';
import './forms.css';
import './GuestRegister.css';

const STATUS_LABEL = { BOOKED: 'Booked', CHECKED_IN: 'Checked in', CHECKED_OUT: 'Checked out', CANCELLED: 'Cancelled' };
const VEHICLE_TYPE_LABEL = {
  TWO_WHEELER: 'Two wheeler',
  FOUR_WHEELER: 'Four wheeler',
  TRAVELLER: 'Traveller',
  BUS: 'Bus',
};

// A cancelled stay reads as a problem, not as another finished one — the
// register is scanned for exceptions as often as it's read row by row.
const STATUS_BADGE = {
  BOOKED: 'badge--accent',
  CHECKED_IN: 'badge--on',
  CHECKED_OUT: 'badge--off',
  CANCELLED: 'badge--inactive',
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function startOfMonthIso() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function addDaysIso(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The ranges a desk actually asks for. Typing two dates to see today's arrivals
// is three interactions for a question asked twenty times a day.
const RANGE_PRESETS = [
  { key: 'today', label: 'Today', range: () => [todayIso(), todayIso()] },
  { key: 'week', label: 'Last 7 days', range: () => [addDaysIso(todayIso(), -6), todayIso()] },
  { key: 'month', label: 'This month', range: () => [startOfMonthIso(), todayIso()] },
  {
    key: 'prev',
    label: 'Last month',
    range: () => {
      const d = new Date();
      const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
      return [first.toISOString().slice(0, 10), last.toISOString().slice(0, 10)];
    },
  },
];

const STATUS_FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'CHECKED_IN', label: 'In house' },
  { key: 'BOOKED', label: 'Booked' },
  { key: 'CHECKED_OUT', label: 'Checked out' },
  { key: 'CANCELLED', label: 'Cancelled' },
];

function nightsBetween(fromStr, toStr) {
  const ms = new Date(`${toStr}T00:00:00Z`) - new Date(`${fromStr}T00:00:00Z`);
  return Math.max(1, Math.round(ms / 86400000));
}

function formatDateShort(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// Split into its two lines so a register column can carry the day in the
// reading line and the clock time under it, instead of one long string that
// forces the column wide enough for both.
function splitStamp(value) {
  if (!value) return null;
  const d = new Date(value);
  return {
    date: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    time: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
  };
}

function formatDateLong(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// Actual check-in/out timestamps — null until that event has actually
// happened (a BOOKED reservation has neither yet).
function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Just the night's date — the year is already on the stay's date range above,
// and repeating it on every line of a five-night tariff is noise.
function formatNightDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// Reads after its label ("Left late by — 2h 15m"), so no "late" in the value.
function formatLateBy(minutes) {
  if (!minutes) return null;
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins === 0 ? `${hours} hours` : `${hours}h ${mins}m`;
}

export default function GuestRegister() {
  const session = getSession();
  const token = session?.token;

  const [fromDate, setFromDate] = useState(startOfMonthIso());
  const [toDate, setToDate] = useState(todayIso());
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  // Seeded from what this session already fetched for the range the page opens
  // on, so coming back paints the register immediately instead of showing a
  // loading state while a request crosses to the database. Changing the range
  // keeps the existing behaviour: the previous rows stay until the new ones
  // land, which is what the screen already did.
  const [bookings, setBookings] = useState(() =>
    readCache(`/bookings?fromDate=${startOfMonthIso()}&toDate=${todayIso()}`)
  );
  const [error, setError] = useState('');

  // Bumped to ask for the same range again — a failed fetch retried from the
  // message that reported it, or the desk pulling the range fresh after a
  // check-in without having to change the dates to force a reload.
  const [reloadToken, setReloadToken] = useState(0);
  const [loadedKey, setLoadedKey] = useState('');

  const validRange = fromDate && toDate && toDate >= fromDate;
  const rangeKey = `${fromDate}|${toDate}|${reloadToken}`;
  // What's on screen isn't what was asked for yet.
  const loading = validRange && loadedKey !== rangeKey;

  const load = () => {
    setError('');
    setReloadToken((t) => t + 1);
  };

  useEffect(() => {
    if (!validRange) return undefined;
    let active = true;
    apiGet(`/bookings?fromDate=${fromDate}&toDate=${toDate}`, { token })
      .then((data) => {
        if (!active) return;
        setBookings(writeCache(`/bookings?fromDate=${fromDate}&toDate=${toDate}`, data.bookings));
        setError('');
        setLoadedKey(rangeKey);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof ApiError ? err.message : 'Could not load the guest register.');
        setLoadedKey(rangeKey);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  const query = search.trim().toLowerCase();
  // Searched first, filtered by status second — so the status chips can carry
  // how many rows each one holds within what's been searched for.
  const searched = bookings?.filter((b) => {
    if (!query) return true;
    return (
      b.guestName.toLowerCase().includes(query) ||
      b.roomNumber.toLowerCase().includes(query) ||
      (b.invoiceNumber || '').toLowerCase().includes(query) ||
      (b.guestPhone || '').includes(query)
    );
  });

  const filtered = searched?.filter((b) => statusFilter === 'ALL' || b.status === statusFilter);

  const statusCounts = (searched || []).reduce((acc, b) => {
    acc[b.status] = (acc[b.status] || 0) + 1;
    return acc;
  }, {});

  // Read off the rows on screen, so the strip always answers for the range and
  // filter the register is currently showing rather than for the whole month.
  // Billed and pending are kept apart: an issued invoice is money the property
  // has actually raised, while an unbilled stay is only what the room comes to
  // so far. Adding the two together would overstate the takings for the range.
  const stats = (filtered || []).reduce(
    (acc, b) => {
      if (b.status === 'CANCELLED') return { ...acc, cancelled: acc.cancelled + 1 };
      const billed = Boolean(b.invoiceNumber);
      return {
        ...acc,
        stays: acc.stays + 1,
        people: acc.people + (b.numGuests || 0),
        inHouse: acc.inHouse + (b.status === 'CHECKED_IN' ? 1 : 0),
        amount: acc.amount + (billed ? b.billAmount || 0 : 0),
        billedCount: acc.billedCount + (billed ? 1 : 0),
        pending: acc.pending + (billed ? 0 : b.billAmount || 0),
        pendingCount: acc.pendingCount + (billed ? 0 : 1),
      };
    },
    { stays: 0, people: 0, inHouse: 0, amount: 0, billedCount: 0, pending: 0, pendingCount: 0, cancelled: 0 }
  );

  const activePreset = RANGE_PRESETS.find((p) => {
    const [f, t] = p.range();
    return f === fromDate && t === toDate;
  });

  const applyPreset = (preset) => {
    const [f, t] = preset.range();
    setFromDate(f);
    setToDate(t);
  };

  const filtersActive = Boolean(query) || statusFilter !== 'ALL';

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('ALL');
  };

  // Detail modal — fetches the full booking record on demand rather than
  // carrying every field (other guests, extras, ID proof) on every register
  // row, most of which a staffer never opens.
  const [detailBookingId, setDetailBookingId] = useState(null);
  const [detailBooking, setDetailBooking] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [idProofError, setIdProofError] = useState('');

  // The ID document opens inside the record rather than in a browser tab. A
  // reception desk is comparing the scan against the person standing there and
  // then going straight back to the stay — a second tab means the register is
  // left behind and has to be found again.
  const [idProofDoc, setIdProofDoc] = useState(null);
  const [zoomed, setZoomed] = useState(false);
  const docUrlRef = useRef(null);
  // Counts the fetches, so a scan that lands after the desk has already backed
  // out (or moved on to another guest's ID) is dropped instead of reopening
  // the viewer over whatever is on screen now.
  const docRequestRef = useRef(0);

  // Object URLs hold the file in memory until they're revoked, and a busy desk
  // opens a lot of ID scans in one session.
  const releaseDocUrl = () => {
    if (docUrlRef.current) {
      URL.revokeObjectURL(docUrlRef.current);
      docUrlRef.current = null;
    }
  };

  useEffect(() => releaseDocUrl, []);

  const closeIdProof = () => {
    docRequestRef.current += 1;
    releaseDocUrl();
    setIdProofDoc(null);
    setZoomed(false);
  };

  // The stay and the bill are two documents about one guest, and each is long
  // enough to deserve the panel to itself rather than being scrolled past to
  // reach the other.
  const [detailTab, setDetailTab] = useState('stay');

  const openDetail = (bookingId) => {
    setDetailBookingId(bookingId);
    setDetailBooking(null);
    setDetailError('');
    setIdProofError('');
    setDetailTab('stay');
  };

  const closeDetail = () => {
    closeIdProof();
    setDetailBookingId(null);
  };

  useEffect(() => {
    if (!detailBookingId) return;
    apiGet(`/bookings/${detailBookingId}`, { token })
      .then((data) => setDetailBooking(data.booking))
      .catch((err) => setDetailError(err instanceof ApiError ? err.message : 'Could not load this stay.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailBookingId]);

  // Escape steps back one screen — out of an open document first, then out of
  // the record — rather than dropping the whole thing at once.
  useEffect(() => {
    if (!detailBookingId) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      if (idProofDoc) closeIdProof();
      else closeDetail();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailBookingId, idProofDoc]);

  const openIdProof = async (path, title) => {
    setIdProofError('');
    releaseDocUrl();
    setZoomed(false);
    setIdProofDoc({ title, loading: true });
    docRequestRef.current += 1;
    const requestId = docRequestRef.current;
    try {
      const blob = await apiGetBlob(path, { token });
      const url = URL.createObjectURL(blob);
      if (docRequestRef.current !== requestId) {
        URL.revokeObjectURL(url);
        return;
      }
      docUrlRef.current = url;
      const isPdf = blob.type === 'application/pdf';
      setIdProofDoc({
        title,
        url,
        isPdf,
        // Named for the guest it belongs to, so a downloaded copy isn't one
        // more "download.jpg" in the folder.
        filename: `${title.replace(/[\\/:*?"<>|]/g, '-')}.${isPdf ? 'pdf' : (blob.type.split('/')[1] || 'jpg')}`,
      });
    } catch (err) {
      if (docRequestRef.current !== requestId) return;
      setIdProofDoc(null);
      setIdProofError(err instanceof ApiError ? err.message : 'Could not open the ID proof.');
    }
  };

  const handleViewIdProof = () =>
    openIdProof(
      `/bookings/${detailBookingId}/id-proof`,
      `${detailBooking?.idProofType || 'ID proof'} · ${detailBooking?.guestName || ''}`.trim()
    );

  const handleViewGuestIdProof = (guest) =>
    openIdProof(
      `/bookings/${detailBookingId}/guests/${guest.id}/id-proof`,
      `${guest.idProofType || 'ID proof'} · ${guest.name}`
    );

  const detailRow = detailBookingId ? bookings?.find((b) => b.id === detailBookingId) : null;
  // The register row carries the guest's name, room and status already, so the
  // record's head can render the moment it opens; the fetched booking takes
  // over once it lands.
  const head = detailBooking || detailRow;
  const invoice = detailBooking?.invoice || null;
  const showBill = detailTab === 'bill' && invoice;
  const nights = detailBooking?.nights || [];
  const lateBy = formatLateBy(detailBooking?.lateCheckoutMinutes);

  return (
    <div className="guest-register">
      {/* One control bar: the range on the left, what's being looked for on the
          right, and the status cut underneath — the three things a register is
          narrowed by, in the order they're reached for. */}
      <div className="dash-card guest-register__toolbar">
        <div className="guest-register__toolbar-top">
          <div className="guest-register__range">
            <div className="field guest-register__range-field">
              <label htmlFor="fromDate">From</label>
              <input id="fromDate" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <span className="guest-register__range-dash" aria-hidden="true">
              –
            </span>
            <div className="field guest-register__range-field">
              <label htmlFor="toDate">To</label>
              <input id="toDate" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
          </div>

          <div className="field guest-register__search">
            <label htmlFor="search">Find a guest</label>
            <div className="guest-register__search-box">
              <svg
                className="guest-register__search-icon"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                id="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Type a name, room number, phone or bill number"
              />
              {search && (
                <button
                  type="button"
                  className="guest-register__search-clear"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="guest-register__toolbar-bottom">
          <div className="guest-register__presets">
            {RANGE_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className="guest-register__preset"
                aria-pressed={activePreset?.key === p.key}
                onClick={() => applyPreset(p)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="guest-register__status-filters" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map((s) => {
              const count = s.key === 'ALL' ? searched?.length : statusCounts[s.key];
              return (
                <button
                  key={s.key}
                  type="button"
                  className="guest-register__status-chip"
                  aria-pressed={statusFilter === s.key}
                  onClick={() => setStatusFilter(s.key)}
                >
                  {s.label}
                  {bookings && <span className="guest-register__status-count">{count || 0}</span>}
                </button>
              );
            })}
          </div>

          {/* One way back to the full list, so a desk that has narrowed the
              register three times over never has to undo each one. */}
          {filtersActive && (
            <button type="button" className="guest-register__clear-filters" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>

        {!validRange && (
          <p className="guest-register__hint guest-register__hint--warn">
            The “To” date is before the “From” date — pick a later day, or use one of the shortcuts above.
          </p>
        )}
      </div>

      {/* What the range came to, before the rows are read one by one. */}
      {!error && bookings && (
        <div className="guest-register__stats">
          <div className="guest-register__stat">
            <span className="guest-register__stat-label">Stays</span>
            <strong className="guest-register__stat-value">{stats.stays}</strong>
            {stats.cancelled > 0 && (
              <span className="guest-register__stat-note">{stats.cancelled} cancelled</span>
            )}
          </div>
          <div className="guest-register__stat">
            <span className="guest-register__stat-label">Guests</span>
            <strong className="guest-register__stat-value">{stats.people}</strong>
            <span className="guest-register__stat-note">people booked in</span>
          </div>
          <div className="guest-register__stat">
            <span className="guest-register__stat-label">In house</span>
            <strong className="guest-register__stat-value">{stats.inHouse}</strong>
            <span className="guest-register__stat-note">not checked out yet</span>
          </div>
          <div className="guest-register__stat guest-register__stat--money">
            <span className="guest-register__stat-label">Billed</span>
            <strong className="guest-register__stat-value">{formatPrice(stats.amount)}</strong>
            <span className="guest-register__stat-note">
              {stats.billedCount} {stats.billedCount === 1 ? 'bill' : 'bills'} issued
            </span>
          </div>

          {/* Only when there is something left to bill — an empty pending tile
              is a column of zero the desk has to read past every time. */}
          {stats.pending > 0 && (
            <div className="guest-register__stat guest-register__stat--pending">
              <span className="guest-register__stat-label">Pending</span>
              <strong className="guest-register__stat-value">{formatPrice(stats.pending)}</strong>
              <span className="guest-register__stat-note">
                {stats.pendingCount} {stats.pendingCount === 1 ? 'stay' : 'stays'} not billed yet
              </span>
            </div>
          )}
        </div>
      )}

      {/* Something went wrong is only half the message — the other half is the
          button that tries it again, so nobody has to reload the dashboard. */}
      {error && (
        <div className="dash-card">
          <div className="dash-state guest-register__empty">
            <p className="guest-register__empty-title">The register didn&apos;t load</p>
            <p>{error}</p>
            <div className="guest-register__empty-actions">
              <button type="button" className="btn-secondary" onClick={load} disabled={loading}>
                {loading ? 'Trying again…' : 'Try again'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rows in outline while they load, so the page keeps its shape instead
          of collapsing to one line and jumping when the register arrives. */}
      {!error && validRange && !bookings && (
        <div className="dash-card">
          <div className="guest-register__skeleton" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <div className="guest-register__skeleton-row" key={i}>
                <span className="guest-register__skeleton-bar guest-register__skeleton-bar--wide" />
                <span className="guest-register__skeleton-bar" />
                <span className="guest-register__skeleton-bar guest-register__skeleton-bar--short" />
              </div>
            ))}
          </div>
          <p className="guest-register__loading-note">Loading the register…</p>
        </div>
      )}

      {/* Every empty state ends in the thing to do next, not just the news that
          there's nothing here. */}
      {!error && bookings && filtered.length === 0 && (
        <div className="dash-card">
          <div className="dash-state guest-register__empty">
            <span className="guest-register__empty-icon" aria-hidden="true">
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 4h13l3 3v13H4z" />
                <path d="M8 10h8M8 14h5" />
              </svg>
            </span>
            <p className="guest-register__empty-title">
              {query
                ? `No guest matching “${search.trim()}”`
                : statusFilter !== 'ALL'
                  ? 'No stays with this status'
                  : 'No guests in these dates'}
            </p>
            <p>
              {filtersActive
                ? 'Try a different spelling, or widen the dates.'
                : 'Nothing was recorded between these dates. Pick a wider range to look further back.'}
            </p>
            <div className="guest-register__empty-actions">
              {query && (
                <button type="button" className="btn-secondary" onClick={() => setSearch('')}>
                  Clear search
                </button>
              )}
              {statusFilter !== 'ALL' && (
                <button type="button" className="btn-secondary" onClick={() => setStatusFilter('ALL')}>
                  Show all statuses
                </button>
              )}
              {activePreset?.key !== 'month' && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => applyPreset(RANGE_PRESETS.find((p) => p.key === 'month'))}
                >
                  Look at this month
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {!error && bookings && filtered.length > 0 && (
        <div className="dash-card">
          <div className="guest-register__card-head">
            <div>
              <h3 className="guest-register__card-title">Register</h3>
              <p className="guest-register__card-sub">
                {formatDateLong(fromDate)} to {formatDateLong(toDate)}
              </p>
            </div>
            <div className="guest-register__card-tools">
              <span className="guest-register__card-count">
                {filtered.length === bookings.length
                  ? `${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'}`
                  : `${filtered.length} of ${bookings.length} entries`}
              </span>
              {/* Check-ins happen while this screen is open. */}
              <button
                type="button"
                className="guest-register__refresh"
                onClick={load}
                disabled={loading}
                title="Reload this range"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                  <path d="M21 3v6h-6" />
                </svg>
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </div>

          {/* The head stays put while the rows scroll — a register is read a
              long way down, and a column of bare timestamps is unreadable once
              its heading has scrolled off. */}
          <div className="dash-table-scroll guest-register__table-scroll">
            <table className="dash-table guest-register__table">
              <thead>
                <tr>
                  <th>Bill No</th>
                  <th>Guest</th>
                  <th>Room</th>
                  <th>Came in</th>
                  <th>Left</th>
                  <th className="guest-register__col-amount">Amount</th>
                  <th>Status</th>
                  <th className="dash-table__actions"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => {
                  const cameIn = splitStamp(b.actualCheckInAt);
                  const left = splitStamp(b.actualCheckOutAt);
                  const nights = nightsBetween(b.checkInDate, b.checkOutDate);
                  return (
                    <tr
                      key={b.id}
                      className={`guest-register__row${
                        b.status === 'CHECKED_IN' ? ' guest-register__row--in-house' : ''
                      }`}
                    >
                      <td>
                        {b.invoiceNumber ? (
                          <span className="guest-register__bill-no">{b.invoiceNumber}</span>
                        ) : (
                          <span className="guest-register__muted">Not billed</span>
                        )}
                      </td>
                      <td>
                        <div className="guest-register__cell-main">
                          {b.guestName}
                          {/* The register's other half: whether a scan was
                              actually taken, not just which document was named. */}
                          {b.hasIdProofDocument && (
                            <span className="guest-register__id-tag" title={`${b.idProofType || 'ID'} on file`}>
                              ID
                            </span>
                          )}
                        </div>
                        <div className="guest-register__cell-sub">
                          {/* Ringing the guest is the commonest reason an old
                              row is looked up, so the number dials from the
                              register itself without opening the record. */}
                          {b.guestPhone ? (
                            <a className="guest-register__row-phone" href={`tel:${b.guestPhone}`}>
                              {b.guestPhone}
                            </a>
                          ) : (
                            'No phone'
                          )}
                          {b.numGuests > 1 ? ` · ${b.numGuests} people` : ''}
                        </div>
                      </td>
                      <td>
                        <div className="guest-register__cell-main">{b.roomNumber}</div>
                        <div className="guest-register__cell-sub">{b.categoryName}</div>
                      </td>
                      <td>
                        {cameIn ? (
                          <>
                            <div className="guest-register__cell-main">{cameIn.date}</div>
                            <div className="guest-register__cell-sub">{cameIn.time}</div>
                          </>
                        ) : (
                          <>
                            <div className="guest-register__cell-main guest-register__muted">Not arrived</div>
                            <div className="guest-register__cell-sub">Due {formatDateShort(b.checkInDate)}</div>
                          </>
                        )}
                      </td>
                      <td>
                        {left ? (
                          <>
                            <div className="guest-register__cell-main">{left.date}</div>
                            <div className="guest-register__cell-sub">{left.time}</div>
                          </>
                        ) : (
                          <>
                            <div className="guest-register__cell-main guest-register__muted">
                              {b.actualCheckInAt ? 'Still staying' : '—'}
                            </div>
                            <div className="guest-register__cell-sub">
                              Due {formatDateShort(b.checkOutDate)} · {nights}{' '}
                              {nights === 1 ? 'night' : 'nights'}
                            </div>
                          </>
                        )}
                      </td>
                      <td className="guest-register__col-amount">
                        <span className="guest-register__amount">{formatPrice(b.billAmount)}</span>
                      </td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[b.status] || 'badge--off'}`}>
                          {STATUS_LABEL[b.status]}
                        </span>
                      </td>
                      <td className="dash-table__actions">
                        <button
                          type="button"
                          className="guest-register__view-details-btn"
                          onClick={() => openDetail(b.id)}
                        >
                          View details
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detailBookingId && (
        <div className="glass-backdrop guest-register__backdrop" onClick={closeDetail} role="presentation">
          <div
            className="glass-panel guest-register__modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="guestRecordTitle"
          >
            {idProofDoc ? (
              <>
                <header className="guest-register__record-head">
                  <button
                    type="button"
                    className="guest-register__record-back"
                    onClick={closeIdProof}
                    aria-label="Back to guest record"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="m15 18-6-6 6-6" />
                    </svg>
                  </button>
                  <div className="guest-register__record-identity">
                    <h3 id="guestRecordTitle">{idProofDoc.title}</h3>
                    <p className="guest-register__record-sub">ID proof on file</p>
                  </div>
                  <button
                    type="button"
                    className="guest-register__record-close"
                    onClick={closeDetail}
                    aria-label="Close guest record"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </header>

                <div className="guest-register__doc-body">
                  {idProofDoc.loading && <div className="dash-state">Opening document…</div>}

                  {/* A PDF gets the browser's own viewer; a scan is shown as an
                      image that toggles between fitting the panel and full
                      size, because the print on an ID card is small. */}
                  {!idProofDoc.loading && idProofDoc.isPdf && (
                    <iframe
                      className="guest-register__doc-frame"
                      src={idProofDoc.url}
                      title={idProofDoc.title}
                    />
                  )}

                  {!idProofDoc.loading && !idProofDoc.isPdf && (
                    <button
                      type="button"
                      className={`guest-register__doc-image${zoomed ? ' guest-register__doc-image--zoomed' : ''}`}
                      onClick={() => setZoomed((z) => !z)}
                      aria-label={zoomed ? 'Fit document to panel' : 'Zoom document to full size'}
                    >
                      <img src={idProofDoc.url} alt={idProofDoc.title} />
                    </button>
                  )}
                </div>

                <footer className="guest-register__record-foot guest-register__record-foot--doc">
                  {!idProofDoc.loading && !idProofDoc.isPdf && (
                    <span className="guest-register__doc-hint">
                      {zoomed ? 'Click the scan to fit it back' : 'Click the scan to zoom'}
                    </span>
                  )}
                  {idProofDoc.url && (
                    <a className="btn-secondary" href={idProofDoc.url} download={idProofDoc.filename}>
                      Download
                    </a>
                  )}
                  <button type="button" className="btn-secondary" onClick={closeIdProof}>
                    Back to record
                  </button>
                </footer>
              </>
            ) : (
              <>
            {/* The head is built from the register row, which is already in
                hand, so the record opens with the guest's name on it instead
                of an empty panel while the full stay is fetched. */}
            <header className="guest-register__record-head">
              <span className="guest-register__record-avatar" aria-hidden="true">
                {(head?.guestName || '?').charAt(0).toUpperCase()}
              </span>
              <div className="guest-register__record-identity">
                <h3 id="guestRecordTitle">{head?.guestName || 'Guest record'}</h3>
                {head && (
                  <p className="guest-register__record-sub">
                    Room {head.roomNumber} · {head.categoryName}
                    {detailRow?.invoiceNumber ? ` · Bill ${detailRow.invoiceNumber}` : ''}
                  </p>
                )}
              </div>
              {head && (
                <span className={`badge ${STATUS_BADGE[head.status] || 'badge--off'}`}>
                  {STATUS_LABEL[head.status]}
                </span>
              )}
              <button
                type="button"
                className="guest-register__record-close"
                onClick={closeDetail}
                aria-label="Close guest record"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </header>

            {/* Only once there's a bill to switch to — an in-house guest has
                one document, and a strip of one tab is furniture. */}
            {invoice && (
              <div className="guest-register__tabs" role="tablist" aria-label="Record sections">
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailTab === 'stay'}
                  className="guest-register__tab"
                  onClick={() => setDetailTab('stay')}
                >
                  Stay details
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailTab === 'bill'}
                  className="guest-register__tab"
                  onClick={() => setDetailTab('bill')}
                >
                  Bill
                </button>
              </div>
            )}

            <div className="guest-register__record-body">
              {detailError && <div className="form-banner form-banner--error">{detailError}</div>}

              {!detailError && !detailBooking && <div className="dash-state">Loading…</div>}

              {/* The issued document itself, rendered by the same component the
                  bills screen and the printout use — the register must not
                  become a second opinion on what a guest was charged. */}
              {!detailError && detailBooking && showBill && (
                <div className="guest-register__bill">
                  <div className="bill-print-target">
                    <BillDocument invoice={invoice} />
                  </div>
                </div>
              )}

              {!detailError && detailBooking && !showBill && (
                <>
                  {/* The three questions asked of a register entry before any
                      other: is the guest in, when did they leave, what did the
                      stay come to. */}
                  {/* Blanks are spelled out. "—" makes a reader stop and work
                      out whether the guest hasn't arrived or the system didn't
                      record it; the words say which. */}
                  <div className="guest-register__summary">
                    <div className="guest-register__summary-tile">
                      <span className="guest-register__summary-label">Came in</span>
                      <strong>
                        {detailBooking.actualCheckInAt
                          ? formatDateTime(detailBooking.actualCheckInAt)
                          : 'Not arrived yet'}
                      </strong>
                    </div>
                    <div className="guest-register__summary-tile">
                      <span className="guest-register__summary-label">Left</span>
                      <strong>
                        {detailBooking.actualCheckOutAt
                          ? formatDateTime(detailBooking.actualCheckOutAt)
                          : detailBooking.actualCheckInAt
                            ? 'Still staying'
                            : 'Not arrived yet'}
                      </strong>
                    </div>
                    <div className="guest-register__summary-tile guest-register__summary-tile--money">
                      <span className="guest-register__summary-label">
                        {invoice ? 'Total bill' : 'Room charge'}
                      </span>
                      <strong>{formatPrice(invoice ? invoice.totalAmount : detailBooking.totalPrice)}</strong>
                    </div>
                  </div>

                  <section className="guest-register__section">
                    <h4 className="guest-register__section-title">The stay</h4>
                    <dl className="guest-register__facts">
                      <dt>Dates</dt>
                      <dd>
                        {formatDateLong(detailBooking.checkInDate)} to{' '}
                        {formatDateLong(detailBooking.checkOutDate)}
                        <span className="guest-register__muted">
                          {' '}
                          ({nights.length} {nights.length === 1 ? 'night' : 'nights'})
                        </span>
                      </dd>
                      <dt>Room</dt>
                      <dd>
                        {detailBooking.roomNumber} · {detailBooking.categoryName}
                      </dd>
                      {lateBy && (
                        <>
                          <dt>Left late by</dt>
                          <dd>
                            {lateBy}
                            {/* "agreed", not "charged" — this is what reception
                                settled on at the door. Whether it reached the
                                guest's bill is the billing desk's call, and
                                only the invoice records that. */}
                            <span className="guest-register__muted">
                              {' · '}
                              {detailBooking.lateCheckoutCharge > 0
                                ? `${formatPrice(detailBooking.lateCheckoutCharge)} agreed at checkout`
                                : 'no charge taken'}
                            </span>
                          </dd>
                        </>
                      )}
                      {detailBooking.switchableCharges.length > 0 && (
                        <>
                          <dt>Extras</dt>
                          <dd>
                            <div className="guest-register__chips">
                              {detailBooking.switchableCharges.map((c) => (
                                <span className="guest-register__chip" key={c.name}>
                                  {c.quantity > 1 ? `${c.name} ×${c.quantity}` : c.name}
                                </span>
                              ))}
                            </div>
                          </dd>
                        </>
                      )}
                      {detailBooking.vehicles.length > 0 && (
                        <>
                          <dt>Vehicles</dt>
                          <dd>
                            <div className="guest-register__chips">
                              {detailBooking.vehicles.map((v) => (
                                <span
                                  className="guest-register__chip guest-register__chip--plate"
                                  key={v.number}
                                >
                                  {v.number}
                                  {/* Plates recorded before the type was asked
                                      for have none — show the number alone. */}
                                  {v.type ? ` · ${VEHICLE_TYPE_LABEL[v.type]}` : ''}
                                </span>
                              ))}
                            </div>
                          </dd>
                        </>
                      )}
                    </dl>
                  </section>

                  <section className="guest-register__section">
                    <h4 className="guest-register__section-title">Who stayed</h4>
                    <dl className="guest-register__facts">
                      <dt>Booked by</dt>
                      <dd>{detailBooking.guestName}</dd>
                      <dt>Phone</dt>
                      <dd>
                        {/* A tap dials it. Reception's most common reason for
                            opening an old record is to ring the guest about
                            something left behind. */}
                        {detailBooking.guestPhone ? (
                          <a className="guest-register__phone" href={`tel:${detailBooking.guestPhone}`}>
                            {detailBooking.guestPhone}
                          </a>
                        ) : (
                          <span className="guest-register__muted">Not recorded</span>
                        )}
                      </dd>
                      <dt>People staying</dt>
                      <dd>{detailBooking.numGuests}</dd>
                      {detailBooking.idProofType && (
                        <>
                          <dt>ID given</dt>
                          <dd className="guest-register__id-cell">
                            <span>{detailBooking.idProofType}</span>
                            {detailBooking.hasIdProofDocument && (
                              <button type="button" className="guest-register__view-btn" onClick={handleViewIdProof}>
                                View ID
                              </button>
                            )}
                          </dd>
                        </>
                      )}
                    </dl>

                    {detailBooking.guests.length > 0 && (
                      <>
                        <div className="guest-register__subhead">
                          Others in the room ({detailBooking.guests.length})
                        </div>
                        <ul className="guest-register__guest-list">
                          {detailBooking.guests.map((g) => (
                            <li key={g.id} className="guest-register__guest">
                              <span className="guest-register__guest-initial" aria-hidden="true">
                                {(g.name || '?').charAt(0).toUpperCase()}
                              </span>
                              <div className="guest-register__guest-body">
                                <strong>{g.name}</strong>
                                <span className="guest-register__guest-meta">
                                  {[g.phone, g.idProofType].filter(Boolean).join(' · ') || 'No ID taken'}
                                </span>
                              </div>
                              {g.hasIdProofDocument && (
                                <button
                                  type="button"
                                  className="guest-register__view-btn"
                                  onClick={() => handleViewGuestIdProof(g)}
                                >
                                  View ID
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}

                    {idProofError && (
                      <div className="form-banner form-banner--error guest-register__id-error">{idProofError}</div>
                    )}
                  </section>

                  <section className="guest-register__section">
                    <h4 className="guest-register__section-title">Room rate, night by night</h4>
                    {/* Night by night, from the rates frozen when the booking
                        was taken. A stay that crosses a season isn't one rate
                        repeated, and this is where a guest asking why gets an
                        answer instead of an assurance. */}
                    <div className="guest-register__tariff">
                      {nights.map((n) => (
                        <div className="guest-register__tariff-row" key={n.date}>
                          <span>{formatNightDate(n.date)}</span>
                          <span>{formatPrice(n.amount)}</span>
                        </div>
                      ))}
                      {detailBooking.switchableCharges.length > 0 && (
                        <p className="guest-register__tariff-note">
                          Every night above already includes{' '}
                          {/* chargePerNight prices one of the thing, so a guest
                              on three extra beds is owed the multiplied figure
                              — it's what the nights above actually contain. */}
                          {detailBooking.switchableCharges
                            .map((c) =>
                              c.quantity > 1
                                ? `${c.name} ×${c.quantity} ${formatPrice(c.chargePerNight * c.quantity)}`
                                : `${c.name} ${formatPrice(c.chargePerNight)}`
                            )
                            .join(', ')}
                          .
                        </p>
                      )}
                      <div className="guest-register__tariff-row guest-register__tariff-row--total">
                        <span>Room charge for {nights.length === 1 ? 'the night' : 'all nights'}</span>
                        <span>{formatPrice(detailBooking.totalPrice)}</span>
                      </div>
                      {detailBooking.lateCheckoutCharge > 0 && (
                        <div className="guest-register__tariff-row">
                          <span>Agreed for leaving late</span>
                          <span>{formatPrice(detailBooking.lateCheckoutCharge)}</span>
                        </div>
                      )}
                      {detailBooking.advanceAmount != null && (
                        <div className="guest-register__tariff-row">
                          <span>
                            Advance already paid
                            <span className="guest-register__muted">
                              {' · '}
                              {detailBooking.advancePaymentMethod}
                            </span>
                          </span>
                          <span>− {formatPrice(detailBooking.advanceAmount)}</span>
                        </div>
                      )}
                    </div>

                    {/* Room charge is what the stay was priced at; the bill is
                        what the guest actually owed, tax and food included.
                        Pointing at the bill beats restating half of it here. */}
                    {invoice ? (
                      <button
                        type="button"
                        className="guest-register__bill-link"
                        onClick={() => setDetailTab('bill')}
                      >
                        <span>
                          Guest was billed <strong>{formatPrice(invoice.totalAmount)}</strong> in all
                          {invoice.foodSubtotal > 0 ? ' — room, food and tax' : ' — room and tax'}
                          <span className="guest-register__muted"> · Bill {invoice.invoiceNumber}</span>
                        </span>
                        <span className="guest-register__bill-link-go">View Bill</span>
                      </button>
                    ) : (
                      <p className="guest-register__tariff-note">
                        This stay hasn&apos;t been billed yet.
                      </p>
                    )}
                  </section>
                </>
              )}
            </div>

            <footer className="guest-register__record-foot">
              {showBill && (
                <button type="button" className="btn-secondary" onClick={() => window.print()}>
                  Print bill
                </button>
              )}
              <button type="button" className="btn-secondary" onClick={closeDetail}>
                Close
              </button>
            </footer>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
