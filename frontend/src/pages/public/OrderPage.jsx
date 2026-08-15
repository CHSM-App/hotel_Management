import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiGet, apiPatch, apiPost, ApiError, API_BASE } from '../../lib/api';
import { clearGuestSession, getGuestSession, setGuestSession } from '../../lib/guestSession';
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

// The same six states in the two words a chip has room for.
const STATUS_LABEL = {
  PENDING: 'Sent',
  QUEUED: 'In the queue',
  PREPARING: 'Cooking',
  READY: 'Ready',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

const LIVE_STATUSES = ['PENDING', 'QUEUED', 'PREPARING', 'READY'];

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

// The first screen on the property's ordering link. Deliberately not written as
// a login: there is no account here, nothing was signed up for, and a guest who
// reads "sign in" starts hunting for a password they were never given. What
// this actually asks is where to bring the food and the PIN on the check-in
// slip that proves the room is theirs — so it says that, and the button says
// what happens next rather than naming the act of authenticating.
//
// Ordering used to ask for the same two fields at the end, in the cart. Moving
// them to the front buys three things a checkout field couldn't: a wrong PIN is
// caught before the guest has spent five minutes filling a cart, the phone can
// remember it so a four-night stay isn't four nights of retyping, and — the
// reason this exists — once the page knows which room it's looking at, it can
// show that room its own orders and let the guest change them.
//
// Defined at module level rather than inside OrderPage: a component declared
// during render is a new type every render, so React would remount it on each
// keystroke and the field would lose focus mid-PIN.
function GuestLogin({ lodge, onSubmit, busy, error }) {
  const [roomNumber, setRoomNumber] = useState('');
  const [pin, setPin] = useState('');

  return (
    <div className="order-page order-page--gate">
      <form
        className="guest-login"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(roomNumber.trim(), pin.trim());
        }}
        noValidate
      >
        <h1 className="guest-login__lodge">{lodge.name}</h1>
        <p className="guest-login__lead">
          Where shall we bring it? Enter your room and the food PIN from your check-in slip.
        </p>

        {error && <div className="guest-login__error">{error}</div>}

        <label className="guest-login__label" htmlFor="guestRoom">
          Room number
        </label>
        <input
          id="guestRoom"
          className="guest-login__input"
          inputMode="numeric"
          autoComplete="off"
          value={roomNumber}
          onChange={(e) => setRoomNumber(e.target.value)}
          placeholder="101"
          disabled={busy}
        />

        <label className="guest-login__label" htmlFor="guestPin">
          Food PIN
        </label>
        <input
          id="guestPin"
          className="guest-login__input"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="4 digits"
          disabled={busy}
        />

        <button type="submit" className="guest-login__submit" disabled={busy}>
          {busy ? 'Checking…' : 'See the menu'}
        </button>

        {/* This screen is now the only way through, so the way to get unstuck
            has to be on it. A tel: link rather than a number to copy out: this
            page is opened on a phone, from a room, by someone who wants to be
            talking to the counter in one tap. */}
        <div className="guest-login__help">
          <p>Lost your PIN, or not sure of the room number?</p>
          {lodge.phone ? (
            <a className="guest-login__call" href={`tel:${lodge.phone}`}>
              Call the counter on {lodge.phone}
            </a>
          ) : (
            <p className="guest-login__call-none">Please ask at the counter.</p>
          )}
        </div>
      </form>
    </div>
  );
}

// One order as the guest sees it: where it has got to, what's on it, and — only
// while the kitchen hasn't started — the two buttons that let them change their
// mind. Whether those buttons appear is the server's `canModify`, not a status
// check repeated here, so the screen can never offer an edit the server will
// refuse.
function GuestOrderCard({ order, onEdit, onCancel, busy, editing }) {
  return (
    <li className={`guest-order guest-order--${order.status.toLowerCase()}`}>
      <div className="guest-order__head">
        <span className="guest-order__number">#{order.orderNumber}</span>
        <span className="guest-order__chip">{STATUS_LABEL[order.status] || order.status}</span>
        <span className="guest-order__total">{formatPrice(order.subtotal)}</span>
      </div>

      <ul className="guest-order__lines">
        {order.items.map((line) => (
          <li key={line.id}>
            <span className="guest-order__qty">{line.quantity}×</span>
            <span className="guest-order__name">{line.name}</span>
            <span className="guest-order__amount">{formatPrice(line.lineTotal)}</span>
          </li>
        ))}
      </ul>

      {order.note && <p className="guest-order__note">“{order.note}”</p>}

      <p className="guest-order__status">{STATUS_MESSAGE[order.status] || order.status}</p>

      {order.canModify && (
        <div className="guest-order__actions">
          <button type="button" onClick={() => onEdit(order)} disabled={busy}>
            {editing ? 'Editing…' : 'Edit'}
          </button>
          <button
            type="button"
            className="guest-order__cancel"
            onClick={() => onCancel(order)}
            disabled={busy}
          >
            Cancel order
          </button>
        </div>
      )}
    </li>
  );
}

