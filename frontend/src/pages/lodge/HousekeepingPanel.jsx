import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPatch, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { formatPrice } from './priceFormat';
import { triggerDownload } from './bookingReportFile';
import PageLoader from '../../components/PageLoader';
import Req from '../../components/RequiredMark';
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

// "12 min", "2 h 5 min", "3 days" — how long something has been going on.
function ago(timestamp, now) {
  const minutes = Math.max(0, Math.floor((now - new Date(timestamp).getTime()) / 60000));
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

// One small glyph per state, so a room reads at a glance without relying on
// colour alone.
const ICON_PATHS = {
  ready: ['M20 6 9 17l-5-5'],
  occupied: ['M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7', 'M3 14h18', 'M3 18v2', 'M21 18v2', 'M7 11h3'],
  dirty: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', 'M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z'],
  cleaning: ['M21 12a9 9 0 1 1-3-6.7', 'M21 4v5h-5'],
  ooo: ['M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z'],
};

function StatusIcon({ tone, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {(ICON_PATHS[tone] ?? ICON_PATHS.ready).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

// + / − counter: counts are tapped, never typed, so a phone in a wet hand works.
function Stepper({ value, onChange, label, max = Infinity }) {
  return (
    <span className="hk-stepper" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(0, value - 1))} aria-label={`Less ${label}`}>
        −
      </button>
      <span className="hk-stepper__value">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`More ${label}`}>
        +
      </button>
    </span>
  );
}

function Modal({ title, sub, onClose, busy, children, footer }) {
  return (
    <div className="glass-backdrop menu-panel__backdrop" onClick={() => !busy && onClose()}>
      <div className="glass-panel menu-panel__modal modal-form__panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-form">
          <div className="modal-form__head">
            <div className="modal-form__head-row">
              <h3>{title}</h3>
              <button type="button" className="modal-form__close" onClick={onClose} aria-label="Close">
                ×
              </button>
            </div>
            {sub && <p className="modal-form__sub">{sub}</p>}
          </div>
          <div className="modal-form__body">{children}</div>
          <div className="modal-form__foot">
            <div className="modal-form__foot-actions">{footer}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

function RoomsTab({ token }) {
  const [rooms, setRooms] = useState(null);
  const [linen, setLinen] = useState([]);
  const [filter, setFilter] = useState('TODO');
  const [error, setError] = useState('');
  const [finish, setFinish] = useState(null); // { room, counts: {itemId: n}, issues, lostFound }
  const [ooo, setOoo] = useState(null); // { room, note }
  const [busy, setBusy] = useState(false);
  const [menuId, setMenuId] = useState(null); // the room whose "⋯" menu is open
  // "Waiting 2 h" needs a clock, and reading the time while rendering is not
  // allowed, so it ticks in state instead.
  const [now, setNow] = useState(() => Date.now());

  const load = () =>
    apiGet('/housekeeping/rooms', { token })
      .then((d) => {
        setRooms(d.rooms);
        setError('');
      })
      .catch((err) => setError(errorText(err, 'Could not load rooms.')));

  useEffect(() => {
    load();
    apiGet('/housekeeping/linen', { token })
      .then((d) => setLinen(d.items.filter((i) => i.isActive)))
      .catch(() => {});
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
      await apiPost(`/housekeeping/rooms/${room.id}/${action}`, body, { token });
      await load();
      return true;
    } catch (err) {
      setError(errorText(err, 'Could not update the room.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitFinish = async () => {
    const linenLines = Object.entries(finish.counts)
      .filter(([, n]) => n > 0)
      .map(([linenItemId, quantity]) => ({ linenItemId: Number(linenItemId), quantity }));
    if (await act(finish.room, 'done', { linen: linenLines, issues: finish.issues, lostFound: finish.lostFound })) {
      setFinish(null);
    }
  };

  const counts = { DIRTY: 0, CLEANING: 0, READY: 0, OCCUPIED: 0, OUT_OF_ORDER: 0 };
  (rooms ?? []).forEach((r) => (counts[r.status] += 1));
  const total = (rooms ?? []).length;
  const shown = (rooms ?? []).filter((r) =>
    filter === 'ALL' ? true : filter === 'TODO' ? r.status === 'DIRTY' || r.status === 'CLEANING' : r.status === filter
  );

  // One row of tabs: the working view first, then everything else.
  const tabs = [
    { key: 'TODO', label: 'To clean', n: counts.DIRTY + counts.CLEANING, tone: 'dirty' },
    { key: 'READY', label: 'Ready', n: counts.READY, tone: 'ready' },
    { key: 'OCCUPIED', label: 'Occupied', n: counts.OCCUPIED, tone: 'occupied' },
    { key: 'OUT_OF_ORDER', label: 'Out of order', n: counts.OUT_OF_ORDER, tone: 'ooo' },
    { key: 'ALL', label: 'All', n: total, tone: 'all' },
  ];
  const bar = [
    { tone: 'ready', n: counts.READY },
    { tone: 'cleaning', n: counts.CLEANING },
    { tone: 'dirty', n: counts.DIRTY },
    { tone: 'occupied', n: counts.OCCUPIED },
    { tone: 'ooo', n: counts.OUT_OF_ORDER },
  ];

  return (
    <div className="chart-section hk-board">
      {rooms && (
        <div className="hk-head">
          <div className="hk-head__top">
            <h3 className="hk-head__title">
              {counts.READY} of {total} rooms ready
            </h3>
            <div
              className="hk-bar"
              role="img"
              aria-label={`${counts.READY} ready, ${counts.DIRTY + counts.CLEANING} to clean, ${counts.OCCUPIED} occupied, ${counts.OUT_OF_ORDER} out of order`}
            >
              {bar.filter((b) => b.n > 0).map((b) => (
                <span key={b.tone} className={`hk-bar__seg hk-bar__seg--${b.tone}`} style={{ flexGrow: b.n }} />
              ))}
            </div>
          </div>
          <div className="hk-tabs" role="tablist" aria-label="Show rooms">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={filter === t.key}
                className={`hk-tab hk-tab--${t.tone}${t.n === 0 ? ' hk-tab--zero' : ''}`}
                onClick={() => setFilter(t.key)}
              >
                {t.label}
                <span className="hk-tab__n">{t.n}</span>
              </button>
            ))}
          </div>
          {filter === 'TODO' && counts.DIRTY + counts.CLEANING > 0 && (
            <p className="hk-help">Tap <strong>Start cleaning</strong> when you begin a room, then <strong>Finish</strong> when it is done.</p>
          )}
        </div>
      )}

      {error && <div className="form-banner form-banner--error">{error}</div>}
      {!rooms && !error && <PageLoader inline label="Loading rooms" />}
      {rooms && shown.length === 0 && (
        <div className="hk-empty">
          <span className="hk-empty__icon">
            <StatusIcon tone="ready" size={22} />
          </span>
          <p className="hk-empty__title">{filter === 'TODO' ? 'Every room is clean' : 'No rooms in this view'}</p>
          <p className="hk-empty__text">
            {filter === 'TODO'
              ? 'New check-outs appear here on their own.'
              : 'Pick another tab above to see the rest.'}
          </p>
        </div>
      )}

      <div className="hk-list">
        {shown.map((r) => {
          const s = ROOM_STATUS[r.status];
          const detail =
            r.status === 'DIRTY'
              ? r.dirtySince
                ? `Waiting ${ago(r.dirtySince, now)}`
                : 'Marked for cleaning'
              : r.status === 'CLEANING'
                ? `${r.cleaningStartedAt ? `${ago(r.cleaningStartedAt, now)}` : 'In progress'}${r.cleaningBy ? ` · ${r.cleaningBy}` : ''}`
                : r.status === 'OUT_OF_ORDER'
                  ? r.outOfOrderNote || ''
                  : r.status === 'OCCUPIED'
                    ? 'Guest staying'
                    : 'Ready for guests';
          const menu = [
            r.status === 'CLEANING' && { label: 'Stop without finishing', run: () => act(r, 'release') },
            r.status === 'READY' && { label: 'Needs cleaning', run: () => act(r, 'dirty') },
            r.status === 'OCCUPIED' && { label: 'Service this room', run: () => act(r, 'start') },
            (r.status === 'DIRTY' || r.status === 'READY') && { label: 'Mark out of order', run: () => setOoo({ room: r, note: '' }) },
          ].filter(Boolean);
          return (
            <article className={`hk-card hk-card--${s.tone}`} key={r.id}>
              <span className={`hk-card__icon hk-card__icon--${s.tone}`}>
                <StatusIcon tone={s.tone} />
              </span>
              <div className="hk-card__body">
                <div className="hk-card__line">
                  <span className="hk-card__room">{r.roomNumber}</span>
                  <span className="hk-card__cat">{r.categoryName}</span>
                  {r.arrivingToday && r.status !== 'OCCUPIED' && <span className="hk-arrival">Guest arriving today</span>}
                </div>
                <div className="hk-card__state">
                  <span className={`hk-status hk-status--${s.tone}`}>{s.label}</span>
                  {detail && <span className="hk-card__detail">{detail}</span>}
                </div>
              </div>
              <div className="hk-card__side">
                {r.status === 'DIRTY' && (
                  <button type="button" className="btn-accent hk-btn" disabled={busy} onClick={() => act(r, 'start')}>
                    Start cleaning
                  </button>
                )}
                {r.status === 'CLEANING' && (
                  <button
                    type="button"
                    className="btn-accent hk-btn"
                    disabled={busy}
                    onClick={() => setFinish({ room: r, counts: {}, issues: '', lostFound: '' })}
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
                      aria-label={`More actions for room ${r.roomNumber}`}
                      aria-expanded={menuId === r.id}
                      onClick={() => setMenuId(menuId === r.id ? null : r.id)}
                    >
                      ⋯
                    </button>
                    {menuId === r.id && (
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
              </div>
            </article>
          );
        })}
      </div>

      {finish && (
        <Modal
          title={`Room ${finish.room.roomNumber} — done`}
          sub="Tap the linen you changed. Anything found, note it."
          busy={busy}
          onClose={() => setFinish(null)}
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setFinish(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="btn-accent" onClick={submitFinish} disabled={busy}>
                {busy ? 'Saving…' : 'Room is clean'}
              </button>
            </>
          }
        >
          {linen.length === 0 ? (
            <p className="hk-hint">Add linen types under Hotel laundry to count what you change in each room.</p>
          ) : (
            linen.map((i) => (
              <div className="hk-row" key={i.id}>
                <span>{i.name}</span>
                <Stepper
                  label={i.name}
                  value={finish.counts[i.id] ?? 0}
                  onChange={(n) => setFinish({ ...finish, counts: { ...finish.counts, [i.id]: n } })}
                />
              </div>
            ))
          )}
          <div className="field">
            <label htmlFor="hkIssues">Problems (broken, stained, missing)</label>
            <input id="hkIssues" value={finish.issues} onChange={(e) => setFinish({ ...finish, issues: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="hkLost">Lost &amp; found</label>
            <input id="hkLost" value={finish.lostFound} onChange={(e) => setFinish({ ...finish, lostFound: e.target.value })} />
          </div>
        </Modal>
      )}

      {ooo && (
        <Modal
          title={`Room ${ooo.room.roomNumber} — out of order`}
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
                Mark out of order
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
// Hotel laundry
// ---------------------------------------------------------------------------

const MOVE_LABEL = {
  CHANGED: 'Changed in a room',
  SENT: 'Sent to laundry',
  RECEIVED: 'Received back',
  LOST: 'Marked lost',
  DAMAGED: 'Marked damaged',
};
const MOVE_TONE = { CHANGED: 'dirty', SENT: 'cleaning', RECEIVED: 'ready', LOST: 'ooo', DAMAGED: 'ooo' };
const MOVE_FILTERS = [
  { key: 'ALL', label: 'All', kinds: null },
  { key: 'SENT', label: 'Sent', kinds: ['SENT'] },
  { key: 'RECEIVED', label: 'Received', kinds: ['RECEIVED'] },
  { key: 'ROOMS', label: 'Rooms', kinds: ['CHANGED'] },
  { key: 'LOSS', label: 'Lost or damaged', kinds: ['LOST', 'DAMAGED'] },
];

// The ledger has one row per item, so sending three kinds of linen is three rows.
// People think of that as one event, so rows that are the same action by the same
// person within a minute are shown together: "Sent to laundry: Bedsheet ×10, Towel ×6".
// Newest first, as the server sends them.
function groupMovements(movements) {
  const groups = [];
  for (const m of movements) {
    const time = new Date(m.createdAt).getTime();
    const last = groups[groups.length - 1];
    if (
      last &&
      last.kind === m.kind &&
      last.roomNumber === m.roomNumber &&
      last.userName === m.userName &&
      last.note === m.note &&
      Math.abs(last.time - time) < 60000
    ) {
      last.items.push({ name: m.itemName, quantity: m.quantity });
    } else {
      groups.push({
        id: m.id,
        kind: m.kind,
        roomNumber: m.roomNumber,
        userName: m.userName,
        note: m.note,
        time,
        items: [{ name: m.itemName, quantity: m.quantity }],
      });
    }
  }
  return groups;
}

function dayLabel(time, today) {
  const day = new Date(time);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(day, today)) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (same(day, yesterday)) return 'Yesterday';
  return day.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// The filtered history as a spreadsheet: one row per item moved, newest first.
async function downloadLinenActivityExcel(movements) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const head = ['Date', 'Time', 'Action', 'Room', 'Item', 'Qty', 'By', 'Note'].map((label) => ({
    value: label,
    fontWeight: 'bold',
    backgroundColor: '#e8e6f5',
  }));
  const rows = movements.map((m) => {
    const d = new Date(m.createdAt);
    return [
      { value: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) },
      { value: d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) },
      { value: MOVE_LABEL[m.kind] },
      { value: m.roomNumber || null },
      { value: m.itemName },
      { value: m.quantity, type: Number, align: 'right' },
      { value: m.userName || null },
      { value: m.note || null },
    ];
  });
  const workbook = await writeXlsxFile(
    [{ data: [head, ...rows], sheet: 'Linen activity', stickyRowsCount: 1, columns: [14, 10, 20, 8, 22, 8, 20, 30].map((width) => ({ width })) }],
    { fontFamily: 'Calibri', fontSize: 11 }
  );
  triggerDownload(await workbook.toBlob(), `linen-activity-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// What happened to the linen, newest first, grouped by day. Filterable, and short
// until asked for more, so a long history never pushes the table off the screen.
function LinenActivity({ movements }) {
  const [filter, setFilter] = useState('ALL');
  const [limit, setLimit] = useState(8);
  const [view, setView] = useState('LIST'); // LIST | TABLE
  const [today] = useState(() => new Date());

  const kinds = MOVE_FILTERS.find((f) => f.key === filter).kinds;
  const filtered = (movements ?? []).filter((m) => !kinds || kinds.includes(m.kind));
  const groups = groupMovements(filtered);
  const visible = groups.slice(0, limit);

  const days = [];
  for (const g of visible) {
    const label = dayLabel(g.time, today);
    if (days.length === 0 || days[days.length - 1].label !== label) days.push({ label, events: [] });
    days[days.length - 1].events.push(g);
  }

  return (
    <section className="hk-activity" aria-label="Recent linen activity">
      <div className="hk-section-head">
        <h4>Recent activity</h4>
        <div className="hk-tabs" role="tablist" aria-label="Filter activity">
          {MOVE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              className="hk-tab hk-tab--small"
              onClick={() => {
                setFilter(f.key);
                setLimit(8);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="hk-tabs" role="tablist" aria-label="View">
          {[['LIST', 'List'], ['TABLE', 'Table']].map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              className="hk-tab hk-tab--small"
              onClick={() => setView(key)}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className="hk-tab hk-tab--small"
            disabled={filtered.length === 0}
            onClick={() => downloadLinenActivityExcel(filtered)}
          >
            Download Excel
          </button>
        </div>
      </div>

      {view === 'TABLE' && filtered.length > 0 ? (
        <div className="hk-sheet-wrap">
          <table className="hk-sheet">
            <thead>
              <tr>
                {['Date', 'Time', 'Action', 'Room', 'Item', 'Qty', 'By', 'Note'].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const d = new Date(m.createdAt);
                return (
                  <tr key={m.id}>
                    <td>{d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    <td>{d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</td>
                    <td>{MOVE_LABEL[m.kind]}</td>
                    <td>{m.roomNumber || ''}</td>
                    <td>{m.itemName}</td>
                    <td className="hk-sheet__num">{m.quantity}</td>
                    <td>{m.userName || ''}</td>
                    <td>{m.note || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : groups.length === 0 ? (
        <p className="hk-hint">
          {(movements ?? []).length === 0
            ? 'Nothing yet. When linen is changed in a room, sent out or received, it shows here.'
            : 'Nothing of this kind yet.'}
        </p>
      ) : (
        <div className="hk-events">
          {days.map((d) => (
            <div key={d.label}>
              <p className="hk-events__day">{d.label}</p>
              {d.events.map((g) => (
                <div className="hk-event" key={g.id}>
                  <span className={`hk-dot hk-dot--${MOVE_TONE[g.kind]}`} aria-hidden="true" />
                  <div className="hk-event__body">
                    <div className="hk-event__title">
                      {MOVE_LABEL[g.kind]}
                      {g.roomNumber ? `, room ${g.roomNumber}` : ''}
                    </div>
                    <div className="hk-event__items">{g.items.map((i) => `${i.name} ×${i.quantity}`).join(', ')}</div>
                    <div className="hk-event__meta">
                      {new Date(g.time).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
                      {g.userName ? `, ${g.userName}` : ''}
                      {g.note ? `, ${g.note}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {view === 'LIST' && groups.length > limit && (
        <button type="button" className="hk-link" onClick={() => setLimit(limit + 10)}>
          Show more ({groups.length - limit} older)
        </button>
      )}
    </section>
  );
}

function LinenTab({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // { kind: 'item'|'send'|'receive'|'loss', ... }
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [menuId, setMenuId] = useState(null); // the item whose "⋯" menu is open

  const load = () =>
    apiGet('/housekeeping/linen', { token })
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((err) => setError(errorText(err, 'Could not load linen.')));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = (data?.items ?? []).filter((i) => i.isActive);
  // Hidden types keep their history and can be brought back; they just stop
  // taking up a row.
  const hidden = (data?.items ?? []).filter((i) => !i.isActive);
  const atLaundry = items.filter((i) => i.inLaundry > 0);
  const total = (key) => items.reduce((n, i) => n + Math.max(0, i[key]), 0);
  const totals = { dirty: total('dirty'), inLaundry: total('inLaundry'), clean: total('clean') };

  const open = (m) => {
    setFormError('');
    setModal(m);
  };

  // Send and Receive open already filled in with what the stock says is dirty or
  // out, so the usual batch is one tap and only a difference needs fixing.
  const openSend = () =>
    open({ kind: 'send', lines: Object.fromEntries(items.map((i) => [i.id, { quantity: Math.max(0, i.dirty) }])), note: '' });
  const openReceive = () =>
    open({
      kind: 'receive',
      lines: Object.fromEntries(atLaundry.map((i) => [i.id, { received: i.inLaundry, lost: 0, damaged: 0 }])),
      note: '',
    });
  const openLoss = (item) => open({ kind: 'loss', linenItemId: String(item.id), lossKind: 'LOST', quantity: 1, note: '' });

  const setActive = async (item, isActive) => {
    setBusy(true);
    setFormError('');
    try {
      await apiPatch(`/housekeeping/linen/items/${item.id}`, { isActive }, { token });
      setModal(null);
      await load();
    } catch (err) {
      const message = errorText(err, 'Could not update the linen type.');
      setFormError(message);
      setError(message);
    } finally {
      setBusy(false);
    }
  };
  // Hiding removes a row, not its history. Linen still out would vanish from the
  // board while it is away, so that has to come back first.
  const hideItem = (item) => {
    const away = item.dirty + item.inLaundry;
    if (away > 0) {
      setError(`${item.name} still has ${away} dirty or at the laundry. Receive or send those first, then hide it.`);
      return;
    }
    if (window.confirm(`Hide ${item.name}? Its history is kept, and you can bring it back from “Add a linen type”.`)) setActive(item, false);
  };

  const save = async (path, body, method = apiPost) => {
    setBusy(true);
    setFormError('');
    try {
      await method(path, body, { token });
      setModal(null);
      load();
    } catch (err) {
      setFormError(errorText(err, 'Could not save.'));
    } finally {
      setBusy(false);
    }
  };

  const setLine = (id, patch) => setModal({ ...modal, lines: { ...modal.lines, [id]: { ...(modal.lines[id] ?? {}), ...patch } } });

  const submitModal = () => {
    if (modal.kind === 'item') {
      if (!modal.name.trim()) return setFormError('Enter a name.');
      const body = { name: modal.name.trim(), totalOwned: Number(modal.owned) || 0 };
      return modal.id ? save(`/housekeeping/linen/items/${modal.id}`, body, apiPatch) : save('/housekeeping/linen/items', body);
    }
    if (modal.kind === 'send') {
      const rows = items
        .map((i) => ({ linenItemId: i.id, quantity: modal.lines[i.id]?.quantity ?? 0 }))
        .filter((l) => l.quantity > 0);
      if (rows.length === 0) return setFormError('Tap the counts you are sending.');
      return save('/housekeeping/linen/send', { lines: rows, note: modal.note });
    }
    if (modal.kind === 'receive') {
      const rows = atLaundry
        .map((i) => {
          const l = modal.lines[i.id] ?? {};
          return { linenItemId: i.id, received: l.received ?? 0, lost: l.lost ?? 0, damaged: l.damaged ?? 0 };
        })
        .filter((l) => l.received + l.lost + l.damaged > 0);
      if (rows.length === 0) return setFormError('Tap the counts that came back.');
      return save('/housekeeping/linen/receive', { lines: rows, note: modal.note });
    }
    if (!modal.linenItemId) return setFormError('Choose the item.');
    return save('/housekeeping/linen/loss', {
      linenItemId: Number(modal.linenItemId),
      kind: modal.lossKind,
      quantity: modal.quantity,
      note: modal.note,
    });
  };

  const TITLES = {
    item: modal?.id ? 'Edit linen item' : 'Add linen item',
    send: 'Send to laundry',
    receive: 'Receive from laundry',
    loss: 'Lost or damaged linen',
  };
  const STARTERS = ['Bedsheet', 'Pillow cover', 'Towel', 'Bath towel', 'Blanket'];

  return (
    <div className="chart-section hk-board">
      {error && <div className="form-banner form-banner--error">{error}</div>}
      {!data && !error && <PageLoader inline label="Loading" />}

      {data && items.length === 0 && (
        <div className="hk-empty">
          <span className="hk-empty__icon">
            <StatusIcon tone="dirty" size={22} />
          </span>
          <p className="hk-empty__title">Add the linen you count</p>
          <p className="hk-empty__text">Add each type once, with how many you own. Then track it through the laundry.</p>
          <div className="hk-starters">
            {STARTERS.map((name) => (
              <button key={name} type="button" className="hk-tab" onClick={() => open({ kind: 'item', name, owned: '' })}>
                + {name}
              </button>
            ))}
          </div>
          <button type="button" className="btn-secondary" onClick={() => open({ kind: 'item', name: '', owned: '' })}>
            Add another type
          </button>
        </div>
      )}

      {items.length > 0 && (
        <div className="hk-matrix-wrap">
          <div className="hk-toolbar">
            <button type="button" className="hk-action" onClick={openSend}>
              Send to laundry
            </button>
            <button type="button" className="hk-action" onClick={openReceive} disabled={atLaundry.length === 0}>
              Receive from laundry
            </button>
            <span className="hk-toolbar__hint">Linen moves left to right in the table.</span>
          </div>
          <table className="hk-matrix">
            <caption className="sr-only">Linen count by stage</caption>
            <thead>
              <tr>
                <th scope="col" className="hk-matrix__item">
                  Linen
                </th>
                <th scope="col">
                  <span className="hk-dot hk-dot--dirty" aria-hidden="true" />
                  Dirty
                </th>
                <th scope="col">
                  <span className="hk-dot hk-dot--cleaning" aria-hidden="true" />
                  At laundry
                </th>
                <th scope="col">
                  <span className="hk-dot hk-dot--ready" aria-hidden="true" />
                  Clean
                </th>
                <th scope="col" className="hk-matrix__menu">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <th scope="row" className="hk-matrix__item">
                    <span className="hk-matrix__name">{i.name}</span>
                    {i.short ? (
                      <span className="hk-matrix__owned hk-matrix__owned--warn">More is out than you own. Check the count.</span>
                    ) : (
                      <span className="hk-matrix__owned">{i.owned} owned</span>
                    )}
                  </th>
                  <td>{i.dirty}</td>
                  <td>{i.inLaundry}</td>
                  <td className={i.clean <= 0 ? 'hk-matrix__low' : undefined}>{i.clean}</td>
                  <td className="hk-matrix__menu">
                    <span className="hk-menu">
                      <button
                        type="button"
                        className="hk-more"
                        aria-label={`More actions for ${i.name}`}
                        aria-expanded={menuId === i.id}
                        onClick={() => setMenuId(menuId === i.id ? null : i.id)}
                      >
                        ⋯
                      </button>
                      {menuId === i.id && (
                        <>
                          <button type="button" className="hk-menu__backdrop" aria-label="Close menu" onClick={() => setMenuId(null)} />
                          <span className="hk-menu__list" role="menu">
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setMenuId(null);
                                open({ kind: 'item', id: i.id, name: i.name, owned: String(i.totalOwned) });
                              }}
                            >
                              Edit name or count
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setMenuId(null);
                                openLoss(i);
                              }}
                            >
                              Lost or damaged
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setMenuId(null);
                                hideItem(i);
                              }}
                            >
                              Hide from list
                            </button>
                          </span>
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="hk-matrix__item">
                  All linen
                </th>
                <td>{totals.dirty}</td>
                <td>{totals.inLaundry}</td>
                <td>{totals.clean}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          <div className="hk-matrix__foot">
            <button type="button" className="hk-action hk-action--ghost" onClick={() => open({ kind: 'item', name: '', owned: '' })}>
              + Add a linen type
            </button>
            {hidden.length > 0 && <span className="hk-hint hk-hint--inline">{hidden.length} hidden. Bring back from Add a linen type.</span>}
          </div>

          <LinenActivity movements={data.movements} />
        </div>
      )}

      {modal && (
        <Modal
          title={TITLES[modal.kind]}
          sub={
            modal.kind === 'send'
              ? 'Already filled in with what is dirty. Change a count if you send less.'
              : modal.kind === 'receive'
                ? 'Already filled in with what is out. Lower a count if something has not come back.'
                : undefined
          }
          busy={busy}
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setModal(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="btn-accent" onClick={submitModal} disabled={busy}>
                {busy ? 'Saving…' : modal.kind === 'send' ? 'Send out' : modal.kind === 'receive' ? 'Receive' : 'Save'}
              </button>
            </>
          }
        >
          {formError && <div className="form-banner form-banner--error">{formError}</div>}

          {modal.kind === 'item' && (
            <>
              {/* Adding is mostly the same few things, so offer them. Types that were
                  hidden come back with their history instead of starting again. */}
              {!modal.id && hidden.length > 0 && (
                <div className="hk-suggest">
                  <span className="hk-suggest__label">Bring back</span>
                  {hidden.map((h) => (
                    <button key={h.id} type="button" className="hk-tab hk-tab--small" disabled={busy} onClick={() => setActive(h, true)}>
                      {h.name}
                    </button>
                  ))}
                </div>
              )}
              {!modal.id &&
                STARTERS.filter((s) => !(data?.items ?? []).some((i) => i.name.toLowerCase() === s.toLowerCase())).length > 0 && (
                  <div className="hk-suggest">
                    <span className="hk-suggest__label">Common types</span>
                    {STARTERS.filter((s) => !(data?.items ?? []).some((i) => i.name.toLowerCase() === s.toLowerCase())).map((s) => (
                      <button key={s} type="button" className="hk-tab hk-tab--small" onClick={() => setModal({ ...modal, name: s })}>
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              <div className="field">
                <label htmlFor="liName">
                  Name
                  <Req />
                </label>
                <input id="liName" value={modal.name} onChange={(e) => setModal({ ...modal, name: e.target.value })} placeholder="Bedsheet" autoFocus />
              </div>
              <div className="field">
                <label htmlFor="liOwned">How many do you own in total?</label>
                <input id="liOwned" type="number" min="0" value={modal.owned} onChange={(e) => setModal({ ...modal, owned: e.target.value })} />
                <small className="hk-sub">Count everything: in rooms, in the store and at the laundry.</small>
              </div>
            </>
          )}

          {modal.kind === 'send' &&
            items.map((i) => (
              <div className="hk-row" key={i.id}>
                <span>
                  {i.name}
                  <small className="hk-sub"> {i.dirty} dirty</small>
                </span>
                <Stepper label={i.name} max={i.dirty + i.clean} value={modal.lines[i.id]?.quantity ?? 0} onChange={(n) => setLine(i.id, { quantity: n })} />
              </div>
            ))}

          {modal.kind === 'receive' &&
            (atLaundry.length === 0 ? (
              <p className="hk-hint">Nothing is at the laundry right now.</p>
            ) : (
              atLaundry.map((i) => {
                const l = modal.lines[i.id] ?? {};
                const missing = i.inLaundry - (l.received ?? 0);
                const accounted = (l.lost ?? 0) + (l.damaged ?? 0);
                return (
                  <div className="hk-receive" key={i.id}>
                    <div className="hk-row">
                      <span>
                        {i.name}
                        <small className="hk-sub"> {i.inLaundry} out</small>
                      </span>
                      <Stepper label={`${i.name} came back`} max={i.inLaundry} value={l.received ?? 0} onChange={(n) => setLine(i.id, { received: n })} />
                    </div>
                    {/* Only when something is short: the common case stays one stepper. */}
                    {(missing > 0 || accounted > 0) && (
                      <div className="hk-receive__missing">
                        <span className="hk-sub hk-sub--warn">
                          {Math.max(0, missing - accounted)} not back yet. Mark any that are gone:
                        </span>
                        <span className="hk-row__steppers">
                          <label>
                            Lost <Stepper label={`${i.name} lost`} max={i.inLaundry} value={l.lost ?? 0} onChange={(n) => setLine(i.id, { lost: n })} />
                          </label>
                          <label>
                            Damaged <Stepper label={`${i.name} damaged`} max={i.inLaundry} value={l.damaged ?? 0} onChange={(n) => setLine(i.id, { damaged: n })} />
                          </label>
                        </span>
                      </div>
                    )}
                  </div>
                );
              })
            ))}

          {modal.kind === 'loss' && (
            <>
              <div className="field">
                <label htmlFor="lossItem">Item</label>
                <select id="lossItem" value={modal.linenItemId} onChange={(e) => setModal({ ...modal, linenItemId: e.target.value })}>
                  <option value="">Choose…</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="toggle-group">
                <button type="button" aria-pressed={modal.lossKind === 'LOST'} onClick={() => setModal({ ...modal, lossKind: 'LOST' })}>
                  Lost
                </button>
                <button type="button" aria-pressed={modal.lossKind === 'DAMAGED'} onClick={() => setModal({ ...modal, lossKind: 'DAMAGED' })}>
                  Damaged
                </button>
              </div>
              <div className="hk-row">
                <span>How many</span>
                <Stepper label="quantity" value={modal.quantity} onChange={(n) => setModal({ ...modal, quantity: Math.max(1, n) })} />
              </div>
            </>
          )}

          {modal.kind !== 'item' && (
            <div className="field">
              <label htmlFor="hkNote">Note (optional)</label>
              <input id="hkNote" value={modal.note} onChange={(e) => setModal({ ...modal, note: e.target.value })} placeholder="e.g. laundry name, bag number" />
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guest laundry
// ---------------------------------------------------------------------------

const LAUNDRY_TABS = [
  { key: 'RECEIVED', label: 'To wash', tone: 'dirty' },
  { key: 'WASHING', label: 'Washing', tone: 'cleaning' },
  { key: 'READY', label: 'Ready', tone: 'ready' },
  { key: 'DONE', label: 'Done', tone: 'occupied' },
];

// What the single button on a row does, named by the job rather than the status.
const LAUNDRY_NEXT = {
  RECEIVED: { to: 'WASHING', action: 'Start washing' },
  WASHING: { to: 'READY', action: 'Mark ready' },
  READY: { to: 'DELIVERED', action: 'Hand over' },
};

// Shown as one-tap starters when a garment has not been used before. Never a price
// list: the price is typed on every entry.
const COMMON_GARMENTS = ['Shirt', 'T-shirt', 'Trousers', 'Jeans', 'Saree', 'Kurta', 'Towel', 'Bedsheet'];

function GuestLaundryTab({ token }) {
  const [orders, setOrders] = useState(null);
  const [recent, setRecent] = useState([]); // garments and prices used on earlier orders
  const [guests, setGuests] = useState([]);
  const [tabChoice, setTabChoice] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState(null); // new order
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null); // the order just taken in
  const [confirm, setConfirm] = useState(null); // { order, kind: 'deliver' | 'cancel' }
  const [menuId, setMenuId] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const load = () =>
    apiGet('/housekeeping/laundry/orders?scope=all', { token })
      .then((d) => {
        setOrders(d.orders);
        setError('');
      })
      .catch((err) => setError(errorText(err, 'Could not load laundry.')));

  const loadRecent = () =>
    apiGet('/housekeeping/laundry/garments', { token })
      .then((d) => setRecent(d.garments))
      .catch(() => {});

  useEffect(() => {
    load();
    loadRecent();
    apiGet('/housekeeping/laundry/in-house', { token })
      .then((d) => setGuests(d.guests))
      .catch(() => {});
    // A hand-over at the desk shows up here without a refresh.
    const timer = setInterval(() => {
      load();
      setNow(Date.now());
    }, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stageOf = (o) => (o.status === 'DELIVERED' || o.status === 'CANCELLED' ? 'DONE' : o.status);
  const counts = { RECEIVED: 0, WASHING: 0, READY: 0, DONE: 0 };
  (orders ?? []).forEach((o) => (counts[stageOf(o)] += 1));
  // Opens on the first stage that has work in it, so the screen starts useful.
  const firstBusy = LAUNDRY_TABS.find((t) => t.key !== 'DONE' && counts[t.key] > 0)?.key ?? 'RECEIVED';
  const tab = tabChoice ?? firstBusy;

  const query = search.trim().toLowerCase();
  const shown = (orders ?? []).filter(
    (o) =>
      stageOf(o) === tab &&
      (!query || String(o.tagNumber).includes(query.replace('#', '')) || (o.guestName ?? '').toLowerCase().includes(query))
  );

  const move = async (order, status) => {
    setBusy(true);
    try {
      await apiPost(`/housekeeping/laundry/orders/${order.id}/status`, { status }, { token });
      setConfirm(null);
      await load();
    } catch (err) {
      setConfirm(null);
      setError(errorText(err, 'Could not update the order.'));
    } finally {
      setBusy(false);
    }
  };

  // ---- the entry form: every garment is a row with its own price -----------

  const priceOf = new Map(recent.map((g) => [g.name.toLowerCase(), g.price]));
  const starters = [...new Set([...recent.map((g) => g.name), ...COMMON_GARMENTS])].slice(0, 10);

  const lines = form?.lines ?? [];
  const pieces = lines.reduce((n, l) => n + l.qty, 0);
  const total = lines.reduce((n, l) => n + (Number(l.price) || 0) * l.qty, 0);

  const openForm = () => {
    setFormError('');
    setForm({ mode: guests.length > 0 ? 'stay' : 'walkin', stay: '', guestName: '', guestPhone: '', note: '', lines: [], nextKey: 1 });
  };

  // Tapping a garment adds a row at the price it was last charged. Tapping the
  // same one again adds a piece instead of a second row.
  const addLine = (name = '') =>
    setForm((f) => {
      const same = name && f.lines.find((l) => l.name.toLowerCase() === name.toLowerCase());
      if (same) return { ...f, lines: f.lines.map((l) => (l === same ? { ...l, qty: l.qty + 1 } : l)) };
      const price = name && priceOf.has(name.toLowerCase()) ? String(priceOf.get(name.toLowerCase())) : '';
      return { ...f, nextKey: f.nextKey + 1, lines: [...f.lines, { key: f.nextKey, name, price, qty: 1 }] };
    });
  const patchLine = (key, patch) => setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const removeLine = (key) => setForm((f) => ({ ...f, lines: f.lines.filter((l) => l.key !== key) }));
  // Typing a name that was used before offers its last price, only if none is set.
  const renameLine = (line, name) =>
    patchLine(line.key, { name, ...(line.price === '' && priceOf.has(name.trim().toLowerCase()) ? { price: String(priceOf.get(name.trim().toLowerCase())) } : {}) });

  const create = async () => {
    setFormError('');
    // A row with nothing typed in it is just a row someone added and left.
    const used = lines.filter((l) => l.name.trim() || l.price !== '');
    if (used.length === 0) return setFormError('Add the garments being handed in.');
    for (const l of used) {
      if (!l.name.trim()) return setFormError('Enter the garment name on every row.');
      if (l.price === '' || !(Number(l.price) >= 0)) return setFormError(`Enter the price for ${l.name.trim()}.`);
    }
    const stay = form.mode === 'stay' ? guests.find((g) => `${g.bookingId}:${g.roomId}` === form.stay) : null;
    if (form.mode === 'stay' && !stay) return setFormError('Choose the guest.');
    if (form.mode === 'walkin' && !form.guestName.trim()) return setFormError('Enter the customer’s name.');
    setBusy(true);
    try {
      const d = await apiPost(
        '/housekeeping/laundry/orders',
        {
          bookingId: stay?.bookingId ?? null,
          roomId: stay?.roomId ?? null,
          guestName: stay ? '' : form.guestName,
          guestPhone: stay ? '' : form.guestPhone,
          note: form.note,
          items: used.map((l) => ({ name: l.name.trim(), price: Number(l.price), quantity: l.qty })),
        },
        { token }
      );
      setForm(null);
      setCreated(d.order);
      setTabChoice('RECEIVED');
      load();
      loadRecent();
    } catch (err) {
      setFormError(errorText(err, 'Could not save the order.'));
    } finally {
      setBusy(false);
    }
  };

  const summary = (o) => {
    const text = o.items.map((i) => `${i.name} ×${i.quantity}`).join(', ');
    return text.length > 70 ? `${text.slice(0, 67)}…` : text;
  };

  return (
    <div className="chart-section hk-board">
      <div className="hk-toolbar">
        <button type="button" className="hk-action" onClick={openForm}>
          + New laundry
        </button>
        {(orders ?? []).length > 5 && (
          <input
            type="search"
            className="hk-search"
            placeholder="Find by tag or name"
            aria-label="Find laundry by tag number or name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
      </div>

      {error && <div className="form-banner form-banner--error">{error}</div>}
      {!orders && !error && <PageLoader inline label="Loading" />}

      {orders && (
        <div className="hk-tabs" role="tablist" aria-label="Laundry stage">
          {LAUNDRY_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`hk-tab hk-tab--${t.tone}${counts[t.key] === 0 ? ' hk-tab--zero' : ''}`}
              onClick={() => setTabChoice(t.key)}
            >
              {t.label}
              <span className="hk-tab__n">{counts[t.key]}</span>
            </button>
          ))}
        </div>
      )}

      {orders && shown.length === 0 && (
        <div className="hk-empty">
          <p className="hk-empty__title">
            {query ? 'No match' : tab === 'DONE' ? 'Nothing handed over yet' : `Nothing ${tab === 'RECEIVED' ? 'waiting to be washed' : tab === 'WASHING' ? 'in the wash' : 'ready to hand over'}`}
          </p>
          <p className="hk-empty__text">
            {query ? 'Check the tag number or the name.' : tab === 'RECEIVED' ? 'Tap + New laundry when a guest hands in clothes.' : 'Orders move here as you work through them.'}
          </p>
        </div>
      )}

      <div className="hk-orders">
        {shown.map((o) => {
          const step = LAUNDRY_NEXT[o.status];
          const tone = LAUNDRY_TABS.find((t) => t.key === stageOf(o)).tone;
          return (
            <article className={`hk-order hk-order--${tone}`} key={o.id}>
              <span className="hk-order__tag" aria-label={`Tag number ${o.tagNumber}`}>
                <small>Tag</small>
                {o.tagNumber}
              </span>
              <div className="hk-order__body">
                <div className="hk-order__who">
                  <strong>{o.guestName}</strong>
                  <span className="hk-order__room">{o.roomNumber ? `Room ${o.roomNumber}` : 'Walk-in'}</span>
                </div>
                <div className="hk-order__items">
                  {summary(o)} <span className="hk-order__pieces">({o.pieces} {o.pieces === 1 ? 'piece' : 'pieces'})</span>
                </div>
                <div className="hk-order__meta">
                  <span>{o.status === 'DELIVERED' ? `Handed over ${ago(o.deliveredAt, now)} ago` : o.status === 'CANCELLED' ? 'Cancelled' : `In ${ago(o.receivedAt, now)}`}</span>
                  <span className="hk-order__price">{formatPrice(o.total)}</span>
                  {o.note && <span className="hk-order__note">{o.note}</span>}
                </div>
              </div>
              <div className="hk-order__side">
                {step && (
                  <button
                    type="button"
                    className="hk-action"
                    disabled={busy}
                    onClick={() => (step.to === 'DELIVERED' ? setConfirm({ order: o, kind: 'deliver' }) : move(o, step.to))}
                  >
                    {step.action}
                  </button>
                )}
                {step && (
                  <span className="hk-menu">
                    <button
                      type="button"
                      className="hk-more"
                      aria-label={`More actions for tag ${o.tagNumber}`}
                      aria-expanded={menuId === o.id}
                      onClick={() => setMenuId(menuId === o.id ? null : o.id)}
                    >
                      ⋯
                    </button>
                    {menuId === o.id && (
                      <>
                        <button type="button" className="hk-menu__backdrop" aria-label="Close menu" onClick={() => setMenuId(null)} />
                        <span className="hk-menu__list" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMenuId(null);
                              setConfirm({ order: o, kind: 'cancel' });
                            }}
                          >
                            Cancel this order
                          </button>
                        </span>
                      </>
                    )}
                  </span>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {tab === 'READY' && shown.length > 0 && (
        <p className="hk-hint">Handing over adds the charge to Room billing → Services to bill.</p>
      )}

      {created && (
        <Modal
          title="Laundry taken in"
          busy={false}
          onClose={() => setCreated(null)}
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => { setCreated(null); openForm(); }}>
                Take in more
              </button>
              <button type="button" className="hk-action" onClick={() => setCreated(null)}>
                Done
              </button>
            </>
          }
        >
          <div className="hk-tagbig">
            <small>Write this tag on the bag</small>
            <strong>{created.tagNumber}</strong>
          </div>
          <p className="hk-hint hk-hint--center">
            {created.guestName}, {created.pieces} {created.pieces === 1 ? 'piece' : 'pieces'}, {formatPrice(created.total)}
          </p>
        </Modal>
      )}

      {confirm && (
        <Modal
          title={confirm.kind === 'deliver' ? `Hand over tag ${confirm.order.tagNumber}?` : `Cancel tag ${confirm.order.tagNumber}?`}
          busy={busy}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setConfirm(null)} disabled={busy}>
                {confirm.kind === 'deliver' ? 'Not yet' : 'Keep order'}
              </button>
              <button
                type="button"
                className="hk-action"
                disabled={busy}
                onClick={() => move(confirm.order, confirm.kind === 'deliver' ? 'DELIVERED' : 'CANCELLED')}
              >
                {busy ? 'Saving…' : confirm.kind === 'deliver' ? 'Hand over' : 'Cancel order'}
              </button>
            </>
          }
        >
          <p className="hk-confirm">
            {confirm.kind === 'deliver' ? (
              <>
                <strong>{confirm.order.guestName}</strong>
                {confirm.order.roomNumber ? `, room ${confirm.order.roomNumber}` : ''}. {confirm.order.pieces}{' '}
                {confirm.order.pieces === 1 ? 'piece' : 'pieces'}. <strong>{formatPrice(confirm.order.total)}</strong> will be added to Services to
                bill, so it can go on the room bill or be billed on its own.
              </>
            ) : (
              <>The clothes are not charged. This cannot be undone.</>
            )}
          </p>
        </Modal>
      )}

      {form && (
        <Modal
          title="New laundry"
          sub="Add each garment with its price per piece. Prices include GST."
          busy={busy}
          onClose={() => setForm(null)}
          footer={
            <>
              <span className="hk-total">
                {pieces} {pieces === 1 ? 'piece' : 'pieces'}, {formatPrice(total)}
              </span>
              <button type="button" className="btn-secondary" onClick={() => setForm(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="hk-action" onClick={create} disabled={busy}>
                {busy ? 'Saving…' : 'Take in'}
              </button>
            </>
          }
        >
          {formError && <div className="form-banner form-banner--error">{formError}</div>}

          {guests.length > 0 && (
            <div className="toggle-group">
              <button type="button" aria-pressed={form.mode === 'stay'} onClick={() => setForm({ ...form, mode: 'stay' })}>
                Staying guest
              </button>
              <button type="button" aria-pressed={form.mode === 'walkin'} onClick={() => setForm({ ...form, mode: 'walkin' })}>
                Walk-in
              </button>
            </div>
          )}
          {form.mode === 'stay' ? (
            <div className="field">
              <label htmlFor="lgGuest">Guest</label>
              <select id="lgGuest" value={form.stay} onChange={(e) => setForm({ ...form, stay: e.target.value })}>
                <option value="">Choose…</option>
                {guests.map((g) => (
                  <option key={`${g.bookingId}:${g.roomId}`} value={`${g.bookingId}:${g.roomId}`}>
                    Room {g.roomNumber}, {g.guestName}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="field-row">
              <div className="field">
                <label htmlFor="lgName">Name</label>
                <input id="lgName" value={form.guestName} onChange={(e) => setForm({ ...form, guestName: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="lgPhone">Phone</label>
                <input id="lgPhone" value={form.guestPhone} onChange={(e) => setForm({ ...form, guestPhone: e.target.value })} />
              </div>
            </div>
          )}

          <div className="hk-suggest">
            <span className="hk-suggest__label">Tap to add</span>
            {starters.map((n) => (
              <button key={n} type="button" className="hk-tab hk-tab--small" onClick={() => addLine(n)}>
                + {n}
              </button>
            ))}
            <button type="button" className="hk-tab hk-tab--small" onClick={() => addLine('')}>
              + Other
            </button>
          </div>

          <datalist id="hk-garment-names">
            {recent.map((g) => (
              <option key={g.name} value={g.name} />
            ))}
          </datalist>

          {lines.length === 0 ? (
            <p className="hk-hint">Tap a garment above, or choose Other to type its name.</p>
          ) : (
            <div className="hk-lines">
              {lines.map((l) => (
                <div className="hk-line" key={l.key}>
                  <input
                    className="hk-line__name"
                    list="hk-garment-names"
                    placeholder="Garment"
                    aria-label="Garment name"
                    value={l.name}
                    onChange={(e) => renameLine(l, e.target.value)}
                  />
                  <label className="hk-line__price">
                    <span aria-hidden="true">₹</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.5"
                      placeholder="Price"
                      aria-label={`Price per piece for ${l.name || 'garment'}`}
                      value={l.price}
                      onChange={(e) => patchLine(l.key, { price: e.target.value })}
                    />
                  </label>
                  <Stepper
                    label={l.name || 'garment'}
                    value={l.qty}
                    onChange={(n) => (n <= 0 ? removeLine(l.key) : patchLine(l.key, { qty: n }))}
                  />
                  <span className="hk-line__total">{formatPrice((Number(l.price) || 0) * l.qty)}</span>
                  <button type="button" className="hk-line__x" aria-label={`Remove ${l.name || 'row'}`} onClick={() => removeLine(l.key)}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="field">
            <label htmlFor="lgNote">Note (stains, fragile …)</label>
            <input id="lgNote" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function HousekeepingPanel({ lodge }) {
  const token = getSession()?.token;
  const guestLaundry = Boolean(lodge?.hasOtherServices);
  const tabs = [
    { key: 'rooms', label: 'Rooms' },
    { key: 'linen', label: 'Hotel laundry' },
    ...(guestLaundry ? [{ key: 'laundry', label: 'Guest laundry' }] : []),
  ];
  const [tab, setTab] = useState('rooms');

  return (
    <div>
      <div className="subtabs">
        {tabs.map((t) => (
          <button key={t.key} type="button" className="subtabs__item" aria-current={tab === t.key ? 'page' : undefined} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'rooms' && <RoomsTab token={token} />}
      {tab === 'linen' && <LinenTab token={token} />}
      {tab === 'laundry' && guestLaundry && <GuestLaundryTab token={token} />}
    </div>
  );
}
