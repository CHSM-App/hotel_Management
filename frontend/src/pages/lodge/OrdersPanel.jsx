import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, apiPatch, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { readCache, writeCache } from '../../lib/dataCache';
import { formatPrice } from './priceFormat';
import './forms.css';
import './MenuPanel.css';
import './OrdersPanel.css';

const POLL_MS = 10000;

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
function targetLabel(order) {
  if (order.source === 'ROOM') return `Room ${order.roomNumber}`;
  if (order.source === 'TABLE') return order.tableLabel;
  return 'Counter';
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

export default function OrdersPanel({ lodge }) {
  const session = getSession();
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
  const [view, setView] = useState('QUEUE');

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
  }, [load]);

  const enableSound = () => {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    const context = new Ctor();
    context.resume();
    audioRef.current = context;
    setSoundOn(true);
    playChime(context);
  };

  const move = async (order, status) => {
    let cancelReason = '';
    if (status === 'CANCELLED') {
      const reason = window.prompt(`Why is order #${order.orderNumber} being cancelled?`);
      if (reason === null) return;
      cancelReason = reason;
    }

    setBusyId(order.id);
    try {
      await apiPatch(`/orders/${order.id}/status`, { status, cancelReason }, { token: session?.token });
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

  const pending = orders?.filter((o) => o.status === 'PENDING') ?? [];
  const live = orders?.filter((o) => o.status !== 'PENDING') ?? [];

  const renderOrder = (order) => {
    // The checkboxes appear when cooking starts and not before. A ticket
    // waiting to be accepted, or sitting in the queue untouched, has nothing
    // to tick off yet; one already called ready has nothing left. Outside
    // PREPARING the lines render as plain text, so a card at rest isn't a row
    // of boxes nobody may touch.
    const tickable = order.status === 'PREPARING';
    const allReady = order.items.every((item) => item.readyAt);
    // The whole point of the ticks: the order can't be called ready until
    // every dish on it has come out of the kitchen.
    const blockedReady = !allReady && order.nextStatuses.includes('READY');

    const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);

    return (
      <div className={`order-card order-card--${order.status.toLowerCase()}`} key={order.id}>
        {/* Number and status on one line, everything else about the ticket on
            the next — the two things called across a kitchen are what the
            order is and what is happening to it. */}
        <div className="order-card__head">
          <span className="order-card__number">#{order.orderNumber}</span>
          <span className="order-card__badge">{STATUS_LABEL[order.status]}</span>
        </div>

        <div className="order-card__meta">
          <span className="order-card__target">{targetLabel(order)}</span>
          <span className="order-card__sep" aria-hidden="true">
            ·
          </span>
          <span className="order-card__elapsed">{elapsedLabel(order.placedAt, now)}</span>
        </div>

        <ul className="order-card__items">
          {order.items.map((item) => {
            const isReady = Boolean(item.readyAt);
            const className = `order-card__item${isReady ? ' order-card__item--ready' : ''}`;
            // The struck-through name and the badge stay on once cooking is
            // over — that is the record of what came out — so only the box
            // itself is conditional.
            const line = (
              <>
                <span className="order-card__qty">{item.quantity}×</span>
                <span className="order-card__item-name">{item.name}</span>
                {isReady && <span className="order-card__item-badge">Ready</span>}
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

        {blockedReady && (
          <p className="order-card__tick-hint">Tick every dish to call this order ready.</p>
        )}

        <div className="order-card__actions">
          {order.nextStatuses.map((status) => (
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

  return (
    <div className="orders-panel">
      <div className="orders-panel__toolbar">
        {/* The queue keeps polling behind the history tab on purpose — the
            chime is the alert, and it has to sound whichever tab is open. */}
        <div className="orders-tabs">
          <button
            type="button"
            className={`orders-tab${view === 'QUEUE' ? ' orders-tab--on' : ''}`}
            aria-pressed={view === 'QUEUE'}
            onClick={() => setView('QUEUE')}
          >
            Kitchen queue
          </button>
          <button
            type="button"
            className={`orders-tab${view === 'HISTORY' ? ' orders-tab--on' : ''}`}
            aria-pressed={view === 'HISTORY'}
            onClick={() => setView('HISTORY')}
          >
            History
          </button>
        </div>

        <div className="orders-panel__tools">
          {!soundOn ? (
            <button
              type="button"
              className="btn-secondary orders-panel__sound"
              onClick={enableSound}
            >
              🔔 Turn on new-order sound
            </button>
          ) : (
            <span className="orders-panel__sound-on">🔔 Sound on</span>
          )}
          <button type="button" className="btn-accent" onClick={() => setShowCounterForm(true)}>
            + Take an order
          </button>
        </div>
      </div>

      {view === 'HISTORY' && <OrderHistory />}

      {view === 'QUEUE' && (
        <>
          {error && (
            <div className="dash-card">
              <div className="dash-state">{error}</div>
            </div>
          )}

          {!orders && !error && (
            <div className="dash-card">
              <div className="dash-state">Loading the queue…</div>
            </div>
          )}

          {orders && orders.length === 0 && (
            <div className="dash-card">
              <div className="dash-state">Nothing cooking right now.</div>
            </div>
          )}

          {pending.length > 0 && (
            <div className="orders-group">
              <h3 className="orders-group__title orders-group__title--pending">
                Waiting for you to accept ({pending.length})
              </h3>
              <p className="orders-group__hint">
                These came from a table QR, so nobody has checked them. Accept to send them to the
                kitchen, or cancel.
              </p>
              <div className="orders-grid">{pending.map(renderOrder)}</div>
            </div>
          )}

          {live.length > 0 && (
            <div className="orders-group">
              <h3 className="orders-group__title">In the kitchen ({live.length})</h3>
              <div className="orders-grid">{live.map(renderOrder)}</div>
            </div>
          )}
        </>
      )}

      {showCounterForm && (
        <CounterOrderForm
          lodge={lodge}
          onClose={() => setShowCounterForm(false)}
          onPlaced={() => {
            setShowCounterForm(false);
            load();
          }}
        />
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
const HISTORY_FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'DELIVERED', label: 'Delivered' },
  { key: 'CANCELLED', label: 'Cancelled' },
];

function OrderHistory() {
  const session = getSession();
  const [date, setDate] = useState(todayIsoLocal);
  const [filter, setFilter] = useState('ALL');
  const [error, setError] = useState('');
  // Date and orders are held together so "still loading" is derived from them
  // disagreeing, rather than kept as a third flag that can fall out of step.
  const [loaded, setLoaded] = useState({ date: null, orders: [] });
  const loading = loaded.date !== date && !error;

  useEffect(() => {
    let stale = false;
    apiGet(`/orders?date=${date}`, { token: session?.token })
      .then((data) => {
        // A slow answer for a day the user has already navigated away from
        // must not overwrite the day they are looking at now.
        if (stale) return;
        setLoaded({ date, orders: data.orders });
        setError('');
      })
      .catch((err) => {
        if (stale) return;
        setError(err instanceof ApiError ? err.message : 'Could not load that day’s orders.');
      });
    return () => {
      stale = true;
    };
  }, [date, session?.token]);

  const orders = loaded.orders;
  const shown = filter === 'ALL' ? orders : orders.filter((o) => o.status === filter);

  // Cancelled orders are counted but not banked — nothing was sold.
  const delivered = orders.filter((o) => o.status === 'DELIVERED');
  const takings = delivered.reduce((sum, o) => sum + o.subtotal, 0);

  return (
    <div className="order-history">
      <div className="order-history__bar">
        <label className="order-history__date">
          <span>Day</span>
          <input
            type="date"
            value={date}
            max={todayIsoLocal()}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </label>

        <div className="order-history__filters">
          {HISTORY_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`history-chip${filter === key ? ' history-chip--on' : ''}`}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="dash-card">
          <div className="dash-state">{error}</div>
        </div>
      )}

      {loading && (
        <div className="dash-card">
          <div className="dash-state">Loading that day…</div>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="order-history__summary">
            <div>
              <span className="order-history__stat">{delivered.length}</span>
              <span className="order-history__stat-label">delivered</span>
            </div>
            <div>
              <span className="order-history__stat">{formatPrice(takings)}</span>
              <span className="order-history__stat-label">taken</span>
            </div>
            <div>
              <span className="order-history__stat">{orders.length}</span>
              <span className="order-history__stat-label">orders in all</span>
            </div>
          </div>

          {shown.length === 0 ? (
            <div className="dash-card">
              <div className="dash-state">
                {orders.length === 0
                  ? 'No orders on that day.'
                  : 'Nothing on that day matches this filter.'}
              </div>
            </div>
          ) : (
            <div className="history-list">{shown.map(renderHistoryRow)}</div>
          )}
        </>
      )}
    </div>
  );
}

function renderHistoryRow(order) {
  // How long the kitchen actually had it. Only honest once the order has
  // landed somewhere — a live one is still running.
  const settledAt = order.deliveredAt || order.cancelledAt;

  return (
    <div className={`history-row history-row--${order.status.toLowerCase()}`} key={order.id}>
      <div className="history-row__head">
        <span className="history-row__number">#{order.orderNumber}</span>
        <span className="history-row__target">{targetLabel(order)}</span>
        <span className="history-row__badge">{STATUS_LABEL[order.status]}</span>
        <span className="history-row__total">{formatPrice(order.subtotal)}</span>
      </div>

      <div className="history-row__times">
        <span>Placed {timeLabel(order.placedAt)}</span>
        {order.deliveredAt && <span>Delivered {timeLabel(order.deliveredAt)}</span>}
        {order.cancelledAt && <span>Cancelled {timeLabel(order.cancelledAt)}</span>}
        {settledAt && <span>took {elapsedLabel(order.placedAt, new Date(settledAt).getTime())}</span>}
      </div>

      <ul className="history-row__items">
        {order.items.map((item) => (
          <li key={item.id}>
            <span className="history-row__qty">{item.quantity}×</span>
            <span>{item.name}</span>
          </li>
        ))}
      </ul>

      {order.note && <div className="history-row__note">“{order.note}”</div>}

      {order.cancelReason && (
        <div className="history-row__reason">Cancelled because: {order.cancelReason}</div>
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
function CounterOrderForm({ lodge, onClose, onPlaced }) {
  const session = getSession();
  const [sections, setSections] = useState(null);
  const [tables, setTables] = useState(() => readCache('/tables:active') ?? []);
  const [rooms, setRooms] = useState(() => readCache('/rooms:active') ?? []);
  const [cart, setCart] = useState({});
  const [target, setTarget] = useState({ kind: 'COUNTER', id: '' });
  const [note, setNote] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [query, setQuery] = useState('');
  const [activeSectionId, setActiveSectionId] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      apiGet('/menu', { token: session?.token }),
      lodge?.foodTableService ? apiGet('/tables', { token: session?.token }) : Promise.resolve({ tables: [] }),
      lodge?.foodRoomService ? apiGet('/rooms', { token: session?.token }) : Promise.resolve({ rooms: [] }),
    ])
      .then(([menuData, tablesData, roomsData]) => {
        setSections(menuData.sections);
        setTables(writeCache('/tables:active', tablesData.tables.filter((t) => t.isActive)));
        setRooms(writeCache('/rooms:active', roomsData.rooms.filter((r) => r.isActive)));
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

    if (lines.length === 0) {
      setError('Add at least one item.');
      return;
    }

    setSubmitting(true);
    try {
      await apiPost(
        '/orders',
        {
          roomId: target.kind === 'ROOM' ? target.id : null,
          tableId: target.kind === 'TABLE' ? target.id : null,
          guestName,
          guestPhone,
          note,
          items: lines.map((l) => ({
            itemId: l.itemId,
            portionId: l.portionId,
            quantity: l.quantity,
          })),
        },
        { token: session?.token }
      );
      onPlaced();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not place the order.');
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
            <h3 id="counterOrderTitle">Take an order</h3>
            <p className="menu-modal__sub">
              Goes straight into the kitchen queue — staff took it, so it skips the accept step.
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
            {error && <div className="form-banner form-banner--error">{error}</div>}

            <div className="field">
              <label htmlFor="orderTarget">Where&apos;s it going?</label>
              <select
                id="orderTarget"
                value={`${target.kind}:${target.id}`}
                onChange={(e) => {
                  const [kind, id] = e.target.value.split(':');
                  setTarget({ kind, id });
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

            <div className="field-row">
              <div className="field">
                <label htmlFor="orderGuest">
                  Guest name <span className="field__optional">optional</span>
                </label>
                <input
                  id="orderGuest"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="orderPhone">
                  Phone <span className="field__optional">optional</span>
                </label>
                <input
                  id="orderPhone"
                  inputMode="tel"
                  value={guestPhone}
                  onChange={(e) => setGuestPhone(e.target.value)}
                  placeholder="For a phone order"
                />
              </div>
            </div>

            {!sections && <p className="menu-panel__hint">Loading the menu…</p>}

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
              <button
                type="submit"
                className="btn-accent"
                disabled={submitting || lines.length === 0}
              >
                {submitting ? 'Placing…' : 'Place order'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

