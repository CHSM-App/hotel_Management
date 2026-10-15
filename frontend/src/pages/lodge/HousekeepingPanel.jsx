import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiGet, apiPost, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import PageLoader from '../../components/PageLoader';
import { Modal, Stepper, StatusIcon, ViewSwitch } from './HousekeepingParts';
import HousekeepingIssues from './HousekeepingIssues';
import { ago, ISSUES_CHANGED, readView, saveView } from './housekeepingFormat';
import './forms.css';
import './chartSections.css';
import './MenuPanel.css';
import './RoomsPanel.css';
import './RoomsAndRates.css';
import './HousekeepingPanel.css';

const ROOM_STATUS = {
  DIRTY: { label: 'Needs cleaning', tone: 'dirty' },
  CLEANING: { label: 'Being cleaned', tone: 'cleaning' },
  READY: { label: 'Ready', tone: 'ready' },
  OCCUPIED: { label: 'Occupied', tone: 'occupied' },
  OUT_OF_ORDER: { label: 'Out of order', tone: 'ooo' },
};

const errorText = (err, fallback) => (err instanceof ApiError ? err.message : fallback);

// "Ground" stays "Ground"; a bare number becomes "Floor 2".
const floorLabel = (floor) => {
  const f = String(floor ?? '').trim();
  return !f ? '' : /^\d+$/.test(f) ? `Floor ${f}` : f;
};

// The rooms table's sortable columns, and what each sorts on. Status sorts in
// working order (to clean first), not by its spelling; a room with no guest or
// no logged clean sorts as empty.
const STATUS_RANK = { DIRTY: 0, CLEANING: 1, READY: 2, OCCUPIED: 3, OUT_OF_ORDER: 4 };
const ROOM_COLUMNS = [
  { key: 'room', label: 'Room', value: ({ r }) => String(r.roomNumber) },
  { key: 'type', label: 'Type', wide: true, value: ({ r }) => `${r.categoryName} ${r.floor ?? ''}` },
  { key: 'status', label: 'Status', value: ({ r }) => STATUS_RANK[r.status] ?? 9 },
  { key: 'guest', label: 'Guest', wide: true, value: ({ guest }) => guest },
  { key: 'cleaned', label: 'Last cleaned', wide: true, value: ({ r }) => (r.cleanedAt ? new Date(r.cleanedAt).getTime() : 0) },
  { key: 'notes', label: 'Notes', wide: true, value: ({ detail, issues }) => [detail, issues].filter(Boolean).join(' ') },
];

// "6:00 PM", for when a function starts or ends.
const timeLabel = (value) => new Date(value).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

// A room and a venue can share an id, so anything keyed per row uses both.
const keyOf = (r) => `${r.kind}-${r.id}`;
const isVenue = (r) => r.kind === 'VENUE';
// How a space is named in a sentence: "Room 12", or the venue by its own name.
const spaceName = (r) => (isVenue(r) ? r.roomNumber : `Room ${r.roomNumber}`);

// The Finish form's words, which differ between a room and a hall: a hall has
// no guest to give it to and no bed sheets, and what is left behind is left
// after a function.
const FINISH_WORDS = {
  ROOM: {
    place: 'room',
    problem: 'Problem in the room',
    problemHint: 'e.g. tap leaking, bulb not working, stained sheet',
    block: 'Room cannot be given to guests',
    found: 'Guest left something behind',
    foundHint: 'e.g. phone charger, watch',
  },
  VENUE: {
    place: 'venue',
    problem: 'Problem in the venue',
    problemHint: 'e.g. AC not cooling, broken chair, stained table cloth',
    block: 'Venue cannot be used for functions',
    found: 'Something left behind after the function',
    foundHint: 'e.g. gift box, bag, phone charger',
  },
};
const finishWords = (r) => (isVenue(r) ? FINISH_WORDS.VENUE : FINISH_WORDS.ROOM);

// A calendar day from the server (YYYY-MM-DD) as "08 Oct".
const dayLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

