import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiGet, apiPost, ApiError } from '../../lib/api';
import { formatPrice } from '../lodge/priceFormat';
import './OrderPage.css';

const STATUS_MESSAGE = {
  PENDING: 'Sent — waiting for the kitchen to accept it.',
  QUEUED: 'Accepted. It’s in the queue.',
  PREPARING: 'Being cooked now.',
  READY: 'Ready.',
  DELIVERED: 'Delivered. Enjoy!',
  CANCELLED: 'This order was cancelled. Please speak to the counter.',
};

function FoodTypeMark({ type }) {
  return <span className={`food-mark food-mark--${type.toLowerCase().replace('_', '-')}`} />;
}

// One page behind two routes: the property's single ordering link
// (/order/:slug), where the guest says which room they're in and proves it with
// the PIN reception gave them, and a table QR (/order/t/:token), where the
// token itself identifies the table and there's nothing to prove. They share
// the menu, the cart and the status view; only the checkout fields differ.
export default function OrderPage({ mode }) {
  const { slug, token } = useParams();
  const isTable = mode === 'table';

  const [context, setContext] = useState(null);
  const [error, setError] = useState('');
  const [cart, setCart] = useState({});
  const [note, setNote] = useState('');
  const [guestName, setGuestName] = useState('');
  const [roomNumber, setRoomNumber] = useState('');
  const [pin, setPin] = useState('');
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState('');
  const [placed, setPlaced] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);

  const contextPath = useMemo(
    () => (isTable ? `/public/tables/${token}` : `/public/lodges/${slug}/menu`),
    [isTable, slug, token]
  );

  useEffect(() => {
    apiGet(contextPath)
      .then((data) => {
        setContext(data);
        setError('');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the menu.'));
  }, [contextPath]);

  // Once an order is in, the page turns into a status board and polls for it
  // using the token handed back at placement. The guest keeps the tab open and
  // watches it move — that's the whole after-ordering experience, and it needs
  // no login.
  useEffect(() => {
    if (!placed?.token) return undefined;

    const tick = () => {
      apiGet(`/public/orders/${placed.token}`)
        .then((data) => setPlaced((p) => (p ? { ...p, status: data.status } : p)))
        .catch(() => {});
    };

    const interval = setInterval(tick, 15000);
    return () => clearInterval(interval);
  }, [placed?.token]);

  const allItems = context?.menu.flatMap((s) => s.items) ?? [];
  const lines = Object.entries(cart)
    .map(([itemId, quantity]) => {
      const item = allItems.find((i) => String(i.id) === String(itemId));
      return item ? { ...item, quantity } : null;
    })
    .filter(Boolean);
  const total = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);

  const setQty = (itemId, quantity) => {
    setCart((c) => {
      const next = { ...c };
      if (quantity <= 0) delete next[itemId];
      else next[itemId] = quantity;
      return next;
    });
  };

  // A table QR can always order. On the shared property link it depends on
  // whether the lodge takes room orders at all — never on any particular room,
  // which the page deliberately cannot ask about.
  const canOrder = isTable || context?.roomOrderingEnabled;

  const handlePlace = async (e) => {
    e.preventDefault();
    setPlaceError('');

    if (lines.length === 0) {
      setPlaceError('Add something to your order first.');
      return;
    }
    if (!isTable && !roomNumber.trim()) {
      setPlaceError('Enter your room number.');
      return;
    }
    if (!isTable && !pin.trim()) {
      setPlaceError('Enter the PIN reception gave you.');
      return;
    }

    setPlacing(true);
    try {
      const body = {
        items: lines.map((l) => ({ itemId: l.id, quantity: l.quantity })),
        note,
        guestName,
      };
      const result = isTable
        ? await apiPost(`/public/tables/${token}/orders`, body)
        : await apiPost(`/public/lodges/${slug}/orders`, { ...body, roomNumber, pin });

      setPlaced(result);
      setCart({});
      setPin('');
      setCartOpen(false);
    } catch (err) {
      setPlaceError(err instanceof ApiError ? err.message : 'Could not place the order.');
    } finally {
      setPlacing(false);
    }
  };

  if (error) {
    return (
      <div className="order-page">
        <div className="order-page__state">{error}</div>
      </div>
    );
  }

  if (!context) {
    return (
      <div className="order-page">
        <div className="order-page__state">Loading the menu…</div>
      </div>
    );
  }

  if (placed) {
    return (
      <div className="order-page">
        <div className="order-page__done">
          <div className="order-page__done-tick" aria-hidden="true">
            ✓
          </div>
          <h1>Order #{placed.orderNumber}</h1>
          <p className="order-page__done-status">{STATUS_MESSAGE[placed.status] || placed.status}</p>
          <p className="order-page__done-total">{formatPrice(placed.subtotal)}</p>
          <p className="order-page__done-hint">
            Keep this page open — it updates on its own. Pay at the counter
            {isTable ? '' : ' or add it to your room bill at checkout'}.
          </p>
          <button type="button" className="order-page__again" onClick={() => setPlaced(null)}>
            Order something else
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="order-page">
      <header className="order-page__header">
        <h1>{context.lodge.name}</h1>
        <p className="order-page__target">{isTable ? context.target.label : 'Menu'}</p>
      </header>

      {!canOrder && (
        <div className="order-page__closed">
          <strong>This is a menu only.</strong>
          <p>
            To order, please speak to the counter
            {context.lodge.phone ? ` or call ${context.lodge.phone}` : ''}.
          </p>
        </div>
      )}

      {context.menu.length === 0 && (
        <div className="order-page__state">Nothing is being served right now.</div>
      )}

      {context.menu.map((section) => (
        <section className="order-section" key={section.id}>
          <h2 className="order-section__title">{section.name}</h2>
          {section.items.map((item) => (
            <div className="order-item" key={item.id}>
              <FoodTypeMark type={item.foodType} />
              <div className="order-item__body">
                <div className="order-item__name">{item.name}</div>
                {item.description && <div className="order-item__desc">{item.description}</div>}
                <div className="order-item__price">{formatPrice(item.price)}</div>
              </div>
              {canOrder && (
                <div className="order-item__qty">
                  {cart[item.id] ? (
                    <>
                      <button type="button" onClick={() => setQty(item.id, cart[item.id] - 1)} aria-label="One less">
                        −
                      </button>
                      <span>{cart[item.id]}</span>
                      <button type="button" onClick={() => setQty(item.id, cart[item.id] + 1)} aria-label="One more">
                        +
                      </button>
                    </>
                  ) : (
                    <button type="button" className="order-item__add" onClick={() => setQty(item.id, 1)}>
                      Add
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </section>
      ))}

      {canOrder && itemCount > 0 && !cartOpen && (
        <button type="button" className="order-page__bar" onClick={() => setCartOpen(true)}>
          <span>
            {itemCount} item{itemCount === 1 ? '' : 's'}
          </span>
          <span>{formatPrice(total)}</span>
          <span className="order-page__bar-cta">Review order</span>
        </button>
      )}

      {cartOpen && (
        <div className="order-sheet-backdrop" onClick={() => !placing && setCartOpen(false)}>
          <form className="order-sheet" onClick={(e) => e.stopPropagation()} onSubmit={handlePlace} noValidate>
            <h2>Your order</h2>

            {placeError && <div className="order-sheet__error">{placeError}</div>}

            <ul className="order-sheet__lines">
              {lines.map((line) => (
                <li key={line.id}>
                  <span className="order-sheet__qty">{line.quantity}×</span>
                  <span className="order-sheet__name">{line.name}</span>
                  <span className="order-sheet__amount">{formatPrice(line.price * line.quantity)}</span>
                </li>
              ))}
            </ul>

            <div className="order-sheet__total">
              <span>Total</span>
              <span>{formatPrice(total)}</span>
            </div>

            {!isTable && (
              <div className="order-sheet__identity">
                <div className="order-sheet__identity-row">
                  <div>
                    <label className="order-sheet__label" htmlFor="roomNumber">
                      Room number
                    </label>
                    <input
                      id="roomNumber"
                      inputMode="numeric"
                      value={roomNumber}
                      onChange={(e) => setRoomNumber(e.target.value)}
                      placeholder="101"
                    />
                  </div>
                  <div>
                    <label className="order-sheet__label" htmlFor="pin">
                      PIN
                    </label>
                    <input
                      id="pin"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      placeholder="4 digits"
                    />
                  </div>
                </div>
                <p className="order-sheet__identity-hint">
                  Reception gave you this PIN when you checked in. Don&apos;t have it? Call the front
                  desk{context.lodge.phone ? ` on ${context.lodge.phone}` : ''}.
                </p>
              </div>
            )}

            <label className="order-sheet__label" htmlFor="guestName">
              Your name (optional)
            </label>
            <input id="guestName" value={guestName} onChange={(e) => setGuestName(e.target.value)} />

            <label className="order-sheet__label" htmlFor="note">
              Anything to tell the kitchen?
            </label>
            <input
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Less spicy, no onion"
            />

            <div className="order-sheet__actions">
              <button
                type="button"
                className="order-sheet__back"
                onClick={() => setCartOpen(false)}
                disabled={placing}
              >
                Back
              </button>
              <button type="submit" className="order-sheet__place" disabled={placing}>
                {placing ? 'Sending…' : 'Place order'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
