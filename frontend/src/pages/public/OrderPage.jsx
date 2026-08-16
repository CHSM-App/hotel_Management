import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

// Veg, then non-veg — the order an Indian menu is printed in, and the same
// order the staff-side editor groups by, so a guest and the owner reading their
// own menu see the sections laid out identically.
//
// Egg was a third type here and is now part of non-veg: the mark answers "can I
// eat this", and for anyone reading the veg mark an omelette sits on the far
// side of that line with the chicken.
const FOOD_TYPES = [
  { key: 'VEG', label: 'Veg' },
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

  // The order the guest has asked to cancel, held by token while they choose
  // between cancelling part of it and cancelling all of it. The token rather
  // than the order itself, so the choice is always resolved against the list
  // the fifteen-second poll keeps fresh — an order the kitchen accepted while
  // this was open stops offering buttons the server would now refuse.
  const [cancelToken, setCancelToken] = useState('');

  // The order currently being edited, by its token. Null means the cart is a
  // new order. Everything downstream — the sheet's title, its submit button and
  // where it POSTs — reads this one value.
  const [editing, setEditing] = useState(null);

  // Which of the page's two halves is on screen: the menu, or this room's
  // orders. They used to be one scroll — the whole order history, then the
  // whole menu under it — and that is the page's main source of confusion. A
  // guest on their fourth night opened the link to order breakfast and had to
  // thumb past nine cards to reach a dish, while a guest checking where their
  // food had got to found the answer buried above a hundred-item menu. Neither
  // could tell at a glance which of the two things the page was for.
  //
  // 'menu' is always the landing view, including with orders live. A page that
  // opens on a different screen depending on what happened yesterday is its own
  // kind of confusing; the count on the tab is what says there's something to
  // look at, and it's one tap away.
  const [view, setView] = useState('menu');

  // A table QR has no orders of its own to look back at — the token is the
  // table, not the guest — so there is no second view to switch to and the page
  // stays what it always was: a menu.
  const hasOrdersView = !isTable && !!session;
  const showMenu = !hasOrdersView || view === 'menu';

  // A property can serve a hundred dishes across ten sections. They are all on
  // the page at once, in one column the guest can thumb through end to end —
  // the tab strip jumps to a section rather than swapping the page's contents
  // for it, and follows along as the guest scrolls past one into the next.
  const [activeSectionId, setActiveSectionId] = useState(null);
  const [diet, setDiet] = useState('ALL');
  const [query, setQuery] = useState('');

  // Every section's <section> element, keyed by id: the tabs scroll to these,
  // and the scrollspy below reads their positions.
  const sectionRefs = useRef({});

  // Two refs for the one bar, because they're measured for different things:
  // the whole pinned block is what hides the top of the page and so sets where
  // a section counts as reached, while the horizontal scrolling that keeps the
  // live tab in view belongs to the tab row alone.
  const stickyRef = useRef(null);
  const tabsRef = useRef(null);

  // A tab click scrolls the page, and that scroll would otherwise drive the
  // scrollspy through every section it passes over — the strip would flicker
  // through four tabs on the way to the fifth. Set while the smooth scroll
  // runs, it holds the tab the guest actually chose.
  const jumpingRef = useRef(false);
  const jumpTimer = useRef(null);

  const contextPath = useMemo(
    () => (isTable ? `/public/tables/${token}` : `/public/lodges/${slug}/menu`),
    [isTable, slug, token],
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
      // Back to the landing view, so signing in as a different room starts
      // where a first visit starts rather than on the last room's tab.
      setView('menu');
    },
    [slug],
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
  const activeSection = dietMenu.find((s) => s.id === activeSectionId) ?? dietMenu[0] ?? null;

  const needle = query.trim().toLowerCase();
  const searching = needle !== '';

  // Not just the chosen section: the whole menu, one section after another, so
  // a guest who never touches the tabs can read it the way a printed card is
  // read — top to bottom, and back up again.
  const shownSections = useMemo(() => {
    if (!searching) return dietMenu;
    return dietMenu
      .map((section) => ({
        ...section,
        items: section.items.filter(
          (item) =>
            item.name.toLowerCase().includes(needle) ||
            (item.description || '').toLowerCase().includes(needle),
        ),
      }))
      .filter((section) => section.items.length > 0);
  }, [dietMenu, needle, searching]);

  // How far down the viewport a section heading has to have travelled before it
  // counts as the one being read: everything under the sticky bar is hidden
  // behind it, so the line where a heading disappears is the line where the
  // next section has taken over. Measured rather than written down, because the
  // bar is one row or two depending on whether the property has enough sections
  // to be worth tabbing between.
  const spyLine = () => (stickyRef.current?.offsetHeight ?? 0) + 12;

  const goToSection = (id) => {
    setActiveSectionId(id);

    const el = sectionRefs.current[id];
    if (!el) return;

    jumpingRef.current = true;
    window.clearTimeout(jumpTimer.current);
    // A hair above the heading's own line, so the section that just became
    // active is unambiguously past it and the spy agrees with the tab.
    jumpTimer.current = window.setTimeout(() => {
      jumpingRef.current = false;
    }, 700);

    window.scrollTo({
      top: window.scrollY + el.getBoundingClientRect().top - spyLine() - 4,
      behavior: 'smooth',
    });
  };

  useEffect(() => () => window.clearTimeout(jumpTimer.current), []);

  // Out of the sheet and back to the dishes. Nothing new happens here — while
  // an order is being edited the menu's steppers are already pointed at that
  // order's cart, so an Add down there joins the order being edited rather than
  // starting a new one, and the edit sends the whole cart. What was missing was
  // any way to know it: the only route out of the sheet was a button marked
  // "Back", which names where it came from rather than what's on the other side.
  //
  // The scroll is skipped when the menu is already in view — a guest who was
  // reading Desserts, opened the sheet and came back should land in Desserts,
  // not at the top of the menu. When the bar is still below the fold, which is
  // where an edit started from the orders list leaves them, it goes to it.
  const goToMenu = () => {
    setCartOpen(false);

    const bar = stickyRef.current;
    if (!bar || bar.getBoundingClientRect().top <= spyLine()) return;

    window.scrollTo({
      top: window.scrollY + bar.getBoundingClientRect().top - 4,
      behavior: 'smooth',
    });
  };

  // The scrollspy. A plain scroll listener rather than an IntersectionObserver:
  // what decides the active tab is which heading was last crossed, which is a
  // question about the order of every section at one instant, not about any one
  // of them entering the viewport.
  useEffect(() => {
    if (!showMenu || searching || dietMenu.length < 2) return undefined;

    const onScroll = () => {
      if (jumpingRef.current) return;

      const line = spyLine();
      let current = dietMenu[0]?.id ?? null;

      for (const section of dietMenu) {
        const el = sectionRefs.current[section.id];
        if (!el) continue;
        if (el.getBoundingClientRect().top - line <= 0) current = section.id;
        else break;
      }

      // A short last section can't reach the top of a scrolled-out page, so it
      // would never light up its own tab. At the bottom, it's the one being
      // read whether or not its heading made it that far.
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom) current = dietMenu[dietMenu.length - 1].id;

      setActiveSectionId((prev) => (prev === current ? prev : current));
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [dietMenu, searching, showMenu]);

  // Each view starts at its own top. Without this, switching from halfway down
  // a hundred-dish menu to a two-order list lands the guest at the bottom of a
  // screen they have never seen the top of — the browser clamps the scroll to
  // the shorter page and it reads as an empty screen. Instant, not smooth:
  // gliding through content that has just been swapped out looks like a fault.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view]);

  // Keep the live tab on screen. The strip is wider than the phone, so the
  // section the guest has scrolled into is often off the end of it — this
  // moves the strip, and only the strip, horizontally.
  useEffect(() => {
    const strip = tabsRef.current;
    if (!strip || !activeSection) return;

    const tab = strip.querySelector('[aria-current="true"]');
    if (!tab) return;

    strip.scrollTo({
      left: tab.offsetLeft - (strip.clientWidth - tab.offsetWidth) / 2,
      behavior: 'smooth',
    });
    // dietMenu is memoised, so this is the section object itself changing —
    // one run per actual change of tab, not one per render.
  }, [activeSection]);

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

  // Resolved from the live list rather than remembered, so the dialog closes on
  // its own if the kitchen accepts the order — canModify going false takes the
  // whole thing off screen instead of leaving two buttons up that would now
  // come back 409.
  const cancelling =
    (cancelToken && orders.find((o) => o.token === cancelToken && o.canModify)) || null;

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
      const result = await apiPost(`/public/lodges/${slug}/session`, {
        roomNumber,
        pin,
      });
      const next = {
        roomNumber: result.roomNumber,
        pin,
        guestName: result.guestName || '',
      };
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
          ' will replace them. Continue?',
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

    // Nothing on the order is still being served. There would be no lines to
    // work on and no steppers to put anything back with, so this opens an
    // editor that can only be escaped by discarding it — say so instead, and
    // leave the order alone. Cancelling it is still on the card.
    if (Object.keys(next).length === 0) {
      setFlash(
        `Nothing on order #${order.orderNumber} is on the menu any more, so it can’t be changed. Cancel it, or speak to the counter.`,
      );
      return;
    }

    setCart(next);
    setNote(order.note || '');
    setEditing({ token: order.token, orderNumber: order.orderNumber, dropped });
    setPlaceError('');
    setCartOpen(true);
    // Editing is menu work — the steppers down there are what change the order,
    // and the strip pinned above them is what says so. Closing the sheet onto
    // the orders list would put the guest back where they started, looking at a
    // card of the order they are in the middle of changing.
    setView('menu');
  };

  const stopEdit = () => {
    setEditing(null);
    setCart({});
    setNote('');
    setPlaceError('');
    setCartOpen(false);
  };

  // The whole order, gone. No confirm() in front of it: the two-way choice the
  // guest just came through is the confirmation, and a browser dialog on top of
  // it would ask the same question a third time.
  const handleCancelOrder = async (order) => {
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
      // Closed either way. On success there's nothing left to choose about; on
      // failure the reason is on the list behind this, and the refresh above
      // has already decided which buttons that order still deserves.
      setCancelToken('');
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
          : 'Add something to your order first.',
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
        // No takeover screen on the room side: the orders view is already the
        // status board, so the page turns to it with the new order at the top.
        // Ordering ends by showing you what you ordered — which is also the
        // one moment the guest learns that the other tab exists and what it's
        // for, without being told.
        setFlash(`Order #${result.orderNumber} sent to the kitchen.`);
        setCart({});
        setNote('');
        setCartOpen(false);
        setView('orders');
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
          <p className="order-page__done-status">
            {STATUS_MESSAGE[placed.status] || placed.status}
          </p>
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

        {/* A table says which table. A menu-only property says "Menu", because
            that is the whole of what the page is. A signed-in guest is told
            neither — the switch below already names both halves, and a third
            word for one of them sitting above it only raises the question of
            whether it means the same thing. */}
        {!hasOrdersView && (
          <p className="order-page__target">{isTable ? context.target.label : 'Menu'}</p>
        )}

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

      {/* The page does two jobs and now says which one it's doing. Ordering and
          checking on an order are separate errands — a guest is on one or the
          other, never both — so they get a screen each rather than a single
          scroll that runs one into the next.

          The count is on the tab rather than in a banner: it's the one thing
          from the other screen worth knowing while you're on this one. */}
      {hasOrdersView && (
        <nav className="order-views" aria-label="Menu or your orders">
          <button
            type="button"
            className="order-views__tab"
            aria-current={view === 'menu' ? 'true' : undefined}
            onClick={() => setView('menu')}
          >
            Menu
          </button>
          <button
            type="button"
            className="order-views__tab"
            aria-current={view === 'orders' ? 'true' : undefined}
            onClick={() => setView('orders')}
          >
            Your orders
            {liveOrders.length > 0 && (
              <span className="order-views__badge">{liveOrders.length}</span>
            )}
          </button>
        </nav>
      )}

      {/* Everything this room has ordered on this stay, newest first.

          Keyed on the view so React tears the subtree down and builds it back
          on every switch, which is what lets the entrance animation run each
          time rather than once on first mount. */}
      {hasOrdersView && view === 'orders' && (
        <section className="guest-orders order-view-in" key="view-orders">
          {ordersError && <div className="guest-orders__error">{ordersError}</div>}

          {orders.length === 0 && !ordersError && (
            <div className="guest-orders__none">
              <p>Nothing ordered yet.</p>
              <button type="button" onClick={() => setView('menu')}>
                See the menu
              </button>
            </div>
          )}

          {liveOrders.length > 0 && (
            <ul className="guest-orders__list">
              {liveOrders.map((order) => (
                <GuestOrderCard
                  key={order.token}
                  order={order}
                  onEdit={startEdit}
                  onCancel={(o) => setCancelToken(o.token)}
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
                      onCancel={(o) => setCancelToken(o.token)}
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

      {showMenu && menu.length === 0 && (
        <div className="order-page__state">Nothing is being served right now.</div>
      )}

      {/* One wrapper around the whole menu view, not just the chrome at the top
          of it. .order-sticky is constrained by its parent's box, so a div that
          closed before the dishes would give the bar a few pixels of travel and
          then let it scroll away. Everything it sticks past has to be inside. */}
      {showMenu && menu.length > 0 && (
        <div className="order-view-in" key="view-menu">
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
          </div>

          {/* The two strips that say what's on screen, stuck to the top as one
              bar while the dishes scroll under them. Search stays above and
              scrolls away — it's typed once — but these two are what a guest
              reaches for repeatedly halfway down a long menu, and hunting back
              up for them is the whole reason to pin them.

              Sections first, diet under it: the diet chips narrow what the
              tabs are offering, so they read as the finer cut of the two. */}
          <div className="order-sticky" ref={stickyRef}>
            {/* Editing happens against the live menu below with the sheet shut,
                so this strip is the only thing on screen saying the steppers
                are pointed at an order that already exists — which is exactly
                what makes adding a dish to a placed order possible, and why it
                has to be readable while the guest is down among the dishes
                doing it.

                It rides inside the sticky bar rather than sticking on its own
                above it. Both were position: sticky at top: 0, so the moment
                the guest scrolled to the menu the bar landed on top of the
                strip and hid it. One sticky parent, and the rows stack. */}
            {editing && (
              <div className="order-page__editing">
                <span>Editing order #{editing.orderNumber} — add or change anything below.</span>
                <button type="button" onClick={() => setCartOpen(true)}>
                  Review changes
                </button>
                <button type="button" className="order-page__editing-stop" onClick={stopEdit}>
                  Discard
                </button>
              </div>
            )}

            {/* A shortcut, not a filter: tapping a tab scrolls the one long menu
                to that section and leaves everything above and below it still
                there to scroll back through. Hidden while searching, when the
                results decide what's on screen. */}
            {!searching && dietMenu.length > 1 && (
              <nav className="order-tabs" aria-label="Menu sections" ref={tabsRef}>
                {dietMenu.map((section) => (
                  <button
                    type="button"
                    key={section.id}
                    className="order-tabs__tab"
                    aria-current={section.id === activeSection?.id ? 'true' : undefined}
                    onClick={() => goToSection(section.id)}
                  >
                    {section.name}
                  </button>
                ))}
              </nav>
            )}

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

          {shownSections.length === 0 && (
            <div className="order-page__state">
              {searching ? 'Nothing on the menu matches that.' : 'Nothing here for that choice.'}
            </div>
          )}

          {shownSections.map((section) => (
            <section
              className="order-section"
              key={section.id}
              ref={(el) => {
                if (el) sectionRefs.current[section.id] = el;
                else delete sectionRefs.current[section.id];
              }}
            >
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

                      // On the order in any of its forms — a bare dish, or any one
                      // of its sizes. Worth a mark on the card, because scrolling
                      // back up a section to check what you already added is the
                      // commonest thing a guest does on a long menu.
                      const inCart = hasSizes
                        ? portions.some((p) => cart[cartKey(item.id, p.id)])
                        : !!cart[item.id];

                      return (
                        <div
                          className={`order-item${inCart ? ' order-item--in-cart' : ''}`}
                          key={item.id}
                        >
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
                                          <span className="order-qty-pop" key={cart[item.id]}>
                                            {cart[item.id]}
                                          </span>
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
                                            <span className="order-qty-pop" key={qty}>
                                              {qty}
                                            </span>
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
        </div>
      )}

      {/* The cart, and the one thing on screen in both views — so it has to be
          unmistakable about which of the two carts it is holding. Editing an
          order and building a new one look identical from down here otherwise:
          same bar, same count, same total, and only the word on the button
          different. In edit mode it names the order it will overwrite and wears
          a different colour to say the difference is not a detail. */}
      {canOrder && itemCount > 0 && !cartOpen && (
        <button
          type="button"
          className={`order-page__bar${editing ? ' order-page__bar--editing' : ''}`}
          onClick={() => setCartOpen(true)}
        >
          <span>
            {editing ? `Order #${editing.orderNumber} · ` : ''}
            {itemCount} item{itemCount === 1 ? '' : 's'}
          </span>
          {/* Keyed on the total, so React swaps the node whenever the number
              changes and the bump animation runs again rather than only on
              first paint. The dish just tapped is at the other end of the
              screen from this — the bump is what ties them together. */}
          <span className="order-page__bar-total" key={total}>
            {formatPrice(total)}
          </span>
          <span className="order-page__bar-cta">{editing ? 'Review changes' : 'Review order'}</span>
        </button>
      )}

      {cartOpen && (
        <div className="order-sheet-backdrop" onClick={() => !placing && setCartOpen(false)}>
          <form
            className="order-sheet"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handlePlace}
            noValidate
          >
            {/* The bar every phone user has been taught means "this panel came
                up from the bottom and goes back down" — it costs four pixels
                and answers the question the sheet otherwise leaves open. */}
            <div className="order-sheet__grab" aria-hidden="true" />

            {/* Pinned while the lines scroll under it, along with the actions at
                the foot. A sheet you can work in is a sheet that gets long —
                ten lines with steppers on each — and the two things a guest
                needs constantly are what they're editing and how to finish. */}
            <div className="order-sheet__head">
              <h2>{editing ? `Edit order #${editing.orderNumber}` : 'Your order'}</h2>
              {itemCount > 0 && (
                <span className="order-sheet__count">
                  {itemCount} item{itemCount === 1 ? '' : 's'}
                </span>
              )}
            </div>

            {editing?.dropped > 0 && (
              <div className="order-sheet__warn">
                {editing.dropped === 1
                  ? 'One item from this order is no longer on the menu and has been removed.'
                  : `${editing.dropped} items from this order are no longer on the menu and have been removed.`}
              </div>
            )}

            {placeError && <div className="order-sheet__error">{placeError}</div>}

            {/* The lines are worked on here, not just totted up. They used to be
                three read-only spans, which meant changing a quantity was a
                trip back out to the menu to find the dish again — fine when the
                cart is three things you just chose, useless for an order placed
                an hour ago that you want one less of. Each line carries its own
                stepper and its own way off the order, so everything the guest
                came to this sheet to do can be done without leaving it. */}
            <ul className="order-sheet__lines">
              {lines.map((line) => (
                <li key={line.key}>
                  <div className="order-sheet__line-head">
                    <span className="order-sheet__name">{line.name}</span>
                    {line.quantity > 1 && (
                      <span className="order-sheet__each">{formatPrice(line.price)} each</span>
                    )}
                  </div>

                  <div className="order-sheet__line-edit">
                    <div className="order-sheet__stepper">
                      {/* At one, "less" is the same act as taking it off, which
                          is what the menu steppers do too — so the guest who
                          taps down through 3, 2, 1 doesn't hit a floor and have
                          to go looking for a different button. */}
                      <button
                        type="button"
                        onClick={() => setQty(line.id, line.portionId, line.quantity - 1)}
                        disabled={placing}
                        aria-label={`One less ${line.name}`}
                      >
                        −
                      </button>
                      <span className="order-qty-pop" key={line.quantity}>
                        {line.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => setQty(line.id, line.portionId, line.quantity + 1)}
                        // 99 a line is what the server accepts; stopping here
                        // rather than letting the tap through means the limit
                        // is met with a dead button, not a rejected order.
                        disabled={placing || line.quantity >= 99}
                        aria-label={`One more ${line.name}`}
                      >
                        +
                      </button>
                    </div>

                    <button
                      type="button"
                      className="order-sheet__remove"
                      onClick={() => setQty(line.id, line.portionId, 0)}
                      disabled={placing}
                      aria-label={`Take ${line.name} off the order`}
                    >
                      Remove
                    </button>

                    <span className="order-sheet__amount">
                      {formatPrice(line.price * line.quantity)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            {/* Removing the last line is a reasonable thing to do on the way to
                "I don't want this any more", and the server won't take an empty
                order — so rather than let the guest find that out by pressing
                Save, the sheet says so here and offers the thing they were
                actually reaching for. */}
            {lines.length === 0 && (
              <div className="order-sheet__empty">
                {editing ? (
                  <>
                    <p>
                      There’s nothing left on this order. An order can’t be empty — put something
                      back from the menu, or cancel it altogether.
                    </p>
                    <button
                      type="button"
                      className="order-sheet__cancel-all"
                      onClick={() => {
                        const { token: orderToken } = editing;
                        stopEdit();
                        setCancelToken(orderToken);
                      }}
                      disabled={placing}
                    >
                      Cancel order #{editing.orderNumber}
                    </button>
                  </>
                ) : (
                  <p>Nothing here yet. Add something from the menu below.</p>
                )}
              </div>
            )}

            {/* The way to put something else on the order, from the one screen
                a guest is on when they realise they want to. Full width and
                above the total, so it reads as part of working on the order
                rather than as a way out of the sheet — which is what "Back"
                down in the actions row looks like, and why nobody found the
                menu from here. */}
            {canOrder && (
              <button type="button" className="order-sheet__more" onClick={goToMenu}>
                + {editing ? 'Add something else to this order' : 'Add more from the menu'}
              </button>
            )}

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
            <input
              id="guestName"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
            />

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
              {/* Dead while there's nothing to send. The panel above already
                  says why and what to do about it, so the button being live
                  would only buy an error message saying the same thing. */}
              <button
                type="submit"
                className="order-sheet__place"
                disabled={placing || lines.length === 0}
              >
                {placing ? 'Sending…' : editing ? 'Save changes' : 'Place order'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* "Cancel order" used to be one confirm() and one outcome: the whole
          thing gone. But a guest tapping it usually wants less than that —
          they ordered four rotis and want two, or one dish of the three has
          turned out to be a mistake — and with only an all-or-nothing button
          in front of them, the way to get there was to cancel everything and
          order it all again, which the kitchen sees as a cancellation and a
          fresh ticket. So the button asks which, and the smaller answer is
          offered first, because it's the one more people actually want.

          Taking things off is the same act as editing — the server replaces
          the order's lines either way — so it opens the same sheet rather than
          a second, lesser editor that could drift from it. */}
      {cancelling && (
        <div
          className="order-sheet-backdrop"
          onClick={() => busyOrder !== cancelling.token && setCancelToken('')}
        >
          <div
            className="order-choice"
            role="dialog"
            aria-modal="true"
            aria-label={`Cancel order number ${cancelling.orderNumber}`}
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Cancel order #{cancelling.orderNumber}</h2>
            <p className="order-choice__lead">All of it, or only part of it?</p>

            <button
              type="button"
              className="order-choice__option"
              onClick={() => {
                setCancelToken('');
                startEdit(cancelling);
              }}
              disabled={busyOrder === cancelling.token}
            >
              <span className="order-choice__title">Take some things off it</span>
              <span className="order-choice__note">
                Drop a dish or order fewer of one, and the rest still comes.
              </span>
            </button>

            <button
              type="button"
              className="order-choice__option order-choice__option--danger"
              onClick={() => handleCancelOrder(cancelling)}
              disabled={busyOrder === cancelling.token}
            >
              <span className="order-choice__title">
                {busyOrder === cancelling.token ? 'Cancelling…' : 'Cancel the whole order'}
              </span>
              <span className="order-choice__note">
                Nothing on it will be made. The kitchen will be told.
              </span>
            </button>

            <button
              type="button"
              className="order-choice__back"
              onClick={() => setCancelToken('')}
              disabled={busyOrder === cancelling.token}
            >
              Leave it as it is
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
