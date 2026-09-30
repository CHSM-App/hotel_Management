import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Billing from './Billing';
import { apiGet, apiPost, apiPatch, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { readCache, writeCache } from '../../lib/dataCache';
import { formatPrice } from './priceFormat';
import Req from '../../components/RequiredMark';
import './forms.css';
import './MenuPanel.css';
import './OrdersPanel.css';
import PageLoader from '../../components/PageLoader';

const POLL_MS = 10000;

const capitalizeName = (value) => value.replace(/\b\w/g, (c) => c.toUpperCase());

// Mirrors mobileDigits/isMobile in Bookings.jsx — duplicated rather than
// shared for the same reason FoodTypeMark below is: this panel doesn't
// import from Bookings.jsx, and it's a few lines either way.
function mobileDigits(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}
const typedMobile = (value) => mobileDigits(value).slice(0, 10);
const isMobile = (value) => /^[6-9]\d{9}$/.test(mobileDigits(value));

// Same mark as the menu editor and the guest's page. Defined here rather than
// shared because it is four lines and MenuPanel.css — already imported above
// for the modal chrome — is where the shape actually lives.
function FoodTypeMark({ type }) {
  return <span className={`food-mark food-mark--${type.toLowerCase().replace('_', '-')}`} />;
}

const STATUS_LABEL = {
  PENDING: 'Needs accepting',
  QUEUED: 'In the queue',
  PREPARING: 'Preparing',
  READY: 'Ready',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

// The button that moves an order on. Only ever rendered from the order's own
// nextStatuses, which the server computes — the screen never guesses which
// transitions are legal.
const ACTION_LABEL = {
  QUEUED: 'Accept',
  PREPARING: 'Start cooking',
  READY: 'Ready',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancel',
};

function elapsedLabel(placedAt, now) {
  const minutes = Math.max(0, Math.floor((now - new Date(placedAt).getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

// Where the order went, in the words the staff use for it.
// A ticket read by course: dishes grouped under their menu section (Starters,
// Main Course…), each section a collapsible dropdown. An order from one
// section only is shown as a plain list. `renderLi` returns one <li>.
function renderSections(items, renderLi) {
  const groups = [];
  for (const item of [...items].sort((a, b) => (a.categorySort ?? 0) - (b.categorySort ?? 0))) {
    const name = item.category || 'Other';
    let g = groups.find((x) => x.name === name);
    if (!g) groups.push((g = { name, items: [] }));
    g.items.push(item);
  }
  if (groups.length <= 1) return items.map(renderLi);
  const total = (list) => list.reduce((n, i) => n + i.quantity, 0);
  const ready = (list) => list.filter((i) => i.readyAt).reduce((n, i) => n + i.quantity, 0);
  return groups.map((g) => (
    <li key={g.name} className="order-card__section">
      <details>
        <summary>
          {g.name} <span className="order-card__section-count">{total(g.items)}</span>
          {ready(g.items) > 0 && (
            <span className="order-card__section-ready">
              {ready(g.items) === total(g.items) ? `All ${total(g.items)} ready` : `${ready(g.items)} of ${total(g.items)} ready`}
            </span>
          )}
        </summary>
        <ul className="order-card__sublist">{g.items.map(renderLi)}</ul>
      </details>
    </li>
  ));
}

// Dishes of one order by menu section, in menu order — the same grouping the
// card view uses. Counted in dish lines: "Starters 4/5" is four of five lines ticked.
function sectionsOf(items) {
  const groups = [];
  for (const item of [...items].sort((a, b) => (a.categorySort ?? 0) - (b.categorySort ?? 0))) {
    const name = item.category || 'Other';
    let g = groups.find((x) => x.name === name);
    if (!g) groups.push((g = { name, items: [] }));
    g.items.push(item);
  }
  return groups;
}

function targetLabel(order) {
  if (order.source === 'ROOM') return `Room ${order.roomNumber}`;
  if (order.source === 'TABLE') return order.tableLabel;
  return 'Counter';
}

function dateTimeLabel(iso) {
  return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

// Where an order came from: a guest's own QR scan, or a member of staff typing
// it in. Says where the food is going too (room = charged to a stay).
function SourceTag({ order }) {
  const place = order.source === 'ROOM' ? 'Room' : order.source === 'TABLE' ? 'Table' : 'Counter';
  return order.guestOrder ? (
    <span className="src-tag src-tag--qr">{place} QR</span>
  ) : (
    <span className="src-tag">Staff</span>
  );
}

// What to call an order once a bill carries it: Paid (with how), Part paid,
// or plain Billed when no payment is on record.
const METHOD_LABEL = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card' };
function billedLabel(order) {
  const p = order.payment;
  if (!p) return 'Billed';
  if (p.status === 'PAID') return p.method ? `Paid · ${METHOD_LABEL[p.method] || p.method}` : 'Paid';
  if (p.status === 'PART') return 'Part paid';
  return 'Billed';
}

function HandledBy({ order }) {
  if (!order.handledBy) return null;
  return <span className="order-card__handler">{order.guestOrder ? 'Accepted' : 'Taken'} by {order.handledBy}</span>;
}

function timeLabel(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Built from the local clock rather than toISOString(), which is UTC: every
// lodge here runs on IST, so between 6:30pm and midnight the UTC date is still
// yesterday and the history would open on the wrong day mid-service.
function todayIsoLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// A short two-tone chime, synthesised rather than loaded from a file so there's
// no asset to 404 and nothing to fetch on a bad connection. Without an audible
// alert the kitchen screen fails silently — nobody watches it — so this is
// load-bearing, not decoration.
function playChime(audioContext) {
  const now = audioContext.currentTime;
  [880, 1320].forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    const start = now + index * 0.18;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.4);
  });
}

// Spreadsheet (a dense record) or cards — one at a time.
function ViewToggle({ view, onChange }) {
  return (
    <div className="order-history__filters" role="group" aria-label="View">
      {[
        ['sheet', 'Spreadsheet view', <path key="p" d="M3 5h18v14H3zM3 10h18M3 15h18M9 5v14M15 5v14" />],
        ['cards', 'Card view', <path key="p" d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />],
      ].map(([key, label, icon]) => (
        <button
          key={key}
          type="button"
          className={`history-chip history-chip--icon${view === key ? ' history-chip--on' : ''}`}
          aria-pressed={view === key}
          aria-label={label}
          title={label}
          onClick={() => onChange(key)}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
            {icon}
          </svg>
        </button>
      ))}
    </div>
  );
}

// `view` / `onViewChange` / `hideTabs` let a parent (FoodSection) own the tab
// strip so orders and billing share one; on its own the panel keeps its tabs.
export default function OrdersPanel({ lodge, permissions = [], view: viewProp = null, onViewChange = null, hideTabs = false, onPendingChange = null, toolsHost = null }) {
  const session = getSession();
  // Which half of this screen a role actually gets: orders.manage is view,
  // accept and cancel; orders.cook is the kitchen's own job of actually
  // cooking (queued through delivered, and ticking dishes off); orders.take
  // is placing a new order. OWNER and RECEPTION hold orders.manage but not
  // orders.cook — they can watch the queue, take a pending order in and stop
  // one, but not push it through the kitchen themselves.
  const canWorkQueue = permissions.includes('orders.manage');
  const canCook = permissions.includes('orders.cook');
  const canTakeOrders = permissions.includes('orders.take');
  // Kitchen only cooks; accepting guest QR orders is front-of-house.
  const canAccept = canWorkQueue && !(canCook && !canTakeOrders);
  // Owner / reception bill straight from a delivered order in the queue.
  const canBillHere = canWorkQueue && canTakeOrders && permissions.includes('billing.manage');
  const [billTab, setBillTab] = useState(null);
  const canIssue = (o) => canBillHere && o.status === 'DELIVERED' && (o.source !== 'ROOM' || !o.bookingId);
  const issueBill = async (o) => {
    setBusyId(o.id);
    try {
      if (!o.readyToBill) await apiPost(`/orders/${o.id}/ready-to-bill`, {}, { token: session?.token });
      setBillTab(
        o.source === 'TABLE'
          ? { tab: `table-${o.tableId}`, label: o.tableLabel }
          : o.source === 'COUNTER'
            ? { tab: `counter-${o.id}`, label: `Takeaway #${o.orderNumber}` }
            : { tab: `room-${o.roomId}`, label: `Room ${o.roomNumber}` }
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open the bill.');
    } finally {
      setBusyId(null);
    }
  };
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');
  // Lazy initialiser: Date.now() is impure, so it belongs in a callback React
  // runs once rather than being evaluated on every render.
  const [now, setNow] = useState(() => Date.now());
  const [busyId, setBusyId] = useState(null);
  const [busyItemId, setBusyItemId] = useState(null);

  // Browsers refuse to play audio until the user has interacted with the page,
  // so the context is created on an explicit tap and the screen says so until
  // then — a silent alert the kitchen believes is on would be worse than none.
  const audioRef = useRef(null);
  const [soundOn, setSoundOn] = useState(false);
  const knownIdsRef = useRef(null);

  const [showCounterForm, setShowCounterForm] = useState(false);
  // A captain with no queue access lands on the take-order view instead —
  // the queue tab isn't rendered for them at all (see below).
  const [viewState, setViewState] = useState(canWorkQueue ? 'QUEUE' : 'ACTIVE');
  const view = viewProp ?? viewState;
  const setView = (next) => (onViewChange ? onViewChange(next) : setViewState(next));
  // Bumped after placing an order to force History/My orders to re-fetch —
  // its own effect only re-runs on a date change otherwise. Also carries the
  // one-line confirmation a captain has no other way to see.
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [placedNotice, setPlacedNotice] = useState('');
  // Guest QR orders waiting for a captain — the badge on their Orders tab.
  const [guestPending, setGuestPending] = useState(0);
  // No queue screen for a captain, so the History list is what tells them a
  // guest just ordered; it chimes when a new guest order shows up.
  const onNewGuestOrders = () => {
    if (audioRef.current) playChime(audioRef.current);
  };
  const [editing, setEditing] = useState(null);
  // Spreadsheet or cards; shared so the captain's queue can keep the toggle in the toolbar.
  const [listView, setListView] = useState('sheet');

  const load = useCallback(async () => {
    try {
      const data = await apiGet('/orders/queue', { token: session?.token });
      setOrders(data.orders);
      setError('');

      // Chime for orders that weren't on the previous poll. The first load
      // seeds the set silently, otherwise opening the screen mid-service would
      // sound the alarm for every order already cooking.
      const ids = new Set(data.orders.map((o) => o.id));
      if (knownIdsRef.current) {
        const hasNew = data.orders.some((o) => !knownIdsRef.current.has(o.id));
        if (hasNew && audioRef.current) playChime(audioRef.current);
      }
      knownIdsRef.current = ids;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the order queue.');
    }
  }, [session?.token]);

  useEffect(() => {
    // A captain-only login can't reach /orders/queue at all — nothing to
    // poll, and polling it anyway would just 403 every ten seconds.
    if (!canWorkQueue) return undefined;
    // load() is async — every setState inside it runs after an await, not
    // synchronously in the effect body. The lint rule can't see through the
    // promise, so it's silenced here rather than restructured.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const poll = setInterval(load, POLL_MS);
    // Separate, faster tick purely for the "waiting 6 min" counters, so they
    // move every second without re-fetching the queue every second.
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [load, canWorkQueue]);

  const enableSound = () => {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    const context = new Ctor();
    context.resume();
    audioRef.current = context;
    setSoundOn(true);
    playChime(context);
  };

  // Closing the AudioContext rather than just flipping soundOn off: a
  // suspended/closed context is what actually stops playChime from being
  // able to make sound again by accident, instead of merely hiding the badge
  // while a stray audioRef.current still works.
  const disableSound = () => {
    audioRef.current?.close();
    audioRef.current = null;
    setSoundOn(false);
  };

  const [cancelOrder, setCancelOrder] = useState(null);

  const move = async (order, status) => {
    if (status === 'CANCELLED') {
      setCancelOrder(order);
      return;
    }

    setBusyId(order.id);
    try {
      await apiPatch(`/orders/${order.id}/status`, { status }, { token: session?.token });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the order.');
    } finally {
      setBusyId(null);
    }
  };

  // A cook ticking a dish off as it leaves the pan. The server owns the tick —
  // two tablets work the same ticket — so the answer it sends back replaces
  // this one order in place. Splicing rather than re-fetching the queue keeps
  // every other card still under the cook's finger.
  const toggleItemReady = async (order, item, ready) => {
    setBusyItemId(item.id);
    try {
      const data = await apiPatch(
        `/orders/${order.id}/items/${item.id}/ready`,
        { ready },
        { token: session?.token }
      );
      setOrders((current) => (current ?? []).map((o) => (o.id === data.order.id ? data.order : o)));
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that item.');
      // Whatever went wrong, the screen is now out of step with the kitchen —
      // most likely someone else moved the order on. Take the server's word.
      await load();
    } finally {
      setBusyItemId(null);
    }
  };

  // The queue is sectioned by stage; a kitchen login never sees unaccepted orders.
  const groupBy = 'none';
  // One list, in the order the orders were received: oldest first, so a new order
  // lands at the bottom. The Status column says where each one is.
  const queue = (orders ?? [])
    .filter((o) => canAccept || o.status !== 'PENDING')
    .sort((x, y) => new Date(x.placedAt) - new Date(y.placedAt));
  const groups = queue.length ? [{ key: 'ALL', label: 'Live orders', orders: queue }] : [];

  const renderOrder = (order) => {
    // The checkboxes appear when cooking starts and not before. A ticket
    // waiting to be accepted, or sitting in the queue untouched, has nothing
    // to tick off yet; one already called ready has nothing left. Outside
    // PREPARING the lines render as plain text, so a card at rest isn't a row
    // of boxes nobody may touch. Also gated on orders.cook — Owner and
    // Reception can watch a ticket get ticked, not do the ticking themselves.
    const tickable = order.status === 'PREPARING' && canCook;
    const allReady = order.items.every((item) => item.readyAt);
    // The whole point of the ticks: the order can't be called ready until
    // every dish on it has come out of the kitchen.
    const blockedReady = !allReady && order.nextStatuses.includes('READY');

    // Accept is front-of-house, start cooking / ready is the kitchen,
    // cancel and delivered are the captain's — see STATUS_PERMISSION on the
    // backend, which enforces the same split so this is a view concern, not
    // the only guard.
    const visibleStatuses = order.nextStatuses.filter((status) =>
      status === 'CANCELLED'
        ? canTakeOrders && !allReady
        : status === 'DELIVERED'
        ? canTakeOrders && canHandOver()
        : status === 'QUEUED'
        ? canAccept
        : canCook
    );

    const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);

    return (
      <div className={`order-card order-card--${order.status.toLowerCase()}${order.items.length > 6 ? ' order-card--wide' : ''}`} key={order.id}>
        {/* Number and status on one line, everything else about the ticket on
            the next — the two things called across a kitchen are what the
            order is and what is happening to it. */}
        <div className="order-card__head">
          <span className="order-card__number">#{order.orderNumber}</span>
          <span className="order-card__badge">{STATUS_LABEL[order.status]}</span>
        </div>

        <div className="order-card__meta">
          <span className="order-card__target">{targetLabel(order)}</span>
          <SourceTag order={order} />
          <span className="order-card__sep" aria-hidden="true">
            ·
          </span>
          <span className="order-card__elapsed">{elapsedLabel(order.placedAt, now)}</span>
          <HandledBy order={order} />
        </div>

        <ul className="order-card__items">
          {renderSections(order.items, (item) => {
            const isReady = Boolean(item.readyAt);
            const className = `order-card__item${isReady ? ' order-card__item--ready' : ''}`;
            // The struck-through name and the badge stay on once cooking is
            // over — that is the record of what came out — so only the box
            // itself is conditional.
            const line = (
              <>
                <span className="order-card__qty">{item.quantity}×</span>
                <span className="order-card__item-name">{item.name}</span>
                {isReady && (
                  <span className="order-card__item-badge">{item.deliveredAt ? 'Delivered' : 'Ready'}</span>
                )}
              </>
            );

            return (
              <li key={item.id}>
                {tickable ? (
                  // A label, so the whole row is the hit target rather than the
                  // 20px box — this is tapped on a wall tablet with floury
                  // hands.
                  <label className={className}>
                    <input
                      type="checkbox"
                      className="order-card__tick"
                      checked={isReady}
                      disabled={busyItemId === item.id}
                      onChange={(e) => toggleItemReady(order, item, e.target.checked)}
                    />
                    {line}
                  </label>
                ) : (
                  <div className={className}>{line}</div>
                )}
              </li>
            );
          })}
        </ul>

        {order.note && <div className="order-card__note">“{order.note}”</div>}

        <div className="order-card__foot">
          <span className="order-card__count">
            {itemCount} item{itemCount === 1 ? '' : 's'}
          </span>
          <span className="order-card__total">{formatPrice(order.subtotal)}</span>
        </div>

        {blockedReady && canCook && (
          <p className="order-card__tick-hint">Tick every dish to call this order ready.</p>
        )}

        <div className="order-card__actions">
          {canIssue(order) && (
            <button type="button" className="order-btn" disabled={busyId === order.id} onClick={() => issueBill(order)}>
              Issue bill
            </button>
          )}
          {visibleStatuses.map((status) => (
            <button
              key={status}
              type="button"
              className={status === 'CANCELLED' ? 'order-btn order-btn--cancel' : 'order-btn'}
              disabled={busyId === order.id || (status === 'READY' && !allReady)}
              onClick={() => move(order, status)}
            >
              {ACTION_LABEL[status]}
            </button>
          ))}
        </div>
      </div>
    );
  };

  // The same live tickets as one line each — for a desk that wants to scan many
  // at once. Same rules and buttons as the card: dishes are ticked by the cook,
  // and the actions are exactly the ones the card would offer this login.
  // Orders opened in the spreadsheet. Until you click one, a cook's Preparing
  // tickets start open (they have dishes to tick); everything else starts closed.
  const [openRows, setOpenRows] = useState({});
  const renderQueueTable = (list) => (
    <section className="history-sheet history-sheet--queue">
    <div className="history-table-wrap">
      <table className="history-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Where</th>
            <th>Dishes</th>
            <th>Status</th>
            <th>Waiting</th>
            <th className="history-table__num">Total</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {list.map((order) => {
            const tickable = order.status === 'PREPARING' && canCook;
            const allReady = order.items.every((item) => item.readyAt);
            const visibleStatuses = order.nextStatuses.filter((status) =>
              status === 'CANCELLED'
                ? canTakeOrders && !allReady
                : status === 'DELIVERED'
                ? canTakeOrders && canHandOver()
                : status === 'QUEUED'
                ? canAccept
                : canCook
            );
            const isOpen = openRows[order.id] ?? tickable;
            return [
              <tr key={order.id} className={`history-table__row history-table__row--${order.status.toLowerCase()}`}>
                <td className="history-table__strong">#{order.orderNumber}</td>
                <td>
                  <span className="history-table__where">{targetLabel(order)}</span> <SourceTag order={order} />
                  <HandledBy order={order} />
                </td>
                <td className="history-table__items">
                  {(() => {
                    const secs = sectionsOf(order.items);
                    const doneCount = order.items.filter((i) => i.readyAt).length;
                    const isOpen = openRows[order.id] ?? tickable;
                    return (
                      <div className="sumline">
                        <button
                          type="button"
                          className="sumline__toggle"
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? 'Collapse' : 'Expand'} order ${order.orderNumber}`}
                          onClick={() => setOpenRows((o) => ({ ...o, [order.id]: !isOpen }))}
                        >
                          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                            <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" />
                          </svg>
                        </button>
                        <span className="sumline__frags">
                          {secs.map((g, n) => (
                            <span key={g.name}>
                              {n > 0 && ' · '}
                              {g.name} <i>{g.items.filter((i) => i.readyAt).length}/{g.items.length}</i>
                            </span>
                          ))}
                        </span>
                        <span className={`sumline__all${doneCount === order.items.length ? ' sumline__all--done' : ''}`}>
                          {doneCount === order.items.length ? 'all ready' : `${doneCount} of ${order.items.length} ready`}
                        </span>
                      </div>
                    );
                  })()}
                  {order.note && <span className="history-table__note">“{order.note}”</span>}
                </td>
                <td>
                  <span className={`history-table__status history-table__status--${order.status.toLowerCase()}`}>
                    {STATUS_LABEL[order.status]}
                  </span>
                </td>
                <td className={now - new Date(order.placedAt).getTime() > 20 * 60000 && order.status !== 'DELIVERED' ? 'history-table__late' : undefined}>
                  {elapsedLabel(order.placedAt, now)}
                </td>
                <td className="history-table__num">{formatPrice(order.subtotal)}</td>
                <td className="history-table__actions">
                  <div className="history-table__actions-inner">
                    {canIssue(order) && (
                      <button type="button" className="history-table__btn history-table__btn--primary" disabled={busyId === order.id} onClick={() => issueBill(order)}>
                        Issue bill
                      </button>
                    )}
                    {visibleStatuses.map((status) => (
                      <button
                        key={status}
                        type="button"
                        className={`history-table__btn${status === 'CANCELLED' ? ' history-table__btn--danger' : ' history-table__btn--primary'}`}
                        disabled={busyId === order.id || (status === 'READY' && !allReady)}
                        title={status === 'READY' && !allReady ? 'Tick every dish first' : undefined}
                        onClick={() => move(order, status)}
                      >
                        {ACTION_LABEL[status]}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>,
              ...(isOpen
                ? sectionsOf(order.items).map((g) => (
                    <tr key={`${order.id}-${g.name}`} className="queue-sub">
                      <td />
                      <td colSpan={6}>
                        <div className="queue-sub__row">
                          <span className="queue-sub__tag">
                            {g.name} <b>{g.items.filter((i) => i.readyAt).length}/{g.items.length}</b>
                          </span>
                          {g.items.map((item) => (
                            <label
                              key={item.id}
                              className={`history-table__item${item.readyAt ? ' history-table__item--ready' : ''}`}
                              style={tickable ? { cursor: 'pointer' } : undefined}
                            >
                              {tickable && (
                                <input
                                  type="checkbox"
                                  checked={Boolean(item.readyAt)}
                                  disabled={busyItemId === item.id}
                                  onChange={(e) => toggleItemReady(order, item, e.target.checked)}
                                />
                              )}
                              {item.quantity}× {item.name}
                            </label>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))
                : []),
            ];
          })}
        </tbody>
      </table>
    </div>
    </section>
  );

  return (
    <div className="orders-panel">
      <div className={`orders-panel__toolbar${toolsHost ? ' orders-panel__toolbar--hosted' : ''}`}>
        {/* Kitchen queue is the kitchen's own tab — a captain with no queue
            access never sees it. History (or "My orders" for a captain, who
            only gets their own back from the API) shows for either. */}
        {(canWorkQueue || canTakeOrders) && !hideTabs && (
          <div className="orders-tabs">
            {(canWorkQueue || canTakeOrders) && (
              <button
                type="button"
                className={`orders-tab${view === (canWorkQueue ? 'QUEUE' : 'ACTIVE') ? ' orders-tab--on' : ''}`}
                aria-pressed={view === (canWorkQueue ? 'QUEUE' : 'ACTIVE')}
                onClick={() => setView(canWorkQueue ? 'QUEUE' : 'ACTIVE')}
              >
                Kitchen queue
                {!canWorkQueue && guestPending > 0 && <span className="orders-tab__badge">{guestPending}</span>}
              </button>
            )}
            <button
              type="button"
              className={`orders-tab${view === 'HISTORY' ? ' orders-tab--on' : ''}`}
              aria-pressed={view === 'HISTORY'}
              onClick={() => setView('HISTORY')}
            >
              History
            </button>
          </div>
        )}

        {(toolsHost ? (node) => createPortal(node, toolsHost) : (node) => node)(
        <div className="orders-panel__tools">
          {((view === 'ACTIVE' && !canWorkQueue) || (view === 'QUEUE' && canWorkQueue)) && (
            <ViewToggle view={listView} onChange={setListView} />
          )}
          {(canWorkQueue || canTakeOrders) && (!soundOn ? (
            <button
              type="button"
              className="btn-secondary orders-panel__sound"
              onClick={enableSound}
            >
              🔔 Turn on new-order sound
            </button>
          ) : (
            <button
              type="button"
              className="btn-secondary orders-panel__sound-on"
              onClick={disableSound}
              title="Turn off new-order sound"
            >
              🔔 Sound on
            </button>
          ))}
          {canTakeOrders && (
            <button
              type="button"
              className="btn-accent"
              onClick={() => {
                setPlacedNotice('');
                setShowCounterForm(true);
              }}
            >
              + Take an order
            </button>
          )}
        </div>
        )}
      </div>

      {placedNotice && (
        <div className="form-banner form-banner--info form-banner--flash">{placedNotice}</div>
      )}

      {(view === 'HISTORY' || (view === 'ACTIVE' && !canWorkQueue)) && (canWorkQueue || canTakeOrders) && (
        <OrderHistory
          key={view}
          view={listView}
          setView={setListView}
          // A captain's queue is what is still open (in the kitchen, or served
          // but not yet billed); their history is what is settled.
          scope={canWorkQueue ? 'all' : view === 'ACTIVE' ? 'active' : 'done'}
          lodge={lodge}
          canViewBill={permissions.includes('billing.manage')}
          mine={!canWorkQueue}
          refreshKey={historyRefresh}
          canDeliver={canTakeOrders}
          onNewGuestOrders={canWorkQueue ? null : onNewGuestOrders}
          onGuestPending={
            canWorkQueue
              ? null
              : (n) => {
                  setGuestPending(n);
                  onPendingChange?.(n);
                }
          }
          onEdit={canTakeOrders ? setEditing : null}
        />
      )}

      {view === 'QUEUE' && canWorkQueue && (
        <>
          {error && (
            <div className="dash-card">
              <div className="dash-state">{error}</div>
            </div>
          )}

          {!orders && !error && (
            <div className="dash-card">
              <PageLoader inline label="Loading the queue" />
            </div>
          )}

          {orders && orders.length === 0 && (
            <div className="dash-card">
              <div className="dash-state">Nothing cooking right now.</div>
            </div>
          )}

          {queue.some((o) => o.status === 'PENDING') && (
            <div className="form-banner form-banner--info">
              {queue.filter((o) => o.status === 'PENDING').length} guest QR order(s) are waiting to be accepted — nobody has checked them yet.
            </div>
          )}

          {groups.map((g) => (
            <div className="orders-group" key={g.key}>
              <h3 className={`orders-group__title${g.key === 'PENDING' && groupBy === 'status' ? ' orders-group__title--pending' : ''}`}>
                {g.label} ({g.orders.length})
              </h3>
              {g.key === 'PENDING' && groupBy === 'status' && (
                <p className="orders-group__hint">
                  These came from a table QR, so nobody has checked them. Accept to send them to the
                  kitchen, or cancel.
                </p>
              )}
              {listView === 'sheet' ? renderQueueTable(g.orders) : <div className="orders-grid">{g.orders.map(renderOrder)}</div>}
            </div>
          ))}
        </>
      )}

      {billTab && (
        <Billing
          lodge={lodge}
          billNowTab={billTab}
          modalOnly
          onClose={() => {
            setBillTab(null);
            load();
          }}
        />
      )}

      {cancelOrder && (
        <CancelOrderDialog
          order={cancelOrder}
          onClose={() => setCancelOrder(null)}
          onDone={() => {
            setCancelOrder(null);
            load();
            setHistoryRefresh((n) => n + 1);
          }}
        />
      )}

      {editing && (
        <CounterOrderForm
          lodge={lodge}
          editOrder={editing}
          onClose={() => setEditing(null)}
          onPlaced={(order) => {
            setEditing(null);
            if (canWorkQueue) load();
            setPlacedNotice(`Order #${order.orderNumber} updated.`);
            setHistoryRefresh((n) => n + 1);
          }}
        />
      )}

      {showCounterForm && (
        <CounterOrderForm
          lodge={lodge}
          onClose={() => setShowCounterForm(false)}
          onPlaced={(order) => {
            setShowCounterForm(false);
            if (canWorkQueue) load();
            // The only confirmation a captain gets that the order actually
            // went in — the form just closes otherwise, and silence reads as
            // failure when you can't see the kitchen queue to check.
            setPlacedNotice(`Order #${order.orderNumber} sent to the kitchen.`);
            setHistoryRefresh((n) => n + 1);
            // Anyone with the queue stays on it; a captain has only My orders.
            if (!canWorkQueue) setView('HISTORY');
          }}
        />
      )}
    </div>
  );
}

// The cancel dialog every role with the right to cancel shares: pick the whole
// order or just some dishes, then a "can't be undone" confirmation. Dishes the
// kitchen has finished can't be cancelled, and any of them rules out cancelling
// the whole order — the server enforces the same.
function CancelOrderDialog({ order, onClose, onDone }) {
  const session = getSession();
  const [chosen, setChosen] = useState([]);
  const [reason, setReason] = useState('');
  // 'whole' | 'items' while the "this can't be undone" step is showing.
  const [confirm, setConfirm] = useState(null);
  const returning = Boolean(order.__return);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const confirmCancel = async (whole) => {
    setBusy(true);
    try {
      if (whole) {
        await apiPatch(`/orders/${order.id}/status`, { status: 'CANCELLED', cancelReason: reason }, { token: session?.token });
      } else {
        await apiPost(`/orders/${order.id}/items/${returning ? 'return' : 'cancel'}`, { itemIds: chosen, cancelReason: reason }, { token: session?.token });
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel.');
      setConfirm(null);
      setBusy(false);
    }
  };

  return (
        <div className="glass-backdrop counter-backdrop" onClick={() => !busy && onClose()}>
          {confirm ? (
            <div
              className="glass-panel cancel-modal"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="cancelConfirmTitle"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="cancel-modal__head">
                <span className="cancel-modal__icon" aria-hidden="true">
                  !
                </span>
                <div>
                  <h3 id="cancelConfirmTitle">
                    {confirm === 'whole'
                      ? `Cancel order #${order.orderNumber}?`
                      : `${returning ? 'Return' : 'Cancel'} ${chosen.length} dish${chosen.length === 1 ? '' : 'es'}?`}
                  </h3>
                </div>
              </div>
              <div className="cancel-modal__body">
                <div className="cancel-modal__notice">This can’t be undone. Once cancelled, it can’t be brought back.</div>
                {confirm === 'items' && (
                  <ul className="cancel-modal__items">
                    {order.items
                      .filter((i) => chosen.includes(i.id))
                      .map((i) => (
                        <li key={i.id} className="cancel-item cancel-item--picked">
                          <span className="cancel-item__qty">{i.quantity}×</span>
                          <span className="cancel-item__name">{i.name}</span>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
              <div className="cancel-modal__foot">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => setConfirm(null)}
                >
                  Go back
                </button>
                <button
                  type="button"
                  className="cancel-modal__btn cancel-modal__btn--danger"
                  disabled={busy}
                  onClick={() => confirmCancel(confirm === 'whole')}
                >
                  Yes, {returning ? 'return' : 'cancel'} {confirm === 'whole' ? 'order' : 'dishes'}
                </button>
              </div>
            </div>
          ) : (
          <div
            className="glass-panel cancel-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancelOrderTitle"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cancel-modal__head">
              <span className="cancel-modal__icon" aria-hidden="true">
                !
              </span>
              <div>
                <h3 id="cancelOrderTitle">{returning ? 'Return dishes from' : 'Cancel'} order #{order.orderNumber}</h3>
                <p className="cancel-modal__sub">{targetLabel(order)}</p>
              </div>
              <button
                type="button"
                className="menu-modal__close"
                onClick={() => onClose()}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="cancel-modal__body">
              {error && <div className="cancel-modal__notice" role="alert">{error}</div>}
              {returning ? (
                <p className="cancel-modal__hint">
                  Tick the dishes the guest is sending back. They come off the bill; the stock already used is not restored.
                </p>
              ) : order.items.some((i) => i.readyAt) ? (
                <div className="cancel-modal__notice">
                  Some dishes are already ready, so the whole order can’t be cancelled. Tick the dishes
                  you want to cancel.
                </div>
              ) : (
                <p className="cancel-modal__hint">
                  Cancel the whole order, or tick only the dishes to cancel.
                </p>
              )}

              <ul className="cancel-modal__items">
                {order.items.map((item) => {
                  const locked = returning ? !item.readyAt : Boolean(item.readyAt);
                  const picked = chosen.includes(item.id);
                  return (
                    <li key={item.id}>
                      <label
                        className={`cancel-item${picked ? ' cancel-item--picked' : ''}${locked ? ' cancel-item--locked' : ''}`}
                      >
                        <input
                          type="checkbox"
                          disabled={locked}
                          checked={picked}
                          onChange={(e) =>
                            setChosen((p) =>
                              e.target.checked ? [...p, item.id] : p.filter((x) => x !== item.id)
                            )
                          }
                        />
                        <span className="cancel-item__qty">{item.quantity}×</span>
                        <span className="cancel-item__name">{item.name}</span>
                        {locked ? (
                          <span className="cancel-item__tag">{returning ? 'Not served' : 'Ready'}</span>
                        ) : (
                          <span className="cancel-item__price">{formatPrice(item.lineTotal)}</span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>

              <div className="field">
                <label htmlFor="cancelReason">
                  Reason <span className="field__optional">optional</span>
                </label>
                <input
                  id="cancelReason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Guest changed their mind, item unavailable…"
                />
              </div>
            </div>

            <div className="cancel-modal__foot">
              <button type="button" className="btn-secondary" onClick={() => onClose()}>
                Keep order
              </button>
              <div className="cancel-modal__choices">
                <button
                  type="button"
                  className="cancel-modal__btn"
                  disabled={busy || chosen.length === 0}
                  onClick={() => setConfirm('items')}
                >
                  {returning ? 'Return' : 'Cancel'} {chosen.length || ''} selected dish{chosen.length === 1 ? '' : 'es'}
                </button>
                {!returning && !order.items.some((i) => i.readyAt) && (
                  <button
                    type="button"
                    className="cancel-modal__btn cancel-modal__btn--danger"
                    disabled={busy}
                    onClick={() => setConfirm('whole')}
                  >
                    Cancel whole order
                  </button>
                )}
              </div>
            </div>
          </div>
          )}
        </div>
  );
}

// What happened to the day's food, once it is no longer the kitchen's problem.
// Deliberately a different shape from the queue cards: those are a job to work
// through at arm's length, this is a record to read — so it is a dense list
// with times and money on it rather than a wall of tiles.
//
// The whole day is fetched and filtered here rather than through the endpoint's
// status parameter, because one service is a few dozen orders and switching
// filter shouldn't cost a round trip.
const LIVE_STATUSES = ['PENDING', 'QUEUED', 'PREPARING', 'READY'];

// The owner watches the floor but doesn't hand food over — that is the captain's.
const canHandOver = () => getSession()?.role !== 'OWNER';

function OrderHistory({ scope = 'all', view, setView, lodge = null, canViewBill = false, mine = false, refreshKey = 0, canDeliver = false, onEdit = null, onNewGuestOrders = null, onGuestPending = null }) {
  const session = getSession();
  // Today, this month (1st to today) or a custom from–to.
  const today = todayIsoLocal();
  // The captain's queue is just what is still open, so it drops the stats,
  // period and search controls (History keeps them) and looks back a month.
  const compact = scope === 'active';
  const [period, setPeriod] = useState(compact ? 'month' : 'today');
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const [from, to] =
    period === 'today' ? [today, today] : period === 'month' ? [`${today.slice(0, 8)}01`, today] : [customFrom, customTo];
  const validRange = Boolean(from && to && from <= to);
  const multiDay = from !== to;
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  // Date and orders are held together so "still loading" is derived from them
  // disagreeing, rather than kept as a third flag that can fall out of step.
  const [loaded, setLoaded] = useState({ key: null, orders: [] });
  const rangeKey = `${from}|${to}`;
  const loading = validRange && loaded.key !== rangeKey && !error;
  const [tick, setTick] = useState(0);
  const knownGuestIds = useRef(null);
  const [busyId, setBusyId] = useState(null);

  // Cancel opens CancelOrderDialog (whole order, or just some dishes) rather
  // than cancelling on the spot. `cancelling` is the order being asked about.
  const [cancelling, setCancelling] = useState(null);
  // mode 'return' opens the same dialog to send back dishes that already came out.
  const cancel = (order, mode) => setCancelling(mode === 'return' ? { ...order, __return: true } : order);
  // The issued bill an order was settled on, opened over this screen.
  const [viewInvoiceId, setViewInvoiceId] = useState(null);
  const viewBill = canViewBill ? (order) => setViewInvoiceId(order.invoiceId) : null;
  const [billTab, setBillTab] = useState(null);
  // A captain closes a fully delivered order: it leaves their queue, lands in
  // History, and appears in Billing's "Food to bill".
  const markReadyToBill = canDeliver
    ? async (o) => {
        setBusyId(o.id);
        try {
          await apiPost(`/orders/${o.id}/ready-to-bill`, {}, { token: session?.token });
        } catch (err) {
          setError(err instanceof ApiError ? err.message : 'Could not mark the order ready to bill.');
        } finally {
          setBusyId(null);
          setTick((t) => t + 1);
        }
      }
    : null;
  // Anyone who can also bill gets a direct "Issue bill": it marks the order ready
  // if it isn't yet and opens the billing dialog for its table / takeaway — no
  // separate Food to bill screen to hunt through.
  const issueBill =
    canDeliver && canViewBill
      ? Object.assign(
          async (o) => {
            setBusyId(o.id);
            try {
              if (!o.readyToBill) await apiPost(`/orders/${o.id}/ready-to-bill`, {}, { token: session?.token });
              setBillTab(
                o.source === 'TABLE'
                  ? { tab: `table-${o.tableId}`, label: o.tableLabel }
                  : o.source === 'COUNTER'
                    ? { tab: `counter-${o.id}`, label: `Takeaway #${o.orderNumber}` }
                    : { tab: `room-${o.roomId}`, label: `Room ${o.roomNumber}` }
              );
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Could not open the bill.');
            } finally {
              setBusyId(null);
              setTick((t) => t + 1);
            }
          },
          { issues: true }
        )
      : null;
  const readyToBill = issueBill || markReadyToBill;

  // A captain taking a guest's QR order in — the first to press it owns it;
  // a second captain a moment behind gets the server's "someone else just
  // updated this order".
  const accept = async (order) => {
    setBusyId(order.id);
    try {
      await apiPatch(`/orders/${order.id}/status`, { status: 'QUEUED' }, { token: session?.token });
      setTick((t) => t + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not accept the order.');
      setTick((t) => t + 1);
    } finally {
      setBusyId(null);
    }
  };

  // One dish carried out to the guest.
  const deliverItem = async (order, item) => {
    setBusyId(order.id);
    try {
      await apiPatch(`/orders/${order.id}/items/${item.id}/delivered`, {}, { token: session?.token });
      setTick((t) => t + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not mark that dish delivered.');
    } finally {
      setBusyId(null);
    }
  };

  const deliver = async (order) => {
    setBusyId(order.id);
    try {
      await apiPatch(`/orders/${order.id}/status`, { status: 'DELIVERED' }, { token: session?.token });
      setTick((t) => t + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not mark the order delivered.');
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => {
    if (!validRange) return undefined;
    let stale = false;
    apiGet(`/orders?from=${from}&to=${to}`, { token: session?.token })
      .then((data) => {
        // A slow answer for a day the user has already navigated away from
        // must not overwrite the day they are looking at now.
        if (stale) return;
        setLoaded({ key: rangeKey, orders: data.orders });
        onGuestPending?.(data.orders.filter((o) => o.guestOrder && o.status === 'PENDING').length);
        // Chime for guest orders that weren't on the previous poll. The first
        // load seeds the set silently.
        const ids = new Set(data.orders.filter((o) => o.guestOrder).map((o) => o.id));
        if (knownGuestIds.current && [...ids].some((id) => !knownGuestIds.current.has(id))) onNewGuestOrders?.();
        knownGuestIds.current = ids;
        setError('');
      })
      .catch((err) => {
        if (stale) return;
        setError(err instanceof ApiError ? err.message : 'Could not load those orders.');
      });
    return () => {
      stale = true;
    };
    // refreshKey isn't read, only bumped — it exists purely to force this
    // effect to re-run after a captain places an order on the same date,
    // the one case this screen has no other way to notice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, session?.token, refreshKey, tick]);

  // Re-fetch while a period that includes today is on screen so a captain sees dishes come out of
  // the kitchen without reloading. Past days can't change.
  useEffect(() => {
    if (to !== todayIsoLocal()) return undefined;
    const poll = setInterval(() => setTick((t) => t + 1), POLL_MS);
    return () => clearInterval(poll);
  }, [to]);

  const inScope = (o) =>
    scope === 'active' ? !o.billed && !o.readyToBill && o.status !== 'CANCELLED' : scope === 'done' ? o.billed || o.readyToBill || o.status === 'CANCELLED' : true;
  const orders = validRange ? loaded.orders.filter(inScope) : [];
  // Counts for the tiles and chips come from the whole day; the search only
  // narrows the list underneath them.
  const needle = search.trim().toLowerCase();
  const matchesSearch = (o) =>
    !needle ||
    [`#${o.orderNumber}`, o.invoiceNumber, targetLabel(o), o.guestName, o.guestPhone, o.note, ...o.items.map((i) => i.name)]
      .filter(Boolean)
      .some((text) => String(text).toLowerCase().includes(needle));
  const inFilter = (o) =>
    filter === 'ALL' ||
    (filter === 'ACTIVE'
      ? LIVE_STATUSES.includes(o.status)
      : filter === 'BILLED'
      ? o.billed
      : o.status === filter);
  const filtered = orders.filter((o) => inFilter(o) && matchesSearch(o));

  // Spreadsheet column sort: click a header to sort, again to reverse, a third
  // time to go back to the server's order (newest first).
  const [sort, setSort] = useState({ key: null, dir: 1 });
  const SORT_VALUE = {
    number: (o) => o.orderNumber,
    placed: (o) => new Date(o.placedAt).getTime(),
    where: (o) => targetLabel(o).toLowerCase(),
    status: (o) => (o.billed ? billedLabel(o) : o.readyToBill ? 'Ready to bill' : STATUS_LABEL[o.status]).toLowerCase(),
    total: (o) => o.subtotal,
    took: (o) => {
      const end = o.deliveredAt || o.cancelledAt;
      return end ? new Date(end) - new Date(o.placedAt) : Infinity;
    },
  };
  const toggleSort = (key) =>
    setSort((prev) => (prev.key !== key ? { key, dir: 1 } : prev.dir === 1 ? { key, dir: -1 } : { key: null, dir: 1 }));
  const shown =
    view === 'sheet' && sort.key
      ? [...filtered].sort((a, b) => {
          const x = SORT_VALUE[sort.key](a);
          const y = SORT_VALUE[sort.key](b);
          return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
        })
      : filtered;

  // The spreadsheet's action column only exists when some visible row has a button.
  const sheetHasActions = shown.some(
    (o) =>
      (canHandOver() && canDeliver && o.status === 'PENDING') ||
      (canHandOver() && o.status === 'READY') ||
      (viewBill && o.invoiceId != null) ||
      (onEdit && !o.billed && !o.readyToBill && o.status !== 'CANCELLED') ||
      (readyToBill && !o.billed && (readyToBill.issues || !o.readyToBill) && o.status === 'DELIVERED' && (!readyToBill.issues || o.source !== 'ROOM' || !o.bookingId)) ||
      (canDeliver && !o.billed && ['PENDING', 'QUEUED', 'PREPARING'].includes(o.status) && o.items.some((i) => !i.readyAt))
  );

  // Cancelled orders are counted but not banked — nothing was sold.
  const delivered = orders.filter((o) => o.status === 'DELIVERED');
  const cancelled = orders.filter((o) => o.status === 'CANCELLED');
  const active = orders.filter((o) => LIVE_STATUSES.includes(o.status));
  const takings = delivered.reduce((sum, o) => sum + o.subtotal, 0);

  return (
    <div className="order-history">
      {cancelling && (
        <CancelOrderDialog
          order={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            setTick((t) => t + 1);
          }}
        />
      )}

      {billTab && (
        <Billing
          lodge={lodge}
          billNowTab={billTab}
          modalOnly
          onClose={() => {
            setBillTab(null);
            setTick((t) => t + 1);
          }}
        />
      )}

      {viewInvoiceId != null && (
        <Billing lodge={lodge} viewInvoiceId={viewInvoiceId} modalOnly onClose={() => setViewInvoiceId(null)} />
      )}

      {!compact && <div className="order-history__bar">
        <div className="order-history__controls">
        {!compact && (
        <div className="ohf">
        <span className="ohf__label">Show as</span>
        <ViewToggle view={view} onChange={setView} />
        </div>
        )}

        {!compact && (
        <div className="ohf">
        <span className="ohf__label">Orders from</span>
        <div className="order-history__period">
          <div className="order-history__filters" role="group" aria-label="Period">
            {[
              ['today', 'Today'],
              ['month', 'This month'],
              ['custom', 'Custom'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`history-chip${period === key ? ' history-chip--on' : ''}`}
                aria-pressed={period === key}
                onClick={() => setPeriod(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <div className="order-history__range">
              <input type="date" aria-label="From" value={customFrom} max={today} onChange={(e) => e.target.value && setCustomFrom(e.target.value)} />
              <span>to</span>
              <input type="date" aria-label="To" value={customTo} max={today} onChange={(e) => e.target.value && setCustomTo(e.target.value)} />
            </div>
          )}
        </div>
        </div>
        )}
        </div>

        {!compact && (
        <div className="ohf ohf--search">
        <span className="ohf__label">Search this list</span>
        <input
          type="search"
          className="order-history__search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search order no., bill no., table, guest or dish…"
          aria-label="Search orders"
        />
        </div>
        )}
      </div>}

      {error && (
        <div className="dash-card">
          <div className="dash-state">{error}</div>
        </div>
      )}

      {loading && (
        <div className="dash-card">
          <PageLoader inline label="Loading that day" />
        </div>
      )}

      {!loading && !error && (
        <>
          {!compact && <div className="ohf__label ohf__label--tiles">Filter the list by status</div>}
          {!compact && <div className="order-stats">
            {[
              ['ALL', orders.length, 'Orders', ''],
              ['ACTIVE', active.length, 'In progress', 'live'],
              ['DELIVERED', delivered.length, 'Delivered', 'ok'],
              ['BILLED', orders.filter((o) => o.billed).length, 'Billed', 'billed'],
              ['CANCELLED', cancelled.length, 'Cancelled', 'bad'],
            ].map(([key, value, label, tone]) => (
              <button
                key={key}
                type="button"
                className={`order-stat${tone ? ` order-stat--${tone}` : ''}${filter === key ? ' order-stat--on' : ''}`}
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
              >
                <span className="order-stat__value">{value}</span>
                <span className="order-stat__label">{label}</span>
              </button>
            ))}
            <div className="order-stat order-stat--sales">
              <span className="order-stat__value">{formatPrice(takings)}</span>
              <span className="order-stat__label">Sales (delivered)</span>
            </div>
          </div>}

          {shown.length === 0 ? (
            <div className="dash-card">
              <div className="dash-state">
                {orders.length === 0
                  ? 'No orders in this period.'
                  : 'Nothing on that day matches this filter.'}
              </div>
            </div>
          ) : (
            // A captain gets the same cards the kitchen works from, so an
            // order looks the same on both screens; the day's record stays a
            // dense list for everyone else.
            <>
              {view === 'cards' && (mine ? (
              <div className="orders-grid">
                {shown.map((o) => renderCaptainCard(o, { canDeliver, onEdit, deliver, deliverItem, cancel, accept, viewBill, readyToBill, busy: busyId === o.id }))}
              </div>
            ) : (
              <div className="history-list">
                {shown.map((o) => renderHistoryRow(o, { canDeliver, onEdit, deliver, cancel, accept, viewBill, readyToBill, busy: busyId === o.id }))}
              </div>
            ))}
              {view === 'sheet' && (
              <section className="history-sheet">
              <div className="history-table-wrap">
                <table className="history-table">
                  <thead>
                    <tr>
                      {[
                        ['number', '#'],
                        ['placed', 'Placed'],
                        ['where', 'Where'],
                        [null, 'Dishes'],
                        ['status', 'Status'],
                        ['total', 'Total', 'history-table__num'],
                        ['took', 'Took'],
                      ].map(([key, label, cls]) => (
                        <th
                          key={label}
                          className={cls}
                          aria-sort={key && sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
                        >
                          {key ? (
                            <button
                              type="button"
                              onClick={() => toggleSort(key)}
                              style={{ all: 'inherit', cursor: 'pointer', padding: 0 }}
                              title={`Sort by ${label}`}
                            >
                              {label}
                              {sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                            </button>
                          ) : (
                            label
                          )}
                        </th>
                      ))}
                      {sheetHasActions && <th aria-label="Actions" />}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((o) => {
                      const settledAt = o.deliveredAt || o.cancelledAt;
                      const cancellable =
                        canDeliver &&
                        !o.billed &&
                        ['PENDING', 'QUEUED', 'PREPARING'].includes(o.status) &&
                        o.items.some((i) => !i.readyAt);
                      const editable = onEdit && !o.billed && !o.readyToBill && o.status !== 'CANCELLED';
                      const rowBusy = busyId === o.id;
                      return (
                        <tr key={o.id} className={`history-table__row history-table__row--${o.status.toLowerCase()}`}>
                          <td className="history-table__strong">#{o.orderNumber}</td>
                          <td>{multiDay ? dateTimeLabel(o.placedAt) : timeLabel(o.placedAt)}</td>
                          <td><span className="history-table__where">{targetLabel(o)}</span> <SourceTag order={o} />{o.handledBy && <span className="history-table__note">{o.handledBy}</span>}</td>
                          <td className="history-table__items">
                            {o.items.map((i) => (
                              <span key={i.id} className={i.readyAt ? 'history-table__item history-table__item--ready' : 'history-table__item'}>
                                {i.quantity}× {i.name}
                              </span>
                            ))}
                            {o.note && <span className="history-table__note">“{o.note}”</span>}
                          </td>
                          <td>
                            <span className={`history-table__status history-table__status--${o.billed ? 'billed' : o.status.toLowerCase()}`}>
                              {o.billed ? billedLabel(o) : o.readyToBill ? 'Ready to bill' : STATUS_LABEL[o.status]}
                            </span>
                            {o.invoiceNumber && <span className="history-table__note">Bill {o.invoiceNumber}</span>}
                          </td>
                          <td className="history-table__num">{formatPrice(o.subtotal)}</td>
                          <td>{settledAt ? elapsedLabel(o.placedAt, new Date(settledAt).getTime()) : '—'}</td>
                          {sheetHasActions && (
                          <td className="history-table__actions">
<div className="history-table__actions-inner">
                            {canHandOver() && canDeliver && o.status === 'PENDING' && (
                              <button type="button" className="history-table__btn" disabled={rowBusy} onClick={() => accept(o)}>
                                Accept
                              </button>
                            )}
                            {canHandOver() && o.status === 'READY' && (
                              <button type="button" className="history-table__btn" disabled={rowBusy} onClick={() => deliver(o)}>
                                {ACTION_LABEL.DELIVERED}
                              </button>
                            )}
                            {viewBill && o.invoiceId != null && (
                              <button type="button" className="history-table__btn" disabled={rowBusy} onClick={() => viewBill(o)}>
                                View bill
                              </button>
                            )}
                            {editable && (
                              <button type="button" className="history-table__btn" disabled={rowBusy} onClick={() => onEdit(o)}>
                                Edit
                              </button>
                            )}
                            {readyToBill && !o.billed && (readyToBill.issues || !o.readyToBill) && o.status === 'DELIVERED' && (!readyToBill.issues || o.source !== 'ROOM' || !o.bookingId) && (
                              <button type="button" className="history-table__btn" disabled={rowBusy} onClick={() => readyToBill(o)}>
                                {readyToBill.issues ? 'Issue bill' : 'Ready to bill'}
                              </button>
                            )}
                            {cancellable && (
                              <button type="button" className="history-table__btn history-table__btn--danger" disabled={rowBusy} onClick={() => cancel(o)}>
                                Cancel
                              </button>
                            )}
                          </div>
</td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// The kitchen's order card, read-only: the captain sees which dishes are ready
// to serve, and can deliver or edit — the kitchen's tick boxes are not here.
function renderCaptainCard(order, { canDeliver, onEdit, deliver, deliverItem, cancel, accept, viewBill, readyToBill, busy }) {
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const readyCount = order.items.filter((i) => i.readyAt).length;
  const settledAt = order.deliveredAt || order.cancelledAt;
  const canEdit = onEdit && !order.billed && !order.readyToBill && order.status !== 'CANCELLED';
  const canCancel =
    canDeliver && !order.billed && ['PENDING', 'QUEUED', 'PREPARING'].includes(order.status) &&
    order.items.some((i) => !i.readyAt);
  // Every dish handed over and not yet billed: the captain can send it to billing.
  const canBillNow = Boolean(readyToBill) && !order.billed && (readyToBill.issues || !order.readyToBill) && order.status === 'DELIVERED' && (!readyToBill.issues || order.source !== 'ROOM' || !order.bookingId);

  return (
    <div className={`order-card order-card--${order.status.toLowerCase()}${order.items.length > 6 ? ' order-card--wide' : ''}`} key={order.id}>
      <div className="order-card__head">
        <span className="order-card__number">#{order.orderNumber}</span>
        <span className="order-card__badge">{order.billed ? billedLabel(order) : order.readyToBill ? 'Ready to bill' : STATUS_LABEL[order.status]}</span>
      </div>

      <div className="order-card__meta">
        <span className="order-card__target">{targetLabel(order)}</span>
        <SourceTag order={order} />
        <HandledBy order={order} />
        {order.invoiceNumber && <span className="order-card__handler">Bill {order.invoiceNumber}</span>}
        <span className="order-card__sep" aria-hidden="true">
          ·
        </span>
        <span className="order-card__elapsed">
          {settledAt
            ? `took ${elapsedLabel(order.placedAt, new Date(settledAt).getTime())}`
            : elapsedLabel(order.placedAt, Date.now())}
        </span>
      </div>

      <ul className="order-card__items">
        {renderSections(order.items, (item) => {
          const isReady = Boolean(item.readyAt);
          return (
            <li key={item.id}>
              <div className={`order-card__item${isReady ? ' order-card__item--ready' : ''}`}>
                <span className="order-card__qty">{item.quantity}×</span>
                <span className="order-card__item-name">{item.name}</span>
                {item.deliveredAt ? (
                  <span className="order-card__item-badge">Delivered</span>
                ) : isReady ? (
                  <>
                    <span className="order-card__item-badge">Ready</span>
                    {canHandOver() && ['PREPARING', 'READY'].includes(order.status) && (
                      <button
                        type="button"
                        className="order-btn"
                        disabled={busy}
                        onClick={() => deliverItem(order, item)}
                      >
                        Deliver
                      </button>
                    )}
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {order.note && <div className="order-card__note">“{order.note}”</div>}

      <div className="order-card__foot">
        <span className="order-card__count">
          {itemCount} item{itemCount === 1 ? '' : 's'}
          {order.status === 'PREPARING' && readyCount > 0 && ` · ${readyCount} ready`}
        </span>
        <span className="order-card__total">{formatPrice(order.subtotal)}</span>
      </div>

      {order.cancelReason && <p className="order-card__tick-hint">Cancelled: {order.cancelReason}</p>}

      {((canHandOver() && (order.status === 'READY' || order.status === 'PENDING')) || (viewBill && order.invoiceId != null) || canEdit || canCancel || canBillNow) && (
        <div className="order-card__actions">
          {canHandOver() && canDeliver && order.status === 'PENDING' && (
            <button type="button" className="order-btn" disabled={busy} onClick={() => accept(order)}>
              Accept
            </button>
          )}
          {canHandOver() && order.status === 'READY' && (
            <button type="button" className="order-btn" disabled={busy} onClick={() => deliver(order)}>
              {ACTION_LABEL.DELIVERED}
            </button>
          )}
          {canEdit && (
            <button type="button" className="order-btn" disabled={busy} onClick={() => onEdit(order)}>
              Edit order
            </button>
          )}
          {viewBill && order.invoiceId != null && (
            <button type="button" className="order-btn" disabled={busy} onClick={() => viewBill(order)}>
              View bill
            </button>
          )}
          {canBillNow && (
            <button type="button" className="order-btn" disabled={busy} onClick={() => readyToBill(order)}>
              {readyToBill.issues ? 'Issue bill' : 'Ready to bill'}
            </button>
          )}
          {canCancel && (
            <button type="button" className="order-btn order-btn--cancel" disabled={busy} onClick={() => cancel(order)}>
              {ACTION_LABEL.CANCELLED}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function renderHistoryRow(order, { canDeliver, onEdit, deliver, cancel, accept, viewBill, readyToBill, busy }) {
  const canCancel = canDeliver && !order.billed && ['PENDING', 'QUEUED', 'PREPARING'].includes(order.status) &&
    order.items.some((i) => !i.readyAt);
  // Every dish handed over and not yet billed: the captain can send it to billing.
  const canBillNow = Boolean(readyToBill) && !order.billed && (readyToBill.issues || !order.readyToBill) && order.status === 'DELIVERED' && (!readyToBill.issues || order.source !== 'ROOM' || !order.bookingId);
  // How long the kitchen actually had it. Only honest once the order has
  // landed somewhere — a live one is still running.
  const settledAt = order.deliveredAt || order.cancelledAt;

  return (
    <div className={`history-row history-row--${order.status.toLowerCase()}`} key={order.id}>
      <div className="history-row__head">
        <span className="history-row__number">#{order.orderNumber}</span>
        <span className="history-row__target">{targetLabel(order)}</span>
        <SourceTag order={order} />
        <span className="history-row__badge">{order.billed ? billedLabel(order) : order.readyToBill ? 'Ready to bill' : STATUS_LABEL[order.status]}</span>
        {order.status === 'PREPARING' && order.items.some((i) => i.readyAt) && (
          <span className="history-row__ready">
            {order.items.filter((i) => i.readyAt).length} of {order.items.length} ready
          </span>
        )}
        <span className="history-row__total">{formatPrice(order.subtotal)}</span>
      </div>

      <div className="history-row__times">
        <span>Placed {timeLabel(order.placedAt)}</span>
        {order.invoiceNumber && <span>Bill {order.invoiceNumber}</span>}
        {order.deliveredAt && <span>Delivered {timeLabel(order.deliveredAt)}</span>}
        {order.cancelledAt && <span>Cancelled {timeLabel(order.cancelledAt)}</span>}
        {settledAt && <span>took {elapsedLabel(order.placedAt, new Date(settledAt).getTime())}</span>}
      </div>

      <ul className="history-row__items">
        {renderSections(order.items, (item) => (
          <li key={item.id}>
            <span className="history-row__qty">{item.quantity}×</span>
            <span>{item.name}</span>
            {item.readyAt && (
              <span
                className={`history-row__ready${item.deliveredAt || order.status === 'DELIVERED' ? ' history-row__ready--done' : ''}`}
              >
                {item.deliveredAt || order.status === 'DELIVERED' ? 'Delivered' : 'Ready – serve'}
              </span>
            )}
          </li>
        ))}
      </ul>

      {order.note && <div className="history-row__note">“{order.note}”</div>}

      {order.cancelReason && (
        <div className="history-row__reason">Cancelled because: {order.cancelReason}</div>
      )}

      {((canHandOver() && (order.status === 'READY' || order.status === 'PENDING')) ||
        (viewBill && order.invoiceId != null) ||
        canCancel ||
        canBillNow ||
        (onEdit && !order.billed && !order.readyToBill && order.status !== 'CANCELLED')) && (
        <div className="history-row__actions">
          {canHandOver() && canDeliver && order.status === 'PENDING' && (
            <button type="button" className="order-btn" disabled={busy} onClick={() => accept(order)}>
              Accept
            </button>
          )}
          {canHandOver() && order.status === 'READY' && (
            <button type="button" className="order-btn" disabled={busy} onClick={() => deliver(order)}>
              {ACTION_LABEL.DELIVERED}
            </button>
          )}
          {onEdit && !order.billed && !order.readyToBill && order.status !== 'CANCELLED' && (
            <button type="button" className="order-btn" disabled={busy} onClick={() => onEdit(order)}>
              Edit order
            </button>
          )}
          {viewBill && order.invoiceId != null && (
            <button type="button" className="order-btn" disabled={busy} onClick={() => viewBill(order)}>
              View bill
            </button>
          )}
          {canBillNow && (
            <button type="button" className="order-btn" disabled={busy} onClick={() => readyToBill(order)}>
              {readyToBill.issues ? 'Issue bill' : 'Ready to bill'}
            </button>
          )}
          {canCancel && (
            <button type="button" className="order-btn order-btn--cancel" disabled={busy} onClick={() => cancel(order)}>
              {ACTION_LABEL.CANCELLED}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// One stepper, wherever it sits — on a dish with no sizes it's the dish's own
// row, on a dish with sizes it's one per size.
function Stepper({ qty, onChange, label }) {
  return (
    <div className="counter-line__qty">
      <button
        type="button"
        onClick={() => onChange(qty - 1)}
        disabled={qty === 0}
        aria-label={`One less ${label}`}
      >
        −
      </button>
      <span>{qty}</span>
      <button type="button" onClick={() => onChange(qty + 1)} aria-label={`One more ${label}`}>
        +
      </button>
    </div>
  );
}

// Reception typing an order in — the phone rings, or someone orders at the
// counter. Same queue, same kitchen screen; it just skips the accept step
// because a member of staff already took it.
//
// The menu here runs past a hundred dishes, so it is browsed a section at a
// time with a search across all of them rather than dumped into one scroll.
// The running order stays pinned below it: a phone order is read out in one
// pass, and whoever is typing needs to see what they have so far without
// scrolling away from the dish they are on.
function CounterOrderForm({ lodge, onClose, onPlaced, editOrder = null }) {
  const session = getSession();
  // Dishes the kitchen has already ticked off can't be changed; the cart holds
  // only the rest (see replaceOrderItems on the backend).
  const cookedLines = editOrder?.items.filter((i) => i.readyAt) ?? [];
  const [sections, setSections] = useState(null);
  const [tables, setTables] = useState(() => readCache('/tables:active') ?? []);
  const [rooms, setRooms] = useState(() => readCache('/rooms:occupied') ?? []);
  const [cart, setCart] = useState(() =>
    Object.fromEntries(
      (editOrder?.items ?? [])
        .filter((i) => !i.readyAt)
        .map((i) => [i.portionId ? `${i.menuItemId}:${i.portionId}` : String(i.menuItemId), i.quantity])
    )
  );
  const [target, setTarget] = useState({ kind: 'COUNTER', id: '' });
  const [note, setNote] = useState(editOrder?.note ?? '');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [query, setQuery] = useState('');
  const [activeSectionId, setActiveSectionId] = useState(null);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // The banner sits above a menu that can run to a hundred dishes, so a
  // failure caught on submit — a missing guest name, the server refusing —
  // has to bring itself back into view rather than rely on already being in
  // it. Same shape as the booking form's failOn/reportFormError.
  const errorRef = useRef(null);
  const reportError = (message) => {
    setError(message);
    requestAnimationFrame(() => {
      errorRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };
  const failOn = (id, message) => {
    setFieldError({ id, message });
    const el = document.getElementById(id);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  const fieldErr = (id) =>
    id && fieldError?.id === id ? <p className="field__error">{fieldError.message}</p> : null;
  const invalid = (id) => Boolean(id) && fieldError?.id === id;
  // Who is checked into the selected room, so staff can eyeball the register
  // before charging food to somebody's stay. null while nothing is selected.
  const [occupancy, setOccupancy] = useState(null);
  const [occupancyLoading, setOccupancyLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      apiGet('/menu', { token: session?.token }),
      lodge?.foodTableService ? apiGet('/tables', { token: session?.token }) : Promise.resolve({ tables: [] }),
      lodge?.foodRoomService ? apiGet('/rooms', { token: session?.token }) : Promise.resolve({ rooms: [] }),
    ])
      .then(([menuData, tablesData, roomsData]) => {
        setSections(menuData.sections);
        setTables(writeCache('/tables:active', tablesData.tables.filter((t) => t.isActive)));
        setRooms(writeCache('/rooms:occupied', roomsData.rooms.filter((r) => r.isActive && r.isOccupied)));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the menu.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, submitting]);

  // Selecting a room asks the server who is in it. Resolved server-side against
  // the live booking rather than read off the room list, so what staff verify
  // against is the register itself and not a stale cached payload.
  //
  // The room id is captured per-run and checked before the result is applied:
  // a quick change of selection can land two responses out of order, and the
  // wrong guest shown next to the wrong room is exactly the error this is here
  // to prevent.
  useEffect(() => {
    // Cleared by the destination handler rather than here, so this effect only
    // ever runs for a room it is actually going to look up.
    if (target.kind !== 'ROOM' || !target.id) return undefined;

    let cancelled = false;
    const roomId = target.id;

    apiGet(`/orders/room-occupancy/${roomId}`, { token: session?.token })
      .then((data) => {
        if (cancelled) return;
        setOccupancy(data.occupancy);
      })
      .catch(() => {
        // A lookup failure must not block the order — the desk can still take
        // it. The panel just says it couldn't check rather than asserting the
        // room is empty, which would be a worse lie than saying nothing.
        if (!cancelled) setOccupancy({ failed: true });
      })
      .finally(() => {
        if (!cancelled) setOccupancyLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.kind, target.id]);

  // A half plate and a full plate of the same dish are two lines, so the key is
  // the pair — the same shape the guest's own page uses.
  const cartKey = (itemId, portionId) => (portionId ? `${itemId}:${portionId}` : String(itemId));

  const setQty = (itemId, portionId, quantity) => {
    setCart((c) => {
      const next = { ...c };
      const key = cartKey(itemId, portionId);
      if (quantity <= 0) delete next[key];
      else next[key] = quantity;
      return next;
    });
  };

  // Only what the kitchen could actually cook right now: the owner's retired
  // dishes and whatever ran out this evening are both off the list. A dish
  // sold by size whose every size has run out goes too, exactly as it does on
  // the guest's menu — there is nothing left to order.
  const sellable = (sections ?? [])
    .filter((section) => section.isActive)
    .map((section) => ({
      ...section,
      items: section.items
        .filter((item) => item.isAvailable && item.isActive)
        .map((item) => ({
          ...item,
          hadSizes: item.portions.length > 0,
          portions: item.portions.filter((p) => p.isAvailable),
        }))
        .filter((item) => !item.hadSizes || item.portions.length > 0),
    }))
    .filter((section) => section.items.length > 0);

  const needle = query.trim().toLowerCase();
  const searching = needle !== '';
  const activeSection =
    sellable.find((s) => String(s.id) === String(activeSectionId)) ?? sellable[0] ?? null;

  const shownSections = searching
    ? sellable
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => item.name.toLowerCase().includes(needle)),
        }))
        .filter((section) => section.items.length > 0)
    : activeSection
    ? [activeSection]
    : [];

  const allItems = sellable.flatMap((s) => s.items);
  const lines = Object.entries(cart)
    .map(([key, quantity]) => {
      const [itemId, portionId] = key.split(':');
      const item = allItems.find((i) => String(i.id) === String(itemId));
      if (!item) return null;
      const portion = portionId ? item.portions.find((p) => String(p.id) === String(portionId)) : null;
      if (portionId && !portion) return null;
      return {
        key,
        itemId: item.id,
        portionId: portion?.id ?? null,
        name: portion ? `${item.name} (${portion.label})` : item.name,
        price: portion ? portion.price : item.price,
        quantity,
      };
    })
    .filter(Boolean);

  const total = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const count = lines.reduce((sum, l) => sum + l.quantity, 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setFieldError(null);

    // Checked in the order the fields sit on the form — guest details before
    // the menu — the same order every other form here checks in, so the
    // first thing reported is the first thing the eye would reach scrolling
    // down from the top rather than whichever check happens to run first.
    if (!editOrder && target.kind === 'COUNTER') {
      if (!guestName.trim()) {
        failOn('orderGuest', 'Add the guest’s name for a counter order.');
        return;
      }
      if (!guestPhone.trim()) {
        failOn('orderPhone', 'Add a phone number for a counter order.');
        return;
      }
      if (!isMobile(guestPhone)) {
        failOn('orderPhone', 'Enter a valid 10-digit mobile number.');
        return;
      }
    }

    // No banner here: the note beside the room picker already says this, and
    // the button reaching this point at all means it was bypassed rather than
    // clicked — nothing new to tell the user that isn't on screen already.
    if (target.kind === 'ROOM' && occupancy && !occupancy.failed && !occupancy.occupied) {
      return;
    }

    if (lines.length === 0 && cookedLines.length === 0) {
      reportError('Add at least one item.');
      return;
    }

    setSubmitting(true);
    try {
      if (editOrder) {
        const data = await apiPatch(
          `/orders/${editOrder.id}/items`,
          {
            note,
            items: lines.map((l) => ({ itemId: l.itemId, portionId: l.portionId, quantity: l.quantity })),
          },
          { token: session?.token }
        );
        onPlaced(data.order);
        return;
      }
      const placed = await apiPost(
        '/orders',
        {
          roomId: target.kind === 'ROOM' ? target.id : null,
          tableId: target.kind === 'TABLE' ? target.id : null,
          // Typed at the counter and then switched to a room, these would
          // otherwise ride along on an order whose payer is the booking.
          guestName: target.kind === 'COUNTER' ? guestName : '',
          guestPhone: target.kind === 'COUNTER' ? guestPhone : '',
          note,
          items: lines.map((l) => ({
            itemId: l.itemId,
            portionId: l.portionId,
            quantity: l.quantity,
          })),
        },
        { token: session?.token }
      );
      onPlaced(placed);
    } catch (err) {
      reportError(err instanceof ApiError ? err.message : 'Could not place the order.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="glass-backdrop counter-backdrop" onClick={() => !submitting && onClose()}>
      <div
        className="glass-panel counter-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="counterOrderTitle"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="menu-modal__head">
          <div>
            <h3 id="counterOrderTitle">{editOrder ? `Edit order #${editOrder.orderNumber}` : 'Take an order'}</h3>
            <p className="menu-modal__sub">
              {editOrder
                ? 'Change what is still to be cooked. Dishes already ready stay as they are.'
                : 'Goes straight into the kitchen queue — staff took it, so it skips the accept step.'}
            </p>
          </div>
          <button
            type="button"
            className="menu-modal__close"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form className="counter-form" onSubmit={handleSubmit} noValidate>
          <div className="counter-form__scroll">
            {error && (
              <div ref={errorRef} className="form-banner form-banner--error form-banner--flash">
                {error}
              </div>
            )}

            {cookedLines.length > 0 && (
              <p className="menu-panel__hint">
                Already ready: {cookedLines.map((l) => `${l.quantity}× ${l.name}`).join(', ')}
              </p>
            )}

            {!editOrder && (
            <div className="field">
              <label htmlFor="orderTarget">Where&apos;s it going?</label>
              <select
                id="orderTarget"
                value={`${target.kind}:${target.id}`}
                onChange={(e) => {
                  const [kind, id] = e.target.value.split(':');
                  setTarget({ kind, id });
                  // Reset here, where the choice is made, so the previous
                  // room's guest never lingers beside a new selection.
                  setOccupancy(null);
                  setOccupancyLoading(kind === 'ROOM' && !!id);
                }}
              >
                <option value="COUNTER:">Counter / takeaway</option>
                {rooms.map((r) => (
                  <option key={`room-${r.id}`} value={`ROOM:${r.id}`}>
                    Room {r.roomNumber}
                  </option>
                ))}
                {tables.map((t) => (
                  <option key={`table-${t.id}`} value={`TABLE:${t.id}`}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            )}

            {!editOrder && target.kind === 'ROOM' && (
              <div className="occupancy" aria-live="polite">
                {occupancyLoading && <p className="occupancy__muted">Checking who&apos;s in this room…</p>}

                {!occupancyLoading && occupancy?.failed && (
                  <p className="occupancy__muted">
                    Couldn&apos;t check the register just now — confirm the guest at the desk.
                  </p>
                )}

                {!occupancyLoading && occupancy && !occupancy.failed && occupancy.occupied && (
                  <>
                    <p className="occupancy__label">Checked in to this room</p>
                    <p className="occupancy__name">{occupancy.guestName || 'Name not on the booking'}</p>
                    {occupancy.guestPhone && <p className="occupancy__phone">{occupancy.guestPhone}</p>}
                    <p className="occupancy__hint">
                      Check this matches the guest ordering before you charge it to the room.
                    </p>
                  </>
                )}

                {!occupancyLoading && occupancy && !occupancy.failed && !occupancy.occupied && (
                  <p className="occupancy__vacant occupancy__vacant--error" role="alert">
                    Nobody is checked in to this room. Select a different room, or the counter, to place
                    this order.
                  </p>
                )}
              </div>
            )}

            {/* Only the counter asks for these. A room or a table already
                identifies the payer — the booking above, or the table the
                party is sitting at — so re-typing a name there would be a
                second, weaker record of something the register already knows.
                A takeaway has neither: this is the only trace of who the food
                is for, so it is required rather than optional. */}
            {!editOrder && target.kind === 'COUNTER' && (
              <div className="field-row">
                <div className="field">
                  <label htmlFor="orderGuest">
                    Guest name
                    <Req />
                  </label>
                  <input
                    id="orderGuest"
                    aria-invalid={invalid('orderGuest')}
                    value={guestName}
                    onChange={(e) => setGuestName(capitalizeName(e.target.value))}
                    placeholder="Who's collecting"
                  />
                  {fieldErr('orderGuest')}
                </div>
                <div className="field">
                  <label htmlFor="orderPhone">
                    Phone
                    <Req />
                  </label>
                  <input
                    id="orderPhone"
                    inputMode="tel"
                    aria-invalid={invalid('orderPhone')}
                    value={guestPhone}
                    onChange={(e) => setGuestPhone(typedMobile(e.target.value))}
                    placeholder="To call when it's ready"
                  />
                  {fieldErr('orderPhone')}
                </div>
              </div>
            )}

            {!sections && <PageLoader inline label="Loading the menu" />}

            {sections && sellable.length === 0 && (
              <p className="menu-panel__hint">Nothing on the menu is available right now.</p>
            )}

            {sellable.length > 0 && (
              <>
                <div className="counter-find">
                  <div className="menu-search">
                    <span className="menu-search__icon" aria-hidden="true" />
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search every section…"
                      aria-label="Search the menu"
                    />
                  </div>
                  {!searching && sellable.length > 1 && (
                    <select
                      className="counter-find__section"
                      value={activeSection?.id ?? ''}
                      aria-label="Menu section"
                      onChange={(e) => setActiveSectionId(e.target.value)}
                    >
                      {sellable.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.items.length})
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {shownSections.length === 0 && (
                  <p className="menu-panel__hint">Nothing matches that.</p>
                )}

                {shownSections.map((section) => (
                  <div className="counter-section" key={section.id}>
                    {searching && <div className="form-section__title">{section.name}</div>}
                    {section.items.map((item) => (
                      <div className="counter-line" key={item.id}>
                        <div className="counter-line__main">
                          <FoodTypeMark type={item.foodType} />
                          <span className="counter-line__name">{item.name}</span>
                          {item.portions.length === 0 && (
                            <>
                              <span className="counter-line__price">{formatPrice(item.price)}</span>
                              <Stepper
                                qty={cart[cartKey(item.id, null)] || 0}
                                onChange={(q) => setQty(item.id, null, q)}
                                label={item.name}
                              />
                            </>
                          )}
                        </div>

                        {item.portions.length > 0 && (
                          <div className="counter-line__sizes">
                            {item.portions.map((portion) => (
                              <div className="counter-line__size" key={portion.id}>
                                <span className="counter-line__size-label">{portion.label}</span>
                                <span className="counter-line__price">
                                  {formatPrice(portion.price)}
                                </span>
                                <Stepper
                                  qty={cart[cartKey(item.id, portion.id)] || 0}
                                  onChange={(q) => setQty(item.id, portion.id, q)}
                                  label={`${item.name}, ${portion.label}`}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </>
            )}

            <div className="field">
              <label htmlFor="orderNote">
                Note for the kitchen <span className="field__optional">optional</span>
              </label>
              <input
                id="orderNote"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Less spicy, no onion"
              />
            </div>
          </div>

          <div className="counter-summary">
            {lines.length === 0 ? (
              <p className="counter-summary__empty">Nothing added yet.</p>
            ) : (
              <ul className="counter-summary__lines">
                {lines.map((line) => (
                  <li key={line.key}>
                    <span className="counter-summary__qty">{line.quantity}×</span>
                    <span className="counter-summary__name">{line.name}</span>
                    <span className="counter-summary__amount">
                      {formatPrice(line.price * line.quantity)}
                    </span>
                    <button
                      type="button"
                      className="counter-summary__remove"
                      onClick={() => setQty(line.itemId, line.portionId, 0)}
                      aria-label={`Remove ${line.name}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="counter-foot">
              <span className="counter-total">
                {count > 0 && (
                  <span className="counter-total__count">
                    {count} item{count === 1 ? '' : 's'}
                  </span>
                )}
                {formatPrice(total)}
              </span>
              <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              {/* Not disabled on an empty cart: a disabled button gives no
                  feedback at all when pressed, which is why "Add at least one
                  item" was never seen. Left enabled, the click reaches
                  handleSubmit and its own check reports the problem instead.
                  An unoccupied room is different — there is no way to fix that
                  from this form, so the button is blocked outright rather than
                  handing back an error the guest-name field can't fix. */}
              <button
                type="submit"
                className="btn-accent"
                disabled={
                  submitting ||
                  (target.kind === 'ROOM' && occupancy && !occupancy.failed && !occupancy.occupied)
                }
              >
                {editOrder ? (submitting ? 'Saving…' : 'Save changes') : submitting ? 'Placing…' : 'Place order'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

