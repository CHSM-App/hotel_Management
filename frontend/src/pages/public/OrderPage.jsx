import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiGet, apiPost, ApiError, API_BASE } from '../../lib/api';
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

// Veg, then egg, then non-veg — the order an Indian menu is printed in, and the
// same order the staff-side editor groups by, so a guest and the owner reading
// their own menu see the sections laid out identically.
const FOOD_TYPES = [
  { key: 'VEG', label: 'Veg' },
  { key: 'EGG', label: 'Egg' },
  { key: 'NON_VEG', label: 'Non-veg' },
];

function FoodTypeMark({ type }) {
  const label = FOOD_TYPES.find((t) => t.key === type)?.label || type;
  return (
    <span
      className={`food-mark food-mark--${type.toLowerCase().replace('_', '-')}`}
      title={label}
      aria-label={label}
    />
  );
}

function groupByType(items) {
  return FOOD_TYPES.map((type) => ({
    ...type,
    items: items.filter((item) => item.foodType === type.key),
  })).filter((group) => group.items.length > 0);
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

  // A property can serve a hundred dishes across ten sections. The guest picks
  // a section from the tab strip and reads that one; searching looks across
  // all of them.
  const [activeSectionId, setActiveSectionId] = useState(null);
  const [diet, setDiet] = useState('ALL');
  const [query, setQuery] = useState('');

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

  const menu = useMemo(() => context?.menu ?? [], [context]);

  // The diet filter reshapes the menu itself — a section with nothing left in
  // it stops being offered at all, tab included.
  const dietMenu = useMemo(() => {
    if (diet === 'ALL') return menu;
    return menu
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => item.foodType === diet),
      }))
      .filter((section) => section.items.length > 0);
  }, [menu, diet]);

  // Resolved at render, not corrected in an effect: there's no selection before
  // the menu loads, and the diet filter can retire the section being shown.
  const activeSection =
    dietMenu.find((s) => s.id === activeSectionId) ?? dietMenu[0] ?? null;

  const needle = query.trim().toLowerCase();
  const searching = needle !== '';

  const shownSections = useMemo(() => {
    if (!searching) return activeSection ? [activeSection] : [];
    return dietMenu
      .map((section) => ({
        ...section,
        items: section.items.filter(
          (item) =>
            item.name.toLowerCase().includes(needle) ||
            (item.description || '').toLowerCase().includes(needle)
        ),
      }))
      .filter((section) => section.items.length > 0);
  }, [dietMenu, activeSection, needle, searching]);

  // Resolved against the whole menu, never the filtered view — switching to
  // "Veg" with a chicken dish already in the cart must not silently drop it.
  const allItems = menu.flatMap((s) => s.items);

  // A half plate and a full plate of the same dish are two lines, so the key
  // is the pair. A dish without sizes keeps a bare id, which is what every
  // cart written before portions existed already looks like.
  const lines = Object.entries(cart)
    .map(([key, quantity]) => {
      const [itemId, portionId] = key.split(':');
      const item = allItems.find((i) => String(i.id) === String(itemId));
      if (!item) return null;

      const portion = portionId
        ? item.portions?.find((p) => String(p.id) === String(portionId))
        : null;
      if (portionId && !portion) return null;

      return {
        key,
        id: item.id,
        portionId: portion?.id ?? null,
        name: portion ? `${item.name} (${portion.label})` : item.name,
        price: portion ? portion.price : item.price,
        quantity,
      };
    })
    .filter(Boolean);

  const total = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);

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
        items: lines.map((l) => ({
          itemId: l.id,
          portionId: l.portionId,
          quantity: l.quantity,
        })),
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

      {menu.length === 0 && (
        <div className="order-page__state">Nothing is being served right now.</div>
      )}

      {menu.length > 0 && (
        <>
          <div className="order-find">
            <div className="order-search">
              <span className="order-search__icon" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search the menu…"
                aria-label="Search the menu"
              />
            </div>
            <div className="order-diet" role="group" aria-label="Filter by food type">
              <button
                type="button"
                className="order-diet__chip"
                aria-pressed={diet === 'ALL'}
                onClick={() => setDiet('ALL')}
              >
                All
              </button>
              {FOOD_TYPES.map((type) => (
                <button
                  type="button"
                  key={type.key}
                  className="order-diet__chip"
                  aria-pressed={diet === type.key}
                  onClick={() => setDiet(type.key)}
                >
                  <FoodTypeMark type={type.key} />
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sticks to the top while the dishes scroll under it — on a phone
              this strip is the only way back to another section without
              thumbing through everything in between. Hidden while searching,
              when the results decide what's on screen. */}
          {!searching && dietMenu.length > 1 && (
            <nav className="order-tabs" aria-label="Menu sections">
              {dietMenu.map((section) => (
                <button
                  type="button"
                  key={section.id}
                  className="order-tabs__tab"
                  aria-current={section.id === activeSection?.id ? 'true' : undefined}
                  onClick={() => setActiveSectionId(section.id)}
                >
                  {section.name}
                </button>
              ))}
            </nav>
          )}
        </>
      )}

      {menu.length > 0 && shownSections.length === 0 && (
        <div className="order-page__state">
          {searching ? 'Nothing on the menu matches that.' : 'Nothing here for that choice.'}
        </div>
      )}

      {shownSections.map((section) => (
        <section className="order-section" key={section.id}>
          <h2 className="order-section__title">{section.name}</h2>

          {groupByType(section.items).map((group) => (
            <div className="order-group" key={group.key}>
              <div className="order-group__head">
                <FoodTypeMark type={group.key} />
                <span className="order-group__label">{group.label}</span>
                <span className="order-group__rule" aria-hidden="true" />
              </div>

              {/* Wrapped so the dishes can lay out as a grid without the group
                  heading above them becoming a cell in it. */}
              <div className="order-items">
                {group.items.map((item) => {
                  const portions = item.portions ?? [];
                  const hasSizes = portions.length > 0;

                  return (
                    <div className="order-item" key={item.id}>
                      {/* Dish on the left, photo on the right — the shape every
                          food-ordering app converged on, because a menu is read
                          by running down a column of names and a full-width
                          photo per dish puts one item on a screen. */}
                      <div className="order-item__row">
                        <div className="order-item__main">
                          <div className="order-item__head">
                            <FoodTypeMark type={item.foodType} />
                            <div className="order-item__body">
                              <div className="order-item__name">{item.name}</div>
                              {item.description && (
                                <div className="order-item__desc">{item.description}</div>
                              )}
                            </div>
                          </div>

                          {/* Price and the way to order it on one line, sitting
                              at the bottom of the row so it lines up with the
                              foot of the photo beside it. */}
                          {!hasSizes && (
                            <div className="order-item__foot">
                              <div className="order-item__price">{formatPrice(item.price)}</div>
                              {canOrder && (
                                <div className="order-item__qty">
                                  {cart[item.id] ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => setQty(item.id, null, cart[item.id] - 1)}
                                        aria-label={`One less ${item.name}`}
                                      >
                                        −
                                      </button>
                                      <span>{cart[item.id]}</span>
                                      <button
                                        type="button"
                                        onClick={() => setQty(item.id, null, cart[item.id] + 1)}
                                        aria-label={`One more ${item.name}`}
                                      >
                                        +
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      className="order-item__add"
                                      onClick={() => setQty(item.id, null, 1)}
                                    >
                                      Add
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {item.image && (
                          <img
                            className="order-item__photo"
                            src={`${API_BASE}/menu-images/${item.image}`}
                            alt={item.name}
                            loading="lazy"
                          />
                        )}
                      </div>

                      {/* Full width under both columns, because a dish with four
                          sizes needs the room and each row carries its own price
                          and stepper.

                          Each size is its own priced row. Nothing is pre-selected
                          and there is no bare "Add" — the guest picks the size by
                          adding it, so a half plate can never be ordered by
                          accident. */}
                      {hasSizes && (
                        <ul className="order-sizes">
                          {portions.map((portion) => {
                            const key = cartKey(item.id, portion.id);
                            const qty = cart[key] || 0;
                            return (
                              <li className="order-sizes__row" key={portion.id}>
                                <span className="order-sizes__label">{portion.label}</span>
                                <span className="order-sizes__price">
                                  {formatPrice(portion.price)}
                                </span>
                                {canOrder && (
                                  <div className="order-item__qty">
                                    {qty ? (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => setQty(item.id, portion.id, qty - 1)}
                                          aria-label={`One less ${item.name}, ${portion.label}`}
                                        >
                                          −
                                        </button>
                                        <span>{qty}</span>
                                        <button
                                          type="button"
                                          onClick={() => setQty(item.id, portion.id, qty + 1)}
                                          aria-label={`One more ${item.name}, ${portion.label}`}
                                        >
                                          +
                                        </button>
                                      </>
                                    ) : (
                                      <button
                                        type="button"
                                        className="order-item__add"
                                        onClick={() => setQty(item.id, portion.id, 1)}
                                      >
                                        Add
                                      </button>
                                    )}
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
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
                <li key={line.key}>
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