// One page behind two routes: the property's single ordering link
// (/order/:slug), where the guest signs in with their room number and the PIN
// reception gave them, and a table QR (/order/t/:token), where the token itself
// identifies the table and there's nothing to prove. They share the menu and
// the cart; only the identity — and what can be done after ordering — differ.
export default function OrderPage({ mode }) {
  const { slug, token } = useParams();
  const isTable = mode === 'table';

  const [context, setContext] = useState(null);
  const [error, setError] = useState('');
  const [cart, setCart] = useState({});
  const [note, setNote] = useState('');
  const [guestName, setGuestName] = useState('');
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState('');
  const [placed, setPlaced] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);

  // Read from storage on the very first render rather than in an effect, so a
  // guest who is already signed in never sees the login screen flash past.
  const [session, setSession] = useState(() => (mode === 'table' ? null : getGuestSession(slug)));
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState('');

  const [orders, setOrders] = useState([]);
  const [ordersError, setOrdersError] = useState('');
  const [showPast, setShowPast] = useState(false);
  const [busyOrder, setBusyOrder] = useState('');
  const [flash, setFlash] = useState('');

  // The order currently being edited, by its token. Null means the cart is a
  // new order. Everything downstream — the sheet's title, its submit button and
  // where it POSTs — reads this one value.
  const [editing, setEditing] = useState(null);

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

  // Signing out, whether the guest asked or the PIN stopped working. Reception
  // clears food_pin at check-out, so the second case is the ordinary end of a
  // stay rather than an error — the guest is put back on the login screen with
  // whatever the server said about why.
  const signOut = useCallback(
    (message = '') => {
      clearGuestSession(slug);
      setSession(null);
      setOrders([]);
      setEditing(null);
      setCart({});
      setNote('');
      setCartOpen(false);
      setSignInError(message);
    },
    [slug]
  );

  const loadOrders = useCallback(() => {
    if (!session) return Promise.resolve();
    return apiPost(`/public/lodges/${slug}/my-orders`, {
      roomNumber: session.roomNumber,
      pin: session.pin,
    })
      .then((data) => {
        setOrders(data.orders || []);
        setOrdersError('');
      })
      .catch((err) => {
        // Only a 401 means the identity itself has gone. A 429 is the room's
        // PIN lockout, which lifts on its own, and a 500 is the server having a
        // bad moment — signing the guest out for either would lose them their
        // cart for no reason.
        if (err instanceof ApiError && err.status === 401) {
          signOut(err.message);
          return;
        }
        setOrdersError(err instanceof ApiError ? err.message : 'Could not load your orders.');
      });
  }, [slug, session, signOut]);

  // The guest keeps the tab open and watches their food move through the
  // kitchen. Same fifteen-second beat the single-order status view used, now
  // covering every order of the stay at once — and the first tick is what fills
  // the list for a guest whose phone signed them in before the page rendered.
  useEffect(() => {
    if (isTable || !session) return undefined;
    loadOrders();
    const interval = setInterval(() => loadOrders(), 15000);
    return () => clearInterval(interval);
  }, [isTable, session, loadOrders]);

  // Once a table order is in, the page turns into a status board and polls for
  // it using the token handed back at placement. Room orders don't need this —
  // they have the signed-in list above, which shows all of them.
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

  useEffect(() => {
    if (!flash) return undefined;
    const timer = setTimeout(() => setFlash(''), 6000);
    return () => clearTimeout(timer);
  }, [flash]);

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

  const liveOrders = orders.filter((o) => LIVE_STATUSES.includes(o.status));
  const pastOrders = orders.filter((o) => !LIVE_STATUSES.includes(o.status));

  const handleSignIn = async (roomNumber, pin) => {
    setSignInError('');
    if (!roomNumber) {
      setSignInError('Enter your room number.');
      return;
    }
    if (!pin) {
      setSignInError('Enter the PIN reception gave you.');
      return;
    }

    setSigningIn(true);
    try {
      const result = await apiPost(`/public/lodges/${slug}/session`, { roomNumber, pin });
      const next = { roomNumber: result.roomNumber, pin, guestName: result.guestName || '' };
      setGuestSession(slug, next);
      setSession(next);
      // Only prefill from the booking — a guest who typed their own name on a
      // previous order keeps it.
      setGuestName((current) => current || result.guestName || '');
    } catch (err) {
      setSignInError(err instanceof ApiError ? err.message : 'Could not sign you in.');
    } finally {
      setSigningIn(false);
    }
  };

  // Pulls a placed order back into the cart so it can be changed as if it were
  // still being built — the guest edits with the same steppers on the same
  // menu, rather than through a second, lesser editor.
  const startEdit = (order) => {
    if (itemCount > 0 && !editing) {
      const ok = window.confirm(
        'You have items in your cart that haven’t been ordered yet. Editing order #' +
          order.orderNumber +
          ' will replace them. Continue?'
      );
      if (!ok) return;
    }

    const next = {};
    let dropped = 0;
    for (const line of order.items) {
      // A dish taken off the menu since the order was placed can't be put back
      // in a cart — there is no price and no stepper for it any more. Dropping
      // it silently would let the guest save an order that quietly shrank, so
      // the sheet says so.
      const stillOnMenu = allItems.some((i) => String(i.id) === String(line.itemId));
      if (!stillOnMenu) {
        dropped += 1;
        continue;
      }
      const key = cartKey(line.itemId, line.portionId);
      next[key] = (next[key] || 0) + line.quantity;
    }

    setCart(next);
    setNote(order.note || '');
    setEditing({ token: order.token, orderNumber: order.orderNumber, dropped });
    setPlaceError('');
    setCartOpen(true);
  };

  const stopEdit = () => {
    setEditing(null);
    setCart({});
    setNote('');
    setPlaceError('');
    setCartOpen(false);
  };

  const handleCancelOrder = async (order) => {
    const ok = window.confirm(`Cancel order #${order.orderNumber}? The kitchen will be told.`);
    if (!ok) return;

    setBusyOrder(order.token);
    setOrdersError('');
    try {
      await apiPost(`/public/lodges/${slug}/orders/${order.token}/cancel`, {
        roomNumber: session.roomNumber,
        pin: session.pin,
      });
      if (editing?.token === order.token) stopEdit();
      setFlash(`Order #${order.orderNumber} cancelled.`);
      await loadOrders();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        signOut(err.message);
        return;
      }
      setOrdersError(err instanceof ApiError ? err.message : 'Could not cancel that order.');
      // A 409 means the kitchen moved it on while the guest was deciding, so
      // the list is out of date — refresh it rather than leave stale buttons up.
      await loadOrders();
    } finally {
      setBusyOrder('');
    }
  };

  // A table QR can always order. On the shared property link it needs the lodge
  // to take room orders at all, and a room to send them to. The gate above
  // means the second half only ever fails at a property that shows its menu
  // publicly without taking orders — there, this is what leaves the steppers
  // off and the "speak to the counter" notice on.
  const canOrder = isTable || (context?.roomOrderingEnabled && !!session);

  const handlePlace = async (e) => {
    e.preventDefault();
    setPlaceError('');

    if (lines.length === 0) {
      setPlaceError(
        editing
          ? 'An order needs at least one item. Cancel the order instead if you don’t want it.'
          : 'Add something to your order first.'
      );
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

      if (editing) {
        const result = await apiPatch(`/public/lodges/${slug}/orders/${editing.token}`, {
          ...body,
          roomNumber: session.roomNumber,
          pin: session.pin,
        });
        setFlash(`Order #${result.orderNumber} updated.`);
        stopEdit();
        await loadOrders();
      } else if (isTable) {
        setPlaced(await apiPost(`/public/tables/${token}/orders`, body));
        setCart({});
        setCartOpen(false);
      } else {
        const result = await apiPost(`/public/lodges/${slug}/orders`, {
          ...body,
          roomNumber: session.roomNumber,
          pin: session.pin,
        });
        // No takeover screen on the room side: the list above is already the
        // status board, and it now has this order at the top of it.
        setFlash(`Order #${result.orderNumber} sent to the kitchen.`);
        setCart({});
        setNote('');
        setCartOpen(false);
        await loadOrders();
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && !isTable) {
        signOut(err.message);
        return;
      }
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

  // The gate. Only ever on the room side, only when the property actually takes
  // room orders — a menu-only property has no room to ask about, and shows the
  // menu with the "speak to the counter" notice instead.
  if (!isTable && context.roomOrderingEnabled && !session) {
    return (
      <GuestLogin
        lodge={context.lodge}
        onSubmit={handleSignIn}
        busy={signingIn}
        error={signInError}
      />
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
            Keep this page open — it updates on its own. Pay at the counter.
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

        {/* "Not your room?" rather than "sign out", for the same reason the
            first screen isn't a login: nothing was signed into, and what the
            guest wants from this button is to correct the room, not to end a
            session. */}
        {!isTable && session && (
          <div className="order-page__who">
            <span className="order-page__room">Room {session.roomNumber}</span>
            <button type="button" className="order-page__signout" onClick={() => signOut()}>
              Not your room?
            </button>
          </div>
        )}
      </header>

      {flash && <div className="order-page__flash">{flash}</div>}

      {!canOrder && (
        <div className="order-page__closed">
          <strong>This is a menu only.</strong>
          <p>
            To order, please speak to the counter
            {context.lodge.phone ? ` or call ${context.lodge.phone}` : ''}.
          </p>
        </div>
      )}

      {/* Everything this room has ordered on this stay, newest first. It is the
          first thing under the header because on the second visit it is the
          reason the guest opened the page at all — to see where their food is. */}
      {!isTable && session && (
        <section className="guest-orders">
          <h2 className="guest-orders__title">Your orders</h2>

          {ordersError && <div className="guest-orders__error">{ordersError}</div>}

          {orders.length === 0 && !ordersError && (
            <p className="guest-orders__empty">Nothing ordered yet. The menu is below.</p>
          )}

          {liveOrders.length > 0 && (
            <ul className="guest-orders__list">
              {liveOrders.map((order) => (
                <GuestOrderCard
                  key={order.token}
                  order={order}
                  onEdit={startEdit}
                  onCancel={handleCancelOrder}
                  busy={busyOrder === order.token || placing}
                  editing={editing?.token === order.token}
                />
              ))}
            </ul>
          )}

          {pastOrders.length > 0 && (
            <>
              <button
                type="button"
                className="guest-orders__toggle"
                onClick={() => setShowPast((v) => !v)}
              >
                {showPast ? 'Hide earlier orders' : `Earlier orders (${pastOrders.length})`}
              </button>
              {showPast && (
                <ul className="guest-orders__list">
                  {pastOrders.map((order) => (
                    <GuestOrderCard
                      key={order.token}
                      order={order}
                      onEdit={startEdit}
                      onCancel={handleCancelOrder}
                      busy={busyOrder === order.token}
                      editing={false}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}

      {/* Editing happens against the live menu with the sheet closed, so this
          strip is the only thing on screen saying the steppers are pointed at
          an order that already exists. */}
      {editing && (
        <div className="order-page__editing">
          <span>Editing order #{editing.orderNumber}</span>
          <button type="button" onClick={() => setCartOpen(true)}>
            Review changes
          </button>
          <button type="button" className="order-page__editing-stop" onClick={stopEdit}>
            Discard
          </button>
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
          <span className="order-page__bar-cta">
            {editing ? 'Review changes' : 'Review order'}
          </span>
        </button>
      )}

      {cartOpen && (
        <div className="order-sheet-backdrop" onClick={() => !placing && setCartOpen(false)}>
          <form className="order-sheet" onClick={(e) => e.stopPropagation()} onSubmit={handlePlace} noValidate>
            <h2>{editing ? `Edit order #${editing.orderNumber}` : 'Your order'}</h2>

            {editing?.dropped > 0 && (
              <div className="order-sheet__warn">
                {editing.dropped === 1
                  ? 'One item from this order is no longer on the menu and has been removed.'
                  : `${editing.dropped} items from this order are no longer on the menu and have been removed.`}
              </div>
            )}

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

            {!isTable && session && (
              <p className="order-sheet__signed">
                Ordering to <strong>room {session.roomNumber}</strong>.
              </p>
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
                {placing ? 'Sending…' : editing ? 'Save changes' : 'Place order'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
