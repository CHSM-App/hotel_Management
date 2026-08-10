import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, apiPatch, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { formatPrice } from './priceFormat';
import './forms.css';
import './MenuPanel.css';
import './OrdersPanel.css';

const POLL_MS = 10000;

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

  // Browsers refuse to play audio until the user has interacted with the page,
  // so the context is created on an explicit tap and the screen says so until
  // then — a silent alert the kitchen believes is on would be worse than none.
  const audioRef = useRef(null);
  const [soundOn, setSoundOn] = useState(false);
  const knownIdsRef = useRef(null);

  const [showCounterForm, setShowCounterForm] = useState(false);

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

  const pending = orders?.filter((o) => o.status === 'PENDING') ?? [];
  const live = orders?.filter((o) => o.status !== 'PENDING') ?? [];

  const renderOrder = (order) => (
    <div className={`order-card order-card--${order.status.toLowerCase()}`} key={order.id}>
      <div className="order-card__head">
        <span className="order-card__number">#{order.orderNumber}</span>
        <span className="order-card__target">
          {order.source === 'ROOM' && `Room ${order.roomNumber}`}
          {order.source === 'TABLE' && order.tableLabel}
          {order.source === 'COUNTER' && 'Counter'}
        </span>
        <span className="order-card__elapsed">{elapsedLabel(order.placedAt, now)}</span>
      </div>

      <ul className="order-card__items">
        {order.items.map((item, index) => (
          <li key={index}>
            <span className="order-card__qty">{item.quantity}×</span>
            <span className="order-card__item-name">{item.name}</span>
          </li>
        ))}
      </ul>

      {order.note && <div className="order-card__note">“{order.note}”</div>}

      <div className="order-card__foot">
        <span className="order-card__status">{STATUS_LABEL[order.status]}</span>
        <span className="order-card__total">{formatPrice(order.subtotal)}</span>
      </div>

      <div className="order-card__actions">
        {order.nextStatuses.map((status) => (
          <button
            key={status}
            type="button"
            className={status === 'CANCELLED' ? 'order-btn order-btn--cancel' : 'order-btn'}
            disabled={busyId === order.id}
            onClick={() => move(order, status)}
          >
            {ACTION_LABEL[status]}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="orders-panel">
      <div className="orders-panel__toolbar">
        {!soundOn ? (
          <button type="button" className="btn-secondary orders-panel__sound" onClick={enableSound}>
            🔔 Turn on new-order sound
          </button>
        ) : (
          <span className="orders-panel__sound-on">🔔 Sound on</span>
        )}
        <button type="button" className="btn-accent" onClick={() => setShowCounterForm(true)}>
          + Take an order
        </button>
      </div>

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

// Reception typing an order in — the phone rings, or someone orders at the
// counter. Same queue, same kitchen screen; it just skips the accept step
// because a member of staff already took it.
function CounterOrderForm({ lodge, onClose, onPlaced }) {
  const session = getSession();
  const [sections, setSections] = useState(null);
  const [tables, setTables] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [cart, setCart] = useState({});
  const [target, setTarget] = useState({ kind: 'COUNTER', id: '' });
  const [note, setNote] = useState('');
  const [guestName, setGuestName] = useState('');
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
        setTables(tablesData.tables.filter((t) => t.isActive));
        setRooms(roomsData.rooms.filter((r) => r.isActive));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the menu.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setQty = (itemId, quantity) => {
    setCart((c) => {
      const next = { ...c };
      if (quantity <= 0) delete next[itemId];
      else next[itemId] = quantity;
      return next;
    });
  };

  const allItems = sections?.flatMap((s) => s.items) ?? [];
  const total = Object.entries(cart).reduce((sum, [itemId, qty]) => {
    const item = allItems.find((i) => String(i.id) === String(itemId));
    return sum + (item ? item.price * qty : 0);
  }, 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const items = Object.entries(cart).map(([itemId, quantity]) => ({ itemId, quantity }));
    if (items.length === 0) {
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
          note,
          items,
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
    <div className="glass-backdrop" onClick={() => !submitting && onClose()}>
      <div className="glass-panel menu-panel__modal" onClick={(e) => e.stopPropagation()}>
        <h3>Take an order</h3>
        <form onSubmit={handleSubmit} noValidate>
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

          <div className="field">
            <label htmlFor="orderGuest">Guest name (optional)</label>
            <input id="orderGuest" value={guestName} onChange={(e) => setGuestName(e.target.value)} />
          </div>

          {!sections && <p className="menu-panel__hint">Loading the menu…</p>}

          {sections?.map((section) => (
            <div className="form-section" key={section.id}>
              <div className="form-section__title">{section.name}</div>
              {section.items
                .filter((item) => item.isAvailable && item.isActive)
                .map((item) => (
                  <div className="counter-line" key={item.id}>
                    <span className="counter-line__name">{item.name}</span>
                    <span className="counter-line__price">{formatPrice(item.price)}</span>
                    <div className="counter-line__qty">
                      <button
                        type="button"
                        onClick={() => setQty(item.id, (cart[item.id] || 0) - 1)}
                        aria-label={`One less ${item.name}`}
                      >
                        −
                      </button>
                      <span>{cart[item.id] || 0}</span>
                      <button
                        type="button"
                        onClick={() => setQty(item.id, (cart[item.id] || 0) + 1)}
                        aria-label={`One more ${item.name}`}
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          ))}

          <div className="field">
            <label htmlFor="orderNote">Note for the kitchen</label>
            <input
              id="orderNote"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Less spicy"
            />
          </div>

          <div className="menu-panel__modal-actions">
            <span className="counter-total">{formatPrice(total)}</span>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn-accent" disabled={submitting}>
              {submitting ? 'Placing…' : 'Place order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