function RoomsTab({ token, hasLaundry, hasEvents, view, toolsHost }) {
  const [rooms, setRooms] = useState(null);
  // Event venues sit on the same board. Empty where the property has no Events.
  const [venues, setVenues] = useState([]);
  const [spaces, setSpaces] = useState('BOTH'); // ROOMS | VENUES | BOTH
  const [linen, setLinen] = useState([]);
  // Opens on the work to do; the rest is one choice away under Show.
  const [filter, setFilter] = useState('TODO');
  const [error, setError] = useState('');
  const [finish, setFinish] = useState(null); // { room, counts: {itemId: n}, issues, lostFound }
  const [ooo, setOoo] = useState(null); // { room, note }
  const [busy, setBusy] = useState(false);
  const [menuId, setMenuId] = useState(null); // the room whose "⋯" menu is open
  // Which table column is sorted, and which way. None to begin with: the list
  // arrives in working order, rooms to clean first. A heading goes ascending,
  // then descending, then back to that order.
  const [sort, setSort] = useState({ key: null, dir: 1 });
  const toggleSort = (key) =>
    setSort((cur) => (cur.key !== key ? { key, dir: 1 } : cur.dir === 1 ? { key, dir: -1 } : { key: null, dir: 1 }));
  // "Waiting 2 h" needs a clock, and reading the time while rendering is not
  // allowed, so it ticks in state instead.
  const [now, setNow] = useState(() => Date.now());

  const load = () =>
    Promise.all([
      apiGet('/housekeeping/rooms', { token }),
      // A venue list that fails must not take the rooms down with it.
      hasEvents ? apiGet('/housekeeping/venues', { token }).catch(() => ({ venues: [] })) : Promise.resolve({ venues: [] }),
    ])
      .then(([r, v]) => {
        setRooms(r.rooms);
        setVenues(v.venues);
        setError('');
      })
      .catch((err) => setError(errorText(err, 'Could not load the board.')));

  useEffect(() => {
    load();
    // Linen is counted only where the Laundry section is on.
    if (hasLaundry) {
      apiGet('/housekeeping/linen', { token })
        .then((d) => setLinen(d.items.filter((i) => i.isActive)))
        .catch(() => {});
    }
    // Kept fresh without a refresh button: a checkout at the desk shows up here.
    const timer = setInterval(() => {
      load();
      setNow(Date.now());
    }, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (room, action, body = {}) => {
    setBusy(true);
    try {
      await apiPost(`/housekeeping/${isVenue(room) ? 'venues' : 'rooms'}/${room.id}/${action}`, body, { token });
      await load();
      return true;
    } catch (err) {
      setError(errorText(err, isVenue(room) ? 'Could not update the venue.' : 'Could not update the room.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitFinish = async () => {
    const linenLines = Object.entries(finish.counts)
      .filter(([, n]) => n > 0)
      .map(([linenItemId, quantity]) => ({ linenItemId: Number(linenItemId), quantity }));
    const issues = finish.issues.trim();
    const reported = Boolean(issues || finish.lostFound.trim());
    if (await act(finish.room, 'done', { linen: linenLines, issues, lostFound: finish.lostFound.trim(), blockRoom: Boolean(issues) && finish.blockRoom })) {
      setFinish(null);
      // The desk's count and alert should not wait for their next poll.
      if (reported) window.dispatchEvent(new Event(ISSUES_CHANGED));
    }
  };

  const finishPieces = Object.values(finish?.counts ?? {}).reduce((n, v) => n + v, 0);

  // Rooms and venues as one list in working order: what needs cleaning first,
  // and within that whatever someone is arriving into today.
  const hasVenues = venues.length > 0;
  const hasRooms = (rooms ?? []).length > 0;
  const pool = [...(spaces === 'VENUES' ? [] : (rooms ?? [])), ...(spaces === 'ROOMS' ? [] : venues)].sort(
    (a, b) =>
      (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
      Number(b.arrivingToday) - Number(a.arrivingToday) ||
      Number(isVenue(a)) - Number(isVenue(b)) ||
      String(a.roomNumber).localeCompare(String(b.roomNumber), undefined, { numeric: true })
  );
  const counts = { DIRTY: 0, CLEANING: 0, READY: 0, OCCUPIED: 0, OUT_OF_ORDER: 0 };
  pool.forEach((r) => (counts[r.status] += 1));
  const total = pool.length;
  const shown = pool.filter((r) =>
    filter === 'ALL' ? true : filter === 'TODO' ? r.status === 'DIRTY' || r.status === 'CLEANING' : r.status === filter
  );

  // One row of tabs: the working view first, then everything else.
  // What the "Show" menu offers, each with how many rooms it would leave.
  const filters = [
    { key: 'TODO', label: 'To clean', n: counts.DIRTY + counts.CLEANING },
    { key: 'READY', label: 'Ready', n: counts.READY },
    { key: 'OCCUPIED', label: hasVenues ? 'Occupied / in use' : 'Occupied', n: counts.OCCUPIED },
    { key: 'OUT_OF_ORDER', label: 'Under repair', n: counts.OUT_OF_ORDER },
    { key: 'ALL', label: 'All', n: total },
  ];

  // Worked out once per room, so the cards and the table show the same thing.
  const rows = shown.map((r) => {
    const detail =
      r.status === 'DIRTY'
        ? r.dirtySince
          ? `Waiting ${ago(r.dirtySince, now)}`
          : 'Marked for cleaning'
        : r.status === 'CLEANING'
          ? `${r.cleaningStartedAt ? `${ago(r.cleaningStartedAt, now)}` : 'In progress'}${r.cleaningBy ? ` · ${r.cleaningBy}` : ''}`
          : r.status === 'OUT_OF_ORDER'
            ? r.outOfOrderNote || ''
            : '';
    const menu = [
      r.status === 'CLEANING' && { label: 'Stop without finishing', run: () => act(r, 'release') },
      r.status === 'READY' && { label: 'Needs cleaning', run: () => act(r, 'dirty') },
      r.status === 'OCCUPIED' && { label: isVenue(r) ? 'Service this venue' : 'Service this room', run: () => act(r, 'start') },
      (r.status === 'DIRTY' || r.status === 'READY') && { label: 'Close for repair', run: () => setOoo({ room: r, note: '' }) },
    ].filter(Boolean);
    // Who is in the room, and when it comes free: what a cleaner plans the day by.
    // For a venue the "guest" is the function in it, and it "leaves" when that ends.
    const guest = isVenue(r) ? r.eventTitle || '' : r.guestName ? `${r.guestName}${r.guestsIn > 1 ? ` +${r.guestsIn - 1} more` : ''}` : '';
    const leaves = isVenue(r)
      ? r.eventTitle && r.eventEndsAt
        ? `Ends ${timeLabel(r.eventEndsAt)}`
        : ''
      : r.guestName && r.guestCheckOut
        ? r.leavingToday
          ? 'Leaves today'
          : `Leaves ${dayLabel(r.guestCheckOut)}`
        : '';
    // What is coming today: a guest into a room, a function into a venue.
    const arrivingLabel = isVenue(r) ? `Function today${r.nextEventAt ? ` ${timeLabel(r.nextEventAt)}` : ''}` : 'Guest arriving today';
    // Only a clean somebody actually logged; a room never cleaned says nothing.
    const cleaned = r.cleanedAt ? `${ago(r.cleanedAt, now)} ago${r.cleanedBy ? ` · ${r.cleanedBy}` : ''}` : '';
    const issues = r.openIssues > 0 ? `${r.openIssues} open ${r.openIssues === 1 ? 'issue' : 'issues'}` : '';
    return {
      r,
      // A venue with a function in it is "In use"; "Occupied" is a room's word.
      s: isVenue(r) && r.status === 'OCCUPIED' ? { ...ROOM_STATUS.OCCUPIED, label: 'In use' } : ROOM_STATUS[r.status],
      detail,
      menu,
      arriving: r.arrivingToday && r.status !== 'OCCUPIED',
      arrivingLabel,
      guest,
      leaves,
      cleaned,
      issues,
    };
  });
  // The table is what has headings to click, so only it is re-sorted.
  const sortColumn = view === 'table' ? ROOM_COLUMNS.find((c) => c.key === sort.key) : null;
  const tableRows = sortColumn
    ? [...rows].sort((a, b) => {
        const x = sortColumn.value(a);
        const y = sortColumn.value(b);
        const order = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
        return order * sort.dir;
      })
    : rows;

  // The one button a room needs, and the "⋯" menu for the rest.
  const actionsFor = ({ r, menu }) => (
    <>
      {r.status === 'DIRTY' && (
        <button type="button" className="hk-action" disabled={busy} onClick={() => act(r, 'start')}>
          Start cleaning
        </button>
      )}
      {r.status === 'CLEANING' && (
        <button
          type="button"
          className="hk-action"
          disabled={busy}
          onClick={() => setFinish({ room: r, counts: {}, issues: '', lostFound: '', blockRoom: false })}
        >
          Finish
        </button>
      )}
      {r.status === 'OUT_OF_ORDER' && (
        <button type="button" className="btn-secondary hk-btn" disabled={busy} onClick={() => act(r, 'out-of-order', { outOfOrder: false })}>
          Back in service
        </button>
      )}
      {menu.length > 0 && (
        <span className="hk-menu">
          <button
            type="button"
            className="hk-more"
            aria-label={`More actions for ${spaceName(r)}`}
            aria-expanded={menuId === keyOf(r)}
            onClick={() => setMenuId(menuId === keyOf(r) ? null : keyOf(r))}
          >
            ⋯
          </button>
          {menuId === keyOf(r) && (
            <>
              <button type="button" className="hk-menu__backdrop" aria-label="Close menu" onClick={() => setMenuId(null)} />
              <span className="hk-menu__list" role="menu">
                {menu.map((m) => (
                  <button
                    key={m.label}
                    type="button"
                    role="menuitem"
                    disabled={busy}
                    onClick={() => {
                      setMenuId(null);
                      m.run();
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </span>
            </>
          )}
        </span>
      )}
    </>
  );

  return (
    <div className="chart-section hk-board">
      {/* The status filter sits on the section's tab strip, beside the cards /
          table switch, rather than as a second row of tabs under it. */}
      {rooms &&
        toolsHost &&
        createPortal(
          <>
            {/* Only where there is a choice to make: a property with rooms and venues. */}
            {hasVenues && hasRooms && (
              <label className="hk-show">
                <select value={spaces} onChange={(e) => setSpaces(e.target.value)} aria-label="Show rooms, venues or both">
                  <option value="BOTH">Rooms and venues</option>
                  <option value="ROOMS">Rooms only</option>
                  <option value="VENUES">Venues only</option>
                </select>
              </label>
            )}
            <label className="hk-show">
              <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Show by status">
                {filters.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label} ({f.n})
                  </option>
                ))}
              </select>
            </label>
          </>,
          toolsHost
        )}

      {error && <div className="form-banner form-banner--error">{error}</div>}
      {!rooms && !error && <PageLoader inline label="Loading rooms" />}
      {rooms && shown.length === 0 && (
        <div className="hk-empty">
          <span className="hk-empty__icon">
            <StatusIcon tone="ready" size={22} />
          </span>
          <p className="hk-empty__title">{filter === 'TODO' ? (hasVenues ? 'Everything is clean' : 'Every room is clean') : 'Nothing in this view'}</p>
          <p className="hk-empty__text">
            {filter === 'TODO'
              ? hasVenues
                ? 'Check-outs and finished functions appear here on their own.'
                : 'New check-outs appear here on their own.'
              : filter === 'ALL'
                ? 'Add rooms under Rooms & rates, or venues under Event setup, to see them here.'
                : 'Choose another option from the menu above to see the rest.'}
          </p>
        </div>
      )}

      {view === 'cards' && (
        <div className="hk-list">
          {rows.map((row) => {
            const { r, s, detail, arriving, arrivingLabel, guest, leaves, cleaned, issues } = row;
            // One quiet line of whatever applies: the guest and when they go, or
            // when the room was last cleaned.
            const extra = guest ? [guest, r.leavingToday ? '' : leaves].filter(Boolean).join(' · ') : r.status === 'READY' && cleaned ? `Cleaned ${cleaned}` : '';
            return (
              <article className={`hk-card hk-card--${s.tone}`} key={keyOf(r)}>
                {/* A room is known by its number, so that is the tile. A venue's
                    name is too long for one: the tile says what it is and the
                    name leads the line beside it. */}
                {isVenue(r) ? (
                  <span className="hk-card__room hk-card__room--venue">Venue</span>
                ) : (
                  <span className="hk-card__room">{r.roomNumber}</span>
                )}
                <div className="hk-card__body">
                  <div className="hk-card__line">
                    <span className="hk-card__cat">{isVenue(r) ? r.roomNumber : r.categoryName}</span>
                    {isVenue(r) && r.categoryName !== 'Venue' && <span className="hk-card__floor">{r.categoryName.replace('Venue · ', '')}</span>}
                    {floorLabel(r.floor) && <span className="hk-card__floor">{floorLabel(r.floor)}</span>}
                    {arriving && <span className="hk-arrival">{arrivingLabel}</span>}
                    {guest && r.leavingToday && <span className="hk-arrival">Leaves today</span>}
                    {issues && <span className="hk-arrival hk-arrival--ooo">{issues}</span>}
                  </div>
                  <div className="hk-card__state">
                    <span className={`hk-status hk-status--${s.tone}`}>{s.label}</span>
                    {detail && <span className="hk-card__detail">{detail}</span>}
                  </div>
                  {extra && <div className="hk-card__detail hk-card__extra">{extra}</div>}
                </div>
                <div className="hk-card__side">{actionsFor(row)}</div>
              </article>
            );
          })}
        </div>
      )}

      {view === 'table' && rows.length > 0 && (
        <table className="hk-rooms">
          <thead>
            <tr>
              {ROOM_COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={column.wide ? 'hk-rooms__wide' : undefined}
                  aria-sort={sort.key === column.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
                >
                  <button type="button" className="hk-sort" onClick={() => toggleSort(column.key)} title={`Sort by ${column.label}`}>
                    {hasVenues && column.key === 'room' ? 'Room / venue' : hasVenues && column.key === 'guest' ? 'Guest / function' : column.label}
                    <span className="hk-sort__icon" aria-hidden="true">
                      {sort.key === column.key ? (sort.dir === 1 ? '▲' : '▼') : '⇅'}
                    </span>
                  </button>
                </th>
              ))}
              <th scope="col" className="hk-rooms__actions">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row) => {
              const { r, s, detail, arriving, arrivingLabel, guest, leaves, cleaned, issues } = row;
              // On a phone the wide columns go, so what matters most sits under the status.
              const sub = [detail, guest, leaves, arriving && arrivingLabel, issues].filter(Boolean).join(' · ');
              const none = <span className="hk-rooms__none">—</span>;
              return (
                <tr key={keyOf(r)}>
                  <th scope="row" className="hk-rooms__room">
                    {r.roomNumber}
                  </th>
                  <td className="hk-rooms__wide">
                    {r.categoryName}
                    {floorLabel(r.floor) && <span className="hk-rooms__under">{floorLabel(r.floor)}</span>}
                  </td>
                  <td>
                    <span className={`hk-status hk-status--${s.tone}`}>{s.label}</span>
                    {sub && <span className="hk-rooms__sub">{sub}</span>}
                  </td>
                  <td className="hk-rooms__wide">
                    {guest ? (
                      <>
                        <span className="hk-rooms__guest">{guest}</span>
                        {r.leavingToday ? (
                          <span className="hk-arrival hk-rooms__tag">Leaves today</span>
                        ) : (
                          leaves && <span className="hk-rooms__under">{leaves}</span>
                        )}
                      </>
                    ) : arriving ? (
                      <span className="hk-arrival">{arrivingLabel}</span>
                    ) : (
                      none
                    )}
                  </td>
                  <td className="hk-rooms__wide">{cleaned || none}</td>
                  <td className="hk-rooms__wide">
                    {detail || issues ? (
                      <span className="hk-rooms__detail">
                        {detail && <span>{detail}</span>}
                        {issues && <span className="hk-arrival hk-arrival--ooo">{issues}</span>}
                      </span>
                    ) : (
                      none
                    )}
                  </td>
                  <td className="hk-rooms__actions">
                    <div className="hk-card__side">{actionsFor(row)}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {finish && (
        <Modal
          title={`Finish cleaning · ${spaceName(finish.room)}`}
          sub={
            hasLaundry
              ? `Count the linen you replaced, then mark the ${finishWords(finish.room).place} clean.`
              : `Note anything wrong, then mark the ${finishWords(finish.room).place} clean.`
          }
          busy={busy}
          onClose={() => setFinish(null)}
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setFinish(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="btn-accent" onClick={submitFinish} disabled={busy}>
                {busy ? 'Saving…' : `Mark ${finishWords(finish.room).place} clean`}
              </button>
            </>
          }
        >
          {hasLaundry && (
            <section className="hk-finish__section">
              <div className="hk-finish__head">
                <h4 className="hk-finish__title">Linen changed</h4>
                <span className={`hk-finish__meta${finishPieces > 0 ? ' hk-finish__meta--on' : ''}`}>
                  {finishPieces > 0 ? `${finishPieces} ${finishPieces === 1 ? 'piece' : 'pieces'}` : 'Tap + for each piece'}
                </span>
              </div>
              {linen.length === 0 ? (
                <p className="hk-hint hk-hint--inline">Add linen items under Laundry → Hotel Laundry to count what you change here.</p>
              ) : (
                <div className="hk-finish__list">
                  {linen.map((i) => (
                    <div className="hk-row" key={i.id}>
                      <span className={finish.counts[i.id] > 0 ? 'hk-finish__name--on' : undefined}>{i.name}</span>
                      <Stepper
                        label={i.name}
                        value={finish.counts[i.id] ?? 0}
                        // Can't change in more than is clean and in the store
                        // right now — the server enforces the same ceiling.
                        max={i.clean}
                        onChange={(n) => setFinish({ ...finish, counts: { ...finish.counts, [i.id]: n } })}
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="hk-finish__section">
            <div className="hk-finish__head">
              <h4 className="hk-finish__title">Anything to report?</h4>
              <span className="hk-finish__meta">Optional · reception is told</span>
            </div>
            <div className="field">
              <label htmlFor="hkIssues">{finishWords(finish.room).problem}</label>
              <input
                id="hkIssues"
                placeholder={finishWords(finish.room).problemHint}
                value={finish.issues}
                onChange={(e) => setFinish({ ...finish, issues: e.target.value })}
              />
              {/* Only once there is a problem to hold the room for. */}
              {finish.issues.trim() && (
                <label className="hk-check">
                  <input type="checkbox" checked={finish.blockRoom} onChange={(e) => setFinish({ ...finish, blockRoom: e.target.checked })} />
                  <span>
                    {finishWords(finish.room).block}
                    <small>It stays under repair until the problem is marked fixed.</small>
                  </span>
                </label>
              )}
            </div>
            <div className="field">
              <label htmlFor="hkLost">{finishWords(finish.room).found}</label>
              <input
                id="hkLost"
                placeholder={finishWords(finish.room).foundHint}
                value={finish.lostFound}
                onChange={(e) => setFinish({ ...finish, lostFound: e.target.value })}
              />
            </div>
          </section>
        </Modal>
      )}

      {ooo && (
        <Modal
          title={`${spaceName(ooo.room)} · close for repair`}
          sub="It stays off the cleaning list until it is back in service."
          busy={busy}
          onClose={() => setOoo(null)}
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setOoo(null)} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-accent"
                disabled={busy}
                onClick={async () => (await act(ooo.room, 'out-of-order', { outOfOrder: true, note: ooo.note })) && setOoo(null)}
              >
                Close for repair
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="hkOoo">What is wrong?</label>
            <input id="hkOoo" value={ooo.note} onChange={(e) => setOoo({ ...ooo, note: e.target.value })} autoFocus />
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

// The room cleaning board, and the problems and found items cleaners report
// from it. Linen and guest laundry live in LaundryPanel; all this keeps of them
// is the count of linen changed, where Laundry is on.
export default function HousekeepingPanel({ lodge, issueCount = 0 }) {
  const token = getSession()?.token;
  const [tab, setTab] = useState('rooms');
  // Where the Rooms tab puts its "Show" menu: on this strip, the way the
  // Kitchen queue hands its controls to the strip above it.
  const [toolsHost, setToolsHost] = useState(null);
  // Cards or table, one choice for both tabs, so the switch lives on the strip
  // above them — where the Kitchen queue keeps its own.
  const [view, setView] = useState(readView);
  const chooseView = (next) => {
    setView(next);
    saveView(next);
  };

  return (
    <div>
      <div className="subtabs">
        <button type="button" className="subtabs__item" aria-current={tab === 'rooms' ? 'page' : undefined} onClick={() => setTab('rooms')}>
          {/* Named for what the property has: venues are on this board too. */}
          {lodge?.hasEvents ? (lodge?.hasRooms === false ? 'Venues' : 'Rooms & Venues') : 'Rooms'}
        </button>
        <button type="button" className="subtabs__item" aria-current={tab === 'issues' ? 'page' : undefined} onClick={() => setTab('issues')}>
          Issues
          {issueCount > 0 && <span className="hk-count">{issueCount}</span>}
        </button>
        <div className="subtabs__tools">
          <span className="hk-tools-host" ref={setToolsHost} />
          <ViewSwitch view={view} onChange={chooseView} label="Show as" />
        </div>
      </div>
      {tab === 'rooms' && (
        <RoomsTab token={token} hasLaundry={Boolean(lodge?.hasLaundry)} hasEvents={Boolean(lodge?.hasEvents)} view={view} toolsHost={toolsHost} />
      )}
      {tab === 'issues' && <HousekeepingIssues token={token} view={view} toolsHost={toolsHost} hasEvents={Boolean(lodge?.hasEvents)} hasRooms={lodge?.hasRooms !== false} />}
    </div>
  );
}
