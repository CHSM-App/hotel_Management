import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useReducedMotion } from 'framer-motion';
import { useParams } from 'react-router-dom';
import { apiGet, apiPost, ApiError, API_BASE } from '../../lib/api';
import { formatPrice } from '../lodge/priceFormat';
import './LodgePublicPage.css';

const bedSizeLabel = { SINGLE: 'Single', DOUBLE: 'Double', QUEEN: 'Queen', KING: 'King' };
const bathroomTypeLabel = { ATTACHED: 'Attached bathroom', COMMON: 'Common bathroom' };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function formatDateLong(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// wa.me links need a country-code-prefixed, digits-only number. Lodges store
// a bare 10-digit Indian mobile number, so that's the only case worth a
// default — anything else (already has a country code, or malformed) is
// passed through as-is rather than guessed at.
function toWhatsAppDigits(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length === 10 ? `91${digits}` : digits;
}

function buildWhatsAppLink(whatsappNumber, message) {
  const digits = toWhatsAppDigits(whatsappNumber);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

// How the property counts a stay, in the words a guest would use.
const CHECKIN_MODE_LABEL = {
  HOUR_24: '24-hour',
  NIGHT_BASED: 'Night-based',
  CYCLE: 'Fixed cycle',
  HYBRID: 'Early arrival 24-hour, else fixed checkout',
};

const FACT_ICONS = {
  price: <path d="M3 18V8m0 6h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5" />,
  rooms: <path d="M4 20V10l8-6 8 6v10M9 20v-6h6v6" />,
  venues: <path d="M7 3v8a2 2 0 0 0 2 2v8M11 3v6M7 7h4M17 21V3c-2 1-3 4-3 8h3" />,
  food: <path d="M4 7h16v13H4zM8 3v4M16 3v4M4 11h16" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
};

// "14:00" -> "2:00 PM", the way a guest reads a clock.
function formatClock(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  if (!Number.isFinite(h)) return hhmm;
  return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

// Where to send a guest who taps "Get directions": the pin when the property
// has one, the address as a search when it does not, nothing when neither.
function buildDirectionsLink(lodge) {
  if (lodge.latitude != null && lodge.longitude != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lodge.latitude},${lodge.longitude}`;
  }
  const address = [lodge.name, lodge.address, lodge.city, lodge.state].filter(Boolean).join(', ');
  return address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null;
}

// "Queen", "Queen or King", "Double, Queen or King" — a category whose rooms
// don't all carry the same bed has to say so rather than pick one and be wrong
// about the rest.
function joinWords(words) {
  if (words.length <= 1) return words[0] || '';
  return `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`;
}

// How the room type's availability reads on the card. The exact count is worth
// saying only while it is small enough to be a reason to hurry — beyond that
// "Available" is all a guest needs, and a precise tally of a property's free
// rooms isn't something to publish for the sake of it.
function availabilityOf(type) {
  if (type.availableCount == null) return null;
  if (type.availableCount === 0) return { tone: 'no', label: 'Fully booked' };
  if (type.availableCount === 1) return { tone: 'low', label: 'Only 1 room left' };
  if (type.availableCount === 2) return { tone: 'low', label: 'Only 2 rooms left' };
  return { tone: 'yes', label: 'Available' };
}

// Every photo on the page goes through the one lightbox, so a card hands it
// full URLs rather than filenames — rooms and venues live on different mounts.
const roomImageUrl = (filename) => `${API_BASE}/room-images/${filename}`;
const venueImageUrl = (filename) => `${API_BASE}/venue-images/${filename}`;
const menuImageUrl = (filename) => `${API_BASE}/menu-images/${filename}`;
const serviceImageUrl = (filename) => `${API_BASE}/service-images/${filename}`;
// logoUrl already carries the /hotel-logos/ prefix from the API (see
// public.service.js), unlike the filenames above.
const logoUrl = (lodge) => (lodge.logoUrl ? `${API_BASE}${lodge.logoUrl}` : null);

// Cards rise in as they scroll into view and lift on hover. With reduced
// motion on they simply sit there. Nothing here changes a card's size, so a
// photo being added later cannot move the layout.
function useCardMotion() {
  const reduce = useReducedMotion();
  if (reduce) return {};
  return {
    initial: { opacity: 0, y: 12 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: '-40px' },
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
    whileHover: { y: -1, transition: { type: 'spring', stiffness: 300, damping: 30 } },
  };
}

function VenueCard({ lodge, venue, onOpenPhotos, onEnquireEvent }) {
  const motionProps = useCardMotion();
  const canEnquire = Boolean(lodge.whatsappNumber) || Boolean(lodge.phone);

  return (
    <motion.div className="lodge-public__room lodge-public__venue gl-venue" {...motionProps}>
      {venue.images.length > 0 && (
        <div className="gl-venue__cover">
          <button
            type="button"
            className="lodge-public__room-cover-btn"
            onClick={() => onOpenPhotos(venue.images.map(venueImageUrl), 0)}
            aria-label={`View photos of ${venue.name}`}
          >
            <img
              src={venueImageUrl(venue.images[0])}
              alt={`${venue.name} at ${lodge.name}`}
              className="lodge-public__room-img"
              loading="lazy"
              decoding="async"
            />
          </button>
          {venue.images.length > 1 && <span className="lodge-public__photo-count">+{venue.images.length - 1}</span>}
        </div>
      )}

      <div className="gl-venue__body">
        <h3 className="gl-venue__name">{venue.name}</h3>
        <p className="gl-venue__rate">{venue.baseCharge > 0 ? `Hire from ${formatPrice(venue.baseCharge)}` : 'Hire charge on request'}</p>

        {venue.capacityPax ? (
          <div className="gl-venue__cap">
            {venue.capacityPax}
            <small>guests</small>
          </div>
        ) : (
          <div className="gl-venue__cap gl-venue__cap--none" aria-hidden="true" />
        )}

        {canEnquire ? (
          <button type="button" className="gl-venue__btn" onClick={() => onEnquireEvent(venue.id)}>
            Check this venue
          </button>
        ) : (
          <p className="gl-venue__call">Call {lodge.phone || 'the property'} to enquire.</p>
        )}
      </div>
    </motion.div>
  );
}

// Something sold per use rather than per night or per function — a private
// pool slot, a round on the games table. No dates or booking behind it, so
// the card is the same shape as a venue's but the enquiry is just name,
// phone and a message rather than the full room/event form.
function ServiceCard({ service, onOpenPhotos, onEnquire }) {
  const motionProps = useCardMotion();
  return (
    <motion.div className="lodge-public__room" {...motionProps}>
      <div className="lodge-public__room-cover">
        {service.image ? (
          <button
            type="button"
            className="lodge-public__room-cover-btn"
            onClick={() => onOpenPhotos([serviceImageUrl(service.image)], 0)}
            aria-label={`View photo of ${service.name}`}
          >
            <img
              src={serviceImageUrl(service.image)}
              alt={service.name}
              className="lodge-public__room-img"
              loading="lazy"
              decoding="async"
            />
          </button>
        ) : (
          <div className="lodge-public__room-placeholder">{service.name}</div>
        )}
      </div>

      <div className="lodge-public__room-body">
        <div className="lodge-public__room-top">
          <div>
            <div className="lodge-public__room-number">{service.name}</div>
            <div className="lodge-public__room-category">Other service</div>
          </div>
          <div className="lodge-public__room-rate">
            {formatPrice(service.price)}
            <span className="lodge-public__room-rate-unit"> /{service.unitLabel}</span>
          </div>
        </div>

        <button type="button" className="site-btn site-btn--whatsapp" onClick={() => onEnquire(service.name)}>
          Enquire about this
        </button>
      </div>
    </motion.div>
  );
}

// The extras a function is sold with, at list price. One strip of chips
// rather than a card each: nobody books a DJ without a hall, so these read as
// footnotes to the venues above them, not as products of their own.
function AddonStrip({ addons }) {
  if (addons.length === 0) return null;
  return (
    <div className="lodge-public__addons">
      <div className="lodge-public__addons-title">Add-ons available</div>
      <div className="lodge-public__addons-list">
        {addons.map((a) => (
          <span className="lodge-public__addon" key={a.id}>
            <span className="lodge-public__addon-name">{a.name}</span>
            <span className="lodge-public__addon-price">
              {a.defaultAmount > 0 ? `${formatPrice(a.defaultAmount)}${a.isPerUnit ? ' each' : ''}` : 'Ask us'}
            </span>
          </span>
        ))}
      </div>
      <p className="lodge-public__addons-note">Prices are indicative — the final quote is confirmed with you.</p>
    </div>
  );
}

// The veg / non-veg mark every Indian menu carries: a green square with a dot
// for veg, red for non-veg. Same shape as the ordering page draws.
function FoodMark({ type }) {
  const nonVeg = type === 'NON_VEG';
  return (
    <span
      className={`lodge-public__food-mark${nonVeg ? ' lodge-public__food-mark--non-veg' : ''}`}
      title={nonVeg ? 'Non-veg' : 'Veg'}
      aria-label={nonVeg ? 'Non-veg' : 'Veg'}
    />
  );
}

function menuItemPrice(item) {
  if (item.portions.length > 0) {
    return item.portions.map((p) => `${p.label} ${formatPrice(p.price)}`).join(' · ');
  }
  return formatPrice(item.price);
}

// Phone: an endless swipeable row where the fan effect follows the finger. Each
// card is posed from its live distance to the middle of the row, so the card
// crossing the centre stands straight and rises, and the ones beside it lean
// away to their sides, lower and smaller. Three copies of the list sit side by
// side; when a swipe settles near either end the row quietly jumps one whole
// copy back to the middle, so it never runs out.
const FAN_W = 206;
const FAN_OVERLAP = 94;
const FAN_STEP = FAN_W - FAN_OVERLAP;

function FanRow({ section, onOpenPhotos }) {
  const reduce = useReducedMotion();
  const rowRef = useRef(null);
  const [dot, setDot] = useState(0);
  const items = section.items;
  const n = items.length;
  const loop = n > 1;
  const copies = loop ? [0, 1, 2] : [0];

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return undefined;
    const cards = Array.from(row.querySelectorAll('.fan-card'));
    const setW = n * FAN_STEP;
    let raf = 0;
    let settle = 0;
    let lastDot = -1;
    // Card positions are measured once (and on resize), never inside the scroll
    // frame: reading layout for every card on every frame is what made it stutter.
    let centres = [];
    const measure = () => {
      centres = cards.map((c) => c.offsetLeft + FAN_W / 2);
    };
    const wasOn = new Array(cards.length).fill(false);
    // inner layers that drift at their own speed (the parallax)
    const photos = cards.map((c) => c.querySelector('.fan-card__photo img, .fan-card__photo--none span'));
    const bodies = cards.map((c) => c.querySelector('.fan-card__body'));

    const frame = () => {
      raf = 0;
      const mid = row.scrollLeft + row.clientWidth / 2;
      let best = 0;
      let bestD = Infinity;
      for (let k = 0; k < cards.length; k += 1) {
        const c = cards[k];
        const d = (centres[k] - mid) / FAN_STEP;
        const a = Math.abs(d);
        if (a > 2.6) {
          // far off screen: park it, no per-frame work
          if (c.style.opacity !== '0') c.style.opacity = '0';
          continue;
        }
        // Parallax: the card stays flat and slides; the photo inside drifts at a
        // different speed and the text trails behind it.
        const y = a < 1 ? -10 * (1 - a) : 4;
        const sc = a < 1 ? 1.03 - a * 0.1 : 0.93;
        const shift = reduce ? 0 : d * 34;
        c.style.transform = `translate3d(0, ${y}px, 0) scale(${sc})`;
        c.style.opacity = a <= 1.5 ? 1 : Math.max(0, 2.5 - a);
        if (photos[k]) photos[k].style.transform = `translate3d(${shift}px, 0, 0)`;
        if (bodies[k]) bodies[k].style.transform = `translate3d(${reduce ? 0 : d * 14}px, 0, 0)`;
        c.style.zIndex = Math.round(100 - a * 10);
        // description and price fade in continuously as the card nears the centre
        c.style.setProperty('--fan-text', String(Math.max(0, Math.min(1, 1.6 - a * 1.6))));
        const on = a < 0.5;
        if (on !== wasOn[k]) {
          wasOn[k] = on;
          c.classList.toggle('fan-card--on', on);
        }
        if (a < bestD) {
          bestD = a;
          best = Number(c.dataset.i);
        }
      }
      // only touch React when the centred dish actually changes
      if (best !== lastDot) {
        lastDot = best;
        setDot(best);
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };

    const rim = () => {
      // jump a whole copy so the row always has cards on both sides
      if (!loop) return;
      if (row.scrollLeft < setW * 0.5 || row.scrollLeft > setW * 1.5) {
        row.style.scrollSnapType = 'none';
        row.scrollLeft += row.scrollLeft < setW * 0.5 ? setW : -setW;
        requestAnimationFrame(() => {
          row.style.scrollSnapType = '';
          schedule();
        });
      }
    };
    const onScroll = () => {
      schedule();
      clearTimeout(settle);
      settle = setTimeout(rim, 120);
    };

    const place = () => {
      measure();
      row.style.setProperty('--fan-sp', `${Math.max(0, (row.clientWidth - FAN_W) / 2)}px`);
      measure();
      if (loop) {
        row.style.scrollSnapType = 'none';
        row.scrollLeft = setW;
        row.style.scrollSnapType = '';
      }
      frame();
    };
    place();
    row.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', place);
    return () => {
      row.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', place);
      cancelAnimationFrame(raf);
      clearTimeout(settle);
    };
  }, [n, loop, reduce]);

  const centre = (el) => {
    const row = rowRef.current;
    if (row) row.scrollTo({ left: el.offsetLeft + FAN_W / 2 - row.clientWidth / 2, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <div className="fan">
      <ul className="fan-row" ref={rowRef} aria-label={`${section.name} dishes`}>
        {copies.map((k) =>
          items.map((item, i) => (
            <li
              key={`${k}-${item.id}`}
              className="fan-card"
              data-i={i}
              aria-hidden={loop && k !== 1 ? 'true' : undefined}
              onClick={(e) => centre(e.currentTarget)}
            >
              {item.image ? (
                <button
                  type="button"
                  className="fan-card__photo"
                  tabIndex={k === 1 || !loop ? 0 : -1}
                  onClick={(e) => {
                    const card = e.currentTarget.closest('.fan-card');
                    if (card.classList.contains('fan-card--on')) {
                      e.stopPropagation();
                      onOpenPhotos([menuImageUrl(item.image)], 0);
                    }
                  }}
                  aria-label={`View photo of ${item.name}`}
                >
                  {/* Not lazy: cards in a sideways scroller sit off-screen, which keeps lazy images from ever loading. */}
                  <img src={menuImageUrl(item.image)} alt="" decoding="async" />
                </button>
              ) : (
                <div className="fan-card__photo fan-card__photo--none" aria-hidden="true">
                  <span>{item.name.trim().charAt(0).toUpperCase()}</span>
                </div>
              )}
              <div className="fan-card__body">
                <div className="fan-card__name">
                  <FoodMark type={item.foodType} />
                  <span>{item.name}</span>
                </div>
                {item.description && <p className="fan-card__desc">{item.description}</p>}
                <div className="fan-card__price">{menuItemPrice(item)}</div>
              </div>
            </li>
          ))
        )}
      </ul>
      {n > 1 && (
        <div className="fan-dots" aria-hidden="true">
          {items.map((it, i) => (
            <i key={it.id} className={i === dot ? 'on' : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}

// One dish: photo (or a lettered tile), name with its veg mark, description and
// price. On hover the card rises a few pixels on a soft spring and its photo
// eases in a little; nothing moves otherwise, and with reduced motion not at all.
// A touch lower than before, and the way back is slower than the way in, so a
// card settles instead of snapping down when the pointer leaves.
// The hover adds a soft gold glow around the card; both states carry the same two
// shadows so one can ease into the other.
const dishCardVariants = {
  rest: {
    y: 0,
    boxShadow: '0 12px 24px -16px rgba(8, 22, 52, 0.7), 0 0 0 0 rgba(199, 154, 43, 0)',
    transition: { type: 'spring', stiffness: 130, damping: 22 },
  },
  hover: {
    y: -3,
    boxShadow: '0 14px 28px -16px rgba(8, 22, 52, 0.7), 0 0 22px 0 rgba(199, 154, 43, 0.45)',
    transition: { type: 'spring', stiffness: 320, damping: 26 },
  },
};
const dishPhotoVariants = {
  rest: { scale: 1, transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] } },
  hover: { scale: 1.04, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
};

function DishCard({ item, onOpenPhotos }) {
  const reduce = useReducedMotion();
  return (
    <motion.li
      className="pubmenu-card"
      variants={dishCardVariants}
      initial={false}
      animate="rest"
      whileHover={reduce ? undefined : 'hover'}
    >
      {item.image ? (
        <button
          type="button"
          className="rl-card__photo"
          onClick={() => onOpenPhotos([menuImageUrl(item.image)], 0)}
          aria-label={`View photo of ${item.name}`}
        >
          <motion.img
            src={menuImageUrl(item.image)}
            alt=""
            loading="lazy"
            decoding="async"
            variants={dishPhotoVariants}
          />
        </button>
      ) : (
        <div className="rl-card__photo rl-card__photo--none" aria-hidden="true">
          <motion.span variants={dishPhotoVariants}>
            {item.name.trim().charAt(0).toUpperCase()}
          </motion.span>
        </div>
      )}
      <div className="rl-card__body">
        <div className="rl-card__name">
          <FoodMark type={item.foodType} />
          <span>{item.name}</span>
        </div>
        {item.description && <p className="rl-card__desc">{item.description}</p>}
        <div className="rl-card__price">{menuItemPrice(item)}</div>
      </div>
    </motion.li>
  );
}

// One category. On a PC: one line of equal cards that scrolls sideways, with an
// arrow on each side. On a phone: the swipe row.
function MenuShelf({ section, onOpenPhotos }) {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 560px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 560px)');
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // The arrows only show when the line is wider than the screen, and each goes
  // pale at its end.
  const rowRef = useRef(null);
  const [reach, setReach] = useState({ over: false, left: false, right: false });
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return undefined;
    const measure = () =>
      setReach({
        over: row.scrollWidth > row.clientWidth + 2,
        left: row.scrollLeft > 2,
        right: row.scrollLeft + row.clientWidth < row.scrollWidth - 2,
      });
    measure();
    row.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      row.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [phone, section.items.length]);
  const scrollRow = (dir) => rowRef.current?.scrollBy({ left: dir * rowRef.current.clientWidth * 0.8 });

  return (
    <section className="lodge-public__shelf" aria-label={section.name}>
      <div className="lodge-public__shelf-head">
        <h3 className="lodge-public__shelf-title">
          {section.name}
          <span className="lodge-public__menu-section-count">{section.items.length}</span>
        </h3>
      </div>
      {phone ? (
        <div className="rl-wrap">
          <FanRow section={section} onOpenPhotos={onOpenPhotos} />
        </div>
      ) : (
        <div className="pubmenu-wrap">
          {reach.over && (
            <button type="button" className="pubmenu-arrow pubmenu-arrow--left" onClick={() => scrollRow(-1)} disabled={!reach.left} aria-label={`Scroll ${section.name} left`}>
              &lsaquo;
            </button>
          )}
          <ul className="pubmenu-row" ref={rowRef} aria-label={`${section.name} dishes`}>
            {section.items.map((item) => (
              <DishCard key={item.id} item={item} onOpenPhotos={onOpenPhotos} />
            ))}
          </ul>
          {reach.over && (
            <button type="button" className="pubmenu-arrow pubmenu-arrow--right" onClick={() => scrollRow(1)} disabled={!reach.right} aria-label={`Scroll ${section.name} right`}>
              &rsaquo;
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// The menu card: what the kitchen serves, one shelf per category. Read-only
// on purpose: ordering happens through the QR / ordering link a guest is
// given at check-in, not from the public page.
function MenuCard({ menu, onOpenPhotos }) {
  const totalDishes = menu.reduce((n, section) => n + section.items.length, 0);
  const vegCount = menu.reduce((n, section) => n + section.items.filter((i) => i.foodType !== 'NON_VEG').length, 0);
  const allVeg = totalDishes > 0 && vegCount === totalDishes;
  const [diet, setDiet] = useState('ALL');
  // Sections left empty by the filter are dropped rather than shown as blank shelves.
  const shown = menu
    .map((section) => ({
      ...section,
      items: diet === 'ALL' ? section.items : section.items.filter((i) => (i.foodType === 'NON_VEG') === (diet === 'NON_VEG')),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <div className="lodge-public__menu">
      <div className="lodge-public__menu-head">
        <div>
          <div className="lodge-public__menu-title">Menu card</div>
          <div className="lodge-public__menu-meta">
            {totalDishes} dish{totalDishes === 1 ? '' : 'es'} · {menu.length} section{menu.length === 1 ? '' : 's'}
            {allVeg ? ' · Pure veg' : ''}
          </div>
        </div>
        {vegCount > 0 && vegCount < totalDishes && (
          <div className="lodge-public__diet" role="group" aria-label="Filter menu">
            {[['ALL', 'All'], ['VEG', 'Veg'], ['NON_VEG', 'Non-veg']].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`lodge-public__diet-btn${diet === key ? ' is-active' : ''}`}
                aria-pressed={diet === key}
                onClick={() => setDiet(key)}
              >
                {key !== 'ALL' && <FoodMark type={key} />}
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {shown.map((section) => (
        <MenuShelf
          key={section.id}
          // Veg first, then non-veg, like the ordering page; sort is stable so each group keeps its menu order.
          section={{ ...section, items: [...section.items].sort((a, b) => (a.foodType === 'NON_VEG') - (b.foodType === 'NON_VEG')) }}
          onOpenPhotos={onOpenPhotos}
        />
      ))}
    </div>
  );
}


function RoomTypeCard({ lodge, type, onOpenPhotos, onEnquireRoom }) {
  const motionProps = useCardMotion();
  const availability = availabilityOf(type);
  const isUnavailable = type.availableCount === 0;
  const canEnquire = Boolean(lodge.whatsappNumber) || Boolean(lodge.phone);

  const beds = type.bedSizes.map((b) => bedSizeLabel[b]).filter(Boolean);
  const baths = type.bathroomTypes.map((b) => bathroomTypeLabel[b]).filter(Boolean);
  // The ceiling only: rooms of one type can differ ("2–4"), and "Max" over a
  // range would say nothing a guest counting heads could use.
  const sleeps = type.maxOccupancy && `Max ${type.maxOccupancy} ${type.maxOccupancy === 1 ? 'Guest' : 'Guests'}`;

  const chips = [beds.length > 0 && `${joinWords(beds)} bed`, baths.length > 0 && joinWords(baths), sleeps].filter(
    Boolean
  );

  const facts = [...chips, `${type.roomCount} room${type.roomCount === 1 ? '' : 's'}`];

  return (
    <motion.div className={`lodge-public__room gl-room${isUnavailable ? ' lodge-public__room--unavailable' : ''}`} {...motionProps}>
      {type.images.length > 0 && (
        <div className="gl-room__cover">
          <button
            type="button"
            className="lodge-public__room-cover-btn"
            onClick={() => onOpenPhotos(type.images.map(roomImageUrl), 0)}
            aria-label={`View photos of the ${type.name} room`}
          >
            <img
              src={roomImageUrl(type.images[0])}
              alt={`${type.name} room at ${lodge.name}`}
              className="lodge-public__room-img"
              loading="lazy"
              decoding="async"
            />
          </button>
          {type.images.length > 1 && <span className="lodge-public__photo-count">+{type.images.length - 1}</span>}
        </div>
      )}

      <div className="gl-room__body">
        <span className="gl-room__tag" aria-hidden="true" />
        <div className="gl-room__head">
          <h3 className="gl-room__name">{type.name}</h3>
          {availability && (
            <span className={`lodge-public__availability-badge lodge-public__availability-badge--${availability.tone} gl-room__avail`}>
              {availability.label}
            </span>
          )}
        </div>

        <ul className="gl-room__facts">
          {facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>

        {type.description && <p className="gl-room__desc">{type.description}</p>}

        <div className="gl-room__foot">
          <div className="gl-room__price">
            <b>{formatPrice(type.price)}</b>
            <small>per night</small>
          </div>
          {canEnquire ? (
            <button type="button" className="gl-room__btn" onClick={() => onEnquireRoom(type.id)}>
              {isUnavailable ? 'Other dates' : 'Book'}
            </button>
          ) : (
            <p className="lodge-public__no-whatsapp">Call {lodge.phone || 'the lodge'} to enquire.</p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

const EVENT_TYPES = ['Wedding', 'Reception', 'Birthday', 'Anniversary', 'Corporate event', 'Other'];

// One modal for every "Enquire" entry point on the page, room and event alike.
// Submitting stores the enquiry on the server (it lands in the lodge's
// dashboard inbox) and shows the guest a reference code. WhatsApp is only an
// optional follow-up link on the success screen, never the transport.
function EnquireModal({ lodge, roomTypes, roomAddons, venues, eventAddons, menuAvailable, initial, onClose, onViewMenu }) {
  // `initial.kind` is 'room' | 'event' | null. Null means the lodge offers
  // both and the visitor hasn't said which one they want yet.
  const [kind, setKind] = useState(initial.kind || null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');

  const [checkInDate, setCheckInDate] = useState(initial.checkInDate || todayIso());
  const [checkOutDate, setCheckOutDate] = useState(initial.checkOutDate || addDays(todayIso(), 1));
  const [roomTypeId, setRoomTypeId] = useState(initial.roomTypeId ? String(initial.roomTypeId) : 'ANY');
  const [guests, setGuests] = useState('');
  const [roomAddonIds, setRoomAddonIds] = useState([]);

  const [eventDate, setEventDate] = useState(initial.eventDate || '');
  const [eventType, setEventType] = useState(initial.eventType || EVENT_TYPES[0]);
  const [venueId, setVenueId] = useState(initial.venueId ? String(initial.venueId) : 'ANY');
  const [eventGuests, setEventGuests] = useState(initial.eventGuests || '');
  const [eventAddonIds, setEventAddonIds] = useState([]);

  const [website, setWebsite] = useState(''); // honeypot — real guests never see it
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [referenceCode, setReferenceCode] = useState('');

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const toggleAddon = (setFn, id) => {
    setFn((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  };

  const buildMessage = () => {
    const who = name.trim() ? `My name is ${name.trim()}. ` : '';
    if (kind === 'service') {
      const lines = [`Hi! I'd like to know more about ${initial.serviceName} at ${lodge.name}.`, who];
      if (notes.trim()) lines.push(`Note: ${notes.trim()}`);
      if (phone.trim()) lines.push(`My phone: ${phone.trim()}.`);
      return lines.filter(Boolean).join('\n');
    }
    if (kind === 'room') {
      const type = roomTypes.find((t) => String(t.id) === roomTypeId);
      const lines = [
        `Hi! I'd like to enquire about a room at ${lodge.name}.`,
        who,
        `Dates: ${formatDateLong(checkInDate)} – ${formatDateLong(checkOutDate)}.`,
        `Room type: ${type ? type.name : 'Any available'}.`,
        guests ? `Guests: ${guests}.` : null,
      ];
      if (roomAddonIds.length > 0) {
        const names = roomAddons.filter((a) => roomAddonIds.includes(a.id)).map((a) => a.name);
        lines.push(`Also interested in: ${names.join(', ')}.`);
      }
      if (notes.trim()) lines.push(`Note: ${notes.trim()}`);
      if (phone.trim()) lines.push(`My phone: ${phone.trim()}.`);
      return lines.filter(Boolean).join('\n');
    }
    const venue = venues.find((v) => String(v.id) === venueId);
    const lines = [
      `Hi! I'd like to enquire about an event at ${lodge.name}.`,
      who,
      `Event type: ${eventType}.`,
      eventDate ? `Date: ${formatDateLong(eventDate)}.` : null,
      `Venue: ${venue ? venue.name : 'Any available'}.`,
      eventGuests ? `Expected guests: ${eventGuests}.` : null,
    ];
    if (eventAddonIds.length > 0) {
      const names = eventAddons.filter((a) => eventAddonIds.includes(a.id)).map((a) => a.name);
      lines.push(`Also interested in: ${names.join(', ')}.`);
    }
    if (notes.trim()) lines.push(`Note: ${notes.trim()}`);
    if (phone.trim()) lines.push(`My phone: ${phone.trim()}.`);
    return lines.filter(Boolean).join('\n');
  };

  const message = buildMessage();
  const whatsappLink = buildWhatsAppLink(
    lodge.whatsappNumber,
    referenceCode ? `${message}\nReference: ${referenceCode}` : message
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError('');
    setSubmitting(true);
    const isRoom = kind === 'room';
    const isService = kind === 'service';
    const type = isRoom ? roomTypes.find((t) => String(t.id) === roomTypeId) : null;
    const venue = kind === 'event' ? venues.find((v) => String(v.id) === venueId) : null;
    try {
      const result = await apiPost(`/public/lodges/${lodge.slug}/enquiries`, {
        kind: isService ? 'SERVICE' : isRoom ? 'ROOM' : 'EVENT',
        name: name.trim(),
        phone: phone.trim(),
        checkInDate: isRoom ? checkInDate : null,
        checkOutDate: isRoom ? checkOutDate : null,
        eventDate: kind === 'event' && eventDate ? eventDate : null,
        eventType: kind === 'event' ? eventType : null,
        roomTypeId: type ? type.id : null,
        venueId: venue ? venue.id : null,
        guests: isService ? null : (isRoom ? guests : eventGuests) || null,
        addonIds: isService ? [] : isRoom ? roomAddonIds : eventAddonIds,
        notes: notes.trim() || null,
        website,
      });
      setReferenceCode(result.referenceCode);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send your enquiry. Please try again or call the lodge.');
    } finally {
      setSubmitting(false);
    }
  };

  const title = kind === 'room' ? 'Room enquiry' : kind === 'event' ? 'Event enquiry' : kind === 'service' ? initial.serviceName : 'What are you enquiring about?';

  return (
    <div className="lodge-public__modal-overlay" onClick={onClose}>
      <div className="lodge-public__modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="lodge-public__modal-head">
          <h3>{title}</h3>
          <button type="button" className="lodge-public__modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {referenceCode ? (
          <div className="lodge-public__modal-success">
            <p>
              <strong>Thank you{name.trim() ? `, ${name.trim()}` : ''}!</strong> {lodge.name} has received your enquiry and will
              contact you on {phone.trim()}.
            </p>
            <p>
              Your reference: <strong>{referenceCode}</strong>
            </p>
            <div className="lodge-public__modal-actions">
              {whatsappLink && (
                <a className="site-btn site-btn--ghost" href={whatsappLink} target="_blank" rel="noopener noreferrer">
                  Also message on WhatsApp
                </a>
              )}
              <button type="button" className="site-btn site-btn--primary" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : !kind ? (
          <div className="lodge-public__modal-choice">
            <button type="button" className="lodge-public__modal-choice-btn" onClick={() => setKind('room')}>
              <span className="lodge-public__modal-choice-title">Room enquiry</span>
              <span className="lodge-public__modal-choice-sub">Book a stay</span>
            </button>
            <button type="button" className="lodge-public__modal-choice-btn" onClick={() => setKind('event')}>
              <span className="lodge-public__modal-choice-title">Event enquiry</span>
              <span className="lodge-public__modal-choice-sub">Weddings & functions</span>
            </button>
          </div>
        ) : (
          <form className="lodge-public__modal-form" onSubmit={handleSubmit}>
            <div className="lodge-public__modal-row">
              <div className="lodge-public__date-field">
                <label htmlFor="enqName">Your name</label>
                <input id="enqName" type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
              </div>
              <div className="lodge-public__date-field">
                <label htmlFor="enqPhone">Phone number</label>
                <input id="enqPhone" type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" />
              </div>
            </div>

            {kind === 'service' ? null : kind === 'room' ? (
              <>
                <div className="lodge-public__modal-row">
                  <div className="lodge-public__date-field">
                    <label htmlFor="enqCheckIn">Check-in</label>
                    <input
                      id="enqCheckIn"
                      type="date"
                      min={todayIso()}
                      value={checkInDate}
                      onChange={(e) => {
                        setCheckInDate(e.target.value);
                        if (checkOutDate <= e.target.value) setCheckOutDate(addDays(e.target.value, 1));
                      }}
                    />
                  </div>
                  <div className="lodge-public__date-field">
                    <label htmlFor="enqCheckOut">Check-out</label>
                    <input
                      id="enqCheckOut"
                      type="date"
                      min={addDays(checkInDate, 1)}
                      value={checkOutDate}
                      onChange={(e) => setCheckOutDate(e.target.value)}
                    />
                  </div>
                </div>

                <div className="lodge-public__modal-row">
                  {roomTypes.length > 0 && (
                    <div className="lodge-public__date-field lodge-public__date-field--wide">
                      <label htmlFor="enqRoomType">Room type</label>
                      <select id="enqRoomType" value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)}>
                        <option value="ANY">Any available</option>
                        {roomTypes.map((t) => (
                          <option key={t.id} value={String(t.id)}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="lodge-public__date-field">
                    <label htmlFor="enqGuests">Guests</label>
                    <input
                      id="enqGuests"
                      type="number"
                      min={1}
                      placeholder="e.g. 2"
                      value={guests}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setGuests(raw === '' ? '' : Math.max(1, Number(raw) || 1));
                      }}
                    />
                  </div>
                </div>

                {roomAddons.length > 0 && (
                  <div className="lodge-public__modal-field">
                    <label>Booking extras</label>
                    <div className="lodge-public__modal-addons">
                      {roomAddons.map((a) => (
                        <label className="lodge-public__modal-addon" key={a.id}>
                          <input
                            type="checkbox"
                            checked={roomAddonIds.includes(a.id)}
                            onChange={() => toggleAddon(setRoomAddonIds, a.id)}
                          />
                          <span>{a.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="lodge-public__modal-row">
                  <div className="lodge-public__date-field">
                    <label htmlFor="enqEventDate">Event date</label>
                    <input id="enqEventDate" type="date" min={todayIso()} value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
                  </div>
                  <div className="lodge-public__date-field">
                    <label htmlFor="enqEventType">Event type</label>
                    <select id="enqEventType" value={eventType} onChange={(e) => setEventType(e.target.value)}>
                      {EVENT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="lodge-public__modal-row">
                  {venues.length > 0 && (
                    <div className="lodge-public__date-field lodge-public__date-field--wide">
                      <label htmlFor="enqVenue">Venue</label>
                      <select id="enqVenue" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
                        <option value="ANY">Any available</option>
                        {venues.map((v) => (
                          <option key={v.id} value={String(v.id)}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="lodge-public__date-field">
                    <label htmlFor="enqEventGuests">Expected guests</label>
                    <input
                      id="enqEventGuests"
                      type="number"
                      min={1}
                      placeholder="e.g. 50"
                      value={eventGuests}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setEventGuests(raw === '' ? '' : Math.max(1, Number(raw) || 1));
                      }}
                    />
                  </div>
                </div>

                {eventAddons.length > 0 && (
                  <div className="lodge-public__modal-field">
                    <label>Add-ons available</label>
                    <div className="lodge-public__modal-addons">
                      {eventAddons.map((a) => (
                        <label className="lodge-public__modal-addon" key={a.id}>
                          <input
                            type="checkbox"
                            checked={eventAddonIds.includes(a.id)}
                            onChange={() => toggleAddon(setEventAddonIds, a.id)}
                          />
                          <span>{a.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {menuAvailable && (
                  <button type="button" className="lodge-public__modal-menu-link" onClick={onViewMenu}>
                    View menu
                  </button>
                )}
              </>
            )}

            <div className="lodge-public__modal-field">
              <label htmlFor="enqNotes">Additional message</label>
              <textarea
                id="enqNotes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything else we should know?"
              />
            </div>

            <input
              type="text"
              name="website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
            />

            {error && (
              <p className="lodge-public__modal-error" role="alert">
                {error}
              </p>
            )}

            <div className="lodge-public__modal-actions">
              <button type="button" className="site-btn site-btn--ghost lodge-public__modal-back" onClick={() => (initial.kind ? onClose() : setKind(null))}>
                {initial.kind ? 'Cancel' : 'Back'}
              </button>
              <button type="submit" className="site-btn site-btn--primary" disabled={submitting}>
                {submitting ? 'Sending…' : 'Send enquiry'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function LodgePublicPage() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [lightbox, setLightbox] = useState(null);
  const [enquireModal, setEnquireModal] = useState(null);
  // The phone nav's three-dot menu.
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);
  const reduceMotion = useReducedMotion();

  // Every button and button-like link on the page gets the same spring: it
  // rises a little under the pointer and squeezes when pressed. One delegated
  // listener on the document, so buttons that appear later (after the data
  // loads, in the modal, in cards) are covered too. Mouse only, so a touch
  // never leaves a button stuck raised; off with reduced motion.
  useEffect(() => {
    if (reduceMotion) return undefined;
    // Left out: the photo viewer's buttons and the photo thumbnails, which are
    // positioned with their own transforms, and the tab pill whose highlight slides.
    const SEL =
      'button:not(:disabled):not(.lodge-public__lightbox-nav):not(.lodge-public__lightbox-close):not(.lodge-public__room-cover-btn):not(.lodge-public__dish-photo):not(.gl-tab), a.site-btn, .gl-nav__cta, .gl-nav__link, .site-glance__row, .site-contact__map, .gl-room__btn, .gl-venue__btn';
    const spring = { type: 'spring', stiffness: 380, damping: 24 };
    const target = (e) => (e.target instanceof Element ? e.target.closest(SEL) : null);
    const onOver = (e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      const el = target(e);
      if (el && !el.contains(e.relatedTarget)) animate(el, { y: -3 }, spring);
    };
    const onOut = (e) => {
      const el = target(e);
      if (el && !el.contains(e.relatedTarget)) animate(el, { y: 0, scale: 1 }, spring);
    };
    const onDown = (e) => {
      const el = target(e);
      if (el) animate(el, { scale: 0.96 }, { duration: 0.1 });
    };
    const onUp = (e) => {
      const el = target(e);
      if (el) animate(el, { scale: 1 }, spring);
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
  }, [reduceMotion]);

  // Defaults to tonight → tomorrow so the page shows real availability the
  // moment it loads, without making a guest pick dates first.
  const [checkInDate, setCheckInDate] = useState(todayIso());
  const [checkOutDate, setCheckOutDate] = useState(addDays(todayIso(), 1));
  const [availabilityLoading, setAvailabilityLoading] = useState(false);

  // Which section is under the reader, for the nav strip to underline. An
  // observer rather than scroll maths: it fires only when a section crosses
  // the band just below the sticky nav, and costs nothing between crossings.
  const [activeSection, setActiveSection] = useState('');
  // The hero photo is a real <img> rather than a CSS background so a file
  // that has gone missing (a row can outlive its upload) reports an error
  // and the hero falls back to the brand gradient instead of a grey wash.
  const [heroBroken, setHeroBroken] = useState(false);
  const [heroLoaded, setHeroLoaded] = useState(false);
  useEffect(() => {
    if (!data || typeof IntersectionObserver === 'undefined') return undefined;
    const targets = ['home', 'rooms', 'events', 'menu', 'services', 'reviews', 'contact'].map((id) => document.getElementById(id)).filter(Boolean);
    if (targets.length === 0) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) setActiveSection(visible[0].target.id);
      },
      { rootMargin: '-72px 0px -60% 0px', threshold: 0 }
    );
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, [data]);

  const validDateRange = checkOutDate > checkInDate;

  // How a guest narrows a rate card: which type, how many of them there are,
  // whether to bother showing what's already gone, and which end of the price
  // list to start from. All of it runs over what the page already holds — the
  // server sends a handful of room types, so there is nothing here worth a
  // round trip.
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [guestFilter, setGuestFilter] = useState(0);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [sortBy, setSortBy] = useState('price-asc');

  const openLightbox = (images, index) => setLightbox({ images, index });
  const closeLightbox = () => setLightbox(null);
  const showPrevImage = () =>
    setLightbox((lb) => (lb ? { ...lb, index: (lb.index - 1 + lb.images.length) % lb.images.length } : lb));
  const showNextImage = () =>
    setLightbox((lb) => (lb ? { ...lb, index: (lb.index + 1) % lb.images.length } : lb));

  const handleCheckInChange = (value) => {
    setCheckInDate(value);
    if (checkOutDate <= value) setCheckOutDate(addDays(value, 1));
  };

  useEffect(() => {
    if (!validDateRange) return;
    setAvailabilityLoading(true);
    apiGet(`/public/lodges/${slug}?checkInDate=${checkInDate}&checkOutDate=${checkOutDate}`)
      .then((res) => {
        setData(res);
        setError('');
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Could not load this lodge.');
      })
      .finally(() => setAvailabilityLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, checkInDate, checkOutDate]);

  useEffect(() => {
    if (!lightbox) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') showPrevImage();
      if (e.key === 'ArrowRight') showNextImage();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(lightbox)]);

  if (error) {
    return (
      <div className="lodge-public site lodge-public--state">
        <p>{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="lodge-public site" aria-busy="true" aria-label="Loading">
        <div className="lodge-public__skeleton lodge-public__skeleton--hero" />
        <div className="site-container lodge-public__skeleton-row">
          <div className="lodge-public__skeleton lodge-public__skeleton--card" />
          <div className="lodge-public__skeleton lodge-public__skeleton--card" />
          <div className="lodge-public__skeleton lodge-public__skeleton--card" />
        </div>
      </div>
    );
  }

  const { lodge, roomTypes, roomAddons = [], venues = [], addons = [], menu = [], reviews = [], otherServices = [] } = data;
  const generalMessage = `Hi! I'd like to know more about ${lodge.name}.`;

  // Which parts of the page this property has. The nav strip only appears
  // once there are two or more — one section needs no table of contents.
  const sections = [
    lodge.hasRooms && { id: 'rooms', label: 'Rooms' },
    lodge.hasEvents && venues.length > 0 && { id: 'events', label: 'Events' },
    lodge.servesFood && menu.length > 0 && { id: 'menu', label: 'Menu' },
    lodge.hasOtherServices && otherServices.length > 0 && { id: 'services', label: 'Services' },
    reviews.length > 0 && { id: 'reviews', label: 'Reviews' },
  ].filter(Boolean);
  const nothingListed = sections.length === 0 && roomTypes.length === 0;

  const fullAddress = [lodge.address, lodge.city, lodge.state].filter(Boolean).join(', ');
  const directionsLink = buildDirectionsLink(lodge);
  // No embedded map: the site's content-security policy frames nothing
  // remote, by design. The location card links out to Google Maps instead.
  const hasPin = lodge.latitude != null && lodge.longitude != null;
  const navLinks = [{ id: 'home', label: 'Home' }, ...sections, { id: 'contact', label: 'Contact' }];
  const firstSectionId = sections[0] ? sections[0].id : 'contact';
  // What kind of place this is, in the property's own terms: "Stay · Events ·
  // Dining" for a hotel with a hall and a kitchen, just "Stay" for a lodge.
  const offerings = [lodge.hasRooms && 'Stay', lodge.hasEvents && venues.length > 0 && 'Events', lodge.servesFood && menu.length > 0 && 'Dining']
    .filter(Boolean)
    .join(' · ');

  // The photos across the top: the owner's own hero pick first if they set
  // one, then room photos, then venues — the first shown as the actual
  // background, the rest reachable through the lightbox. A property with no
  // photos gets a single-column hero rather than an empty frame.
  const heroImages = [
    ...(lodge.heroImageUrl ? [`${API_BASE}${lodge.heroImageUrl}`] : []),
    ...roomTypes.flatMap((t) => t.images.map(roomImageUrl)),
    ...venues.flatMap((v) => v.images.map(venueImageUrl)),
  ].slice(0, 12);
  const showHeroPhoto = heroImages.length > 0 && !heroBroken;

  const cheapestRate = roomTypes.reduce((min, t) => (min == null || t.price < min ? t.price : min), null);
  const totalRooms = roomTypes.reduce((n, t) => n + (t.roomCount || 0), 0);
  const allVegMenu =
    menu.length > 0 && menu.every((section) => section.items.every((item) => item.foodType !== 'NON_VEG'));
  // Only the owner's fixed cycle shows its clock times ("In 11:00 AM · Out 9:00 AM");
  // every other mode keeps its plain label.
  const checkinType = lodge.hasRooms
    ? lodge.checkinMode === 'CYCLE' && lodge.checkInTime && lodge.checkOutTime
      ? `In ${formatClock(lodge.checkInTime)} · Out ${formatClock(lodge.checkOutTime)}`
      : CHECKIN_MODE_LABEL[lodge.checkinMode]
    : null;

  const totalDishes = menu.reduce((n, section) => n + section.items.length, 0);
  const largestVenue = venues.reduce((max, v) => Math.max(max, v.capacityPax || 0), 0);
  const glance = [
    lodge.hasRooms &&
      roomTypes.length > 0 && {
        id: 'rooms',
        title: 'Rooms & stays',
        detail: `${roomTypes.length} room type${roomTypes.length === 1 ? '' : 's'}${cheapestRate != null ? ` · from ${formatPrice(cheapestRate)} a night` : ''}`,
        cta: 'See rooms',
      },
    lodge.hasEvents &&
      venues.length > 0 && {
        id: 'events',
        title: 'Weddings & functions',
        detail: `${venues.length} venue${venues.length === 1 ? '' : 's'}${largestVenue > 0 ? ` · up to ${largestVenue} guests` : ''}${addons.length > 0 ? ` · ${addons.length} add-on${addons.length === 1 ? '' : 's'}` : ''}`,
        cta: 'See venues',
      },
    lodge.servesFood &&
      menu.length > 0 && {
        id: 'menu',
        title: allVegMenu ? 'Pure-veg restaurant' : 'Restaurant',
        detail: `${totalDishes} dish${totalDishes === 1 ? '' : 'es'} across ${menu.length} section${menu.length === 1 ? '' : 's'}${lodge.foodRoomService ? ' · room service' : ''}`,
        cta: 'See menu',
      },
    lodge.hasOtherServices &&
      otherServices.length > 0 && {
        id: 'services',
        title: 'Other services',
        detail: `${otherServices.length} service${otherServices.length === 1 ? '' : 's'} available`,
        cta: 'See services',
      },
    {
      id: 'contact',
      title: 'Find us',
      detail: [lodge.city, lodge.state].filter(Boolean).join(', ') || 'Contact & directions',
      cta: 'Contact',
    },
  ].filter(Boolean);

  const facts = [
    cheapestRate != null && { icon: 'price', value: formatPrice(cheapestRate), label: 'per night, from' },
    totalRooms > 0 && { icon: 'rooms', value: String(totalRooms), label: totalRooms === 1 ? 'room' : 'rooms' },
    lodge.hasEvents && venues.length > 0 && { icon: 'venues', value: String(venues.length), label: venues.length === 1 ? 'venue' : 'venues' },
    lodge.servesFood && menu.length > 0 && { icon: 'food', value: allVegMenu ? 'Pure veg' : 'Veg & non-veg', label: 'restaurant' },
    checkinType && {
      icon: 'clock',
      value: checkinType,
      label: lodge.checkinMode === 'CYCLE' ? 'Fixed check-in / checkout cycle' : 'check-in',
      wide: true,
    },
  ].filter(Boolean);

  // "Available only" can only mean something once dates have been chosen —
  // without them the page doesn't know what is free, and the toggle would
  // silently empty the list.
  const canFilterAvailability = validDateRange && roomTypes.some((t) => t.availableCount != null);
  const largestRoom = roomTypes.reduce((max, t) => Math.max(max, t.maxOccupancy || 0), 0);

  const matchesType = (t) => typeFilter === 'ALL' || String(t.id) === typeFilter;
  const matchesGuests = (t) => guestFilter === 0 || (t.maxOccupancy || 0) >= guestFilter;
  const matchesAvailability = (t) => !availableOnly || !canFilterAvailability || t.availableCount > 0;

  const visibleTypes = roomTypes
    .filter((t) => matchesType(t) && matchesGuests(t) && matchesAvailability(t))
    // Cheapest first is how the server sends them and how a rate card reads;
    // this only has to handle being asked for the other direction.
    .slice()
    .sort((a, b) => (sortBy === 'price-desc' ? b.price - a.price : a.price - b.price));

  const filtersApplied = typeFilter !== 'ALL' || guestFilter > 0 || availableOnly;
  const clearFilters = () => {
    setTypeFilter('ALL');
    setGuestFilter(0);
    setAvailableOnly(false);
  };
  const heroNavLinks = navLinks.filter((l) => l.id !== 'home');

  const generalWhatsappLink = buildWhatsAppLink(lodge.whatsappNumber, generalMessage);
  const menuAvailable = lodge.servesFood && menu.length > 0;

  // The navbar CTA only asks "room or event?" when the lodge actually offers
  // both — a lodge with just rooms (or just a hall) already knows what kind
  // of enquiry this is, so skip straight to that form.
  const openNavEnquire = () => {
    const bothOffered = lodge.hasRooms && lodge.hasEvents && venues.length > 0;
    setEnquireModal({
      kind: bothOffered ? null : lodge.hasEvents && venues.length > 0 ? 'event' : 'room',
      checkInDate: validDateRange ? checkInDate : undefined,
      checkOutDate: validDateRange ? checkOutDate : undefined,
    });
  };
  const openRoomEnquire = (roomTypeId) => {
    setEnquireModal({
      kind: 'room',
      roomTypeId,
      checkInDate: validDateRange ? checkInDate : undefined,
      checkOutDate: validDateRange ? checkOutDate : undefined,
    });
  };
  const openEventEnquire = (venueId) => setEnquireModal({ kind: 'event', venueId });
  const openServiceEnquire = (serviceName) => setEnquireModal({ kind: 'service', serviceName });
  const closeEnquireModal = () => setEnquireModal(null);
  const jumpToMenu = () => {
    closeEnquireModal();
    document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="lodge-public site" id="top">
      <motion.nav
        className="gl-nav"
        aria-label="Site"
        initial={reduceMotion ? false : { opacity: 0, y: -24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="gl-nav__in">
          <a className="gl-nav__brand" href="#top">
            {logoUrl(lodge) ? (
              <img className="gl-nav__logo" src={logoUrl(lodge)} alt="" />
            ) : (
              <span className="gl-nav__logo gl-nav__logo--letter" aria-hidden="true">
                {(lodge.name || '?').trim().charAt(0).toUpperCase()}
              </span>
            )}
            <span className="gl-nav__name">{lodge.name}</span>
          </a>
          <div className="gl-nav__links">
            {heroNavLinks.map((sec) => (
              <a
                className={`gl-nav__link${activeSection === sec.id ? ' gl-nav__link--active' : ''}`}
                href={`#${sec.id}`}
                key={sec.id}
                aria-current={activeSection === sec.id ? 'true' : undefined}
              >
                {sec.label}
              </a>
            ))}
          </div>
          <button type="button" className="gl-nav__cta" onClick={openNavEnquire}>
            Book now
          </button>
          <button
            type="button"
            className={`gl-nav__more${menuOpen ? ' gl-nav__more--open' : ''}`}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="gl-nav-sheet"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span className="gl-nav__dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </button>

          <AnimatePresence>
            {menuOpen && (
              <motion.div
                id="gl-nav-sheet"
                className="gl-nav__sheet"
                initial={reduceMotion ? false : { opacity: 0, y: -10, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.96, transition: { duration: 0.14 } }}
                transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              >
                <motion.ul
                  initial="hidden"
                  animate="shown"
                  variants={{ shown: { transition: { staggerChildren: reduceMotion ? 0 : 0.045, delayChildren: 0.05 } } }}
                >
                  {heroNavLinks.map((sec) => (
                    <motion.li
                      key={sec.id}
                      variants={{ hidden: { opacity: 0, x: reduceMotion ? 0 : -10 }, shown: { opacity: 1, x: 0 } }}
                    >
                      <a
                        className={`gl-nav__item${activeSection === sec.id ? ' gl-nav__item--active' : ''}`}
                        href={`#${sec.id}`}
                        aria-current={activeSection === sec.id ? 'true' : undefined}
                        onClick={() => setMenuOpen(false)}
                      >
                        {sec.label}
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M6 3l5 5-5 5" />
                        </svg>
                      </a>
                    </motion.li>
                  ))}
                </motion.ul>
                <motion.button
                  type="button"
                  className="gl-nav__sheet-cta"
                  initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: reduceMotion ? 0 : 0.05 + heroNavLinks.length * 0.045, duration: 0.25 }}
                  whileTap={reduceMotion ? undefined : { scale: 0.97 }}
                  onClick={() => {
                    setMenuOpen(false);
                    openNavEnquire();
                  }}
                >
                  Book now
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              className="gl-nav__scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setMenuOpen(false)}
            />
          )}
        </AnimatePresence>
      </motion.nav>

      <header className={`site-hero${showHeroPhoto ? ' site-hero--photo' : ''}`} id="home">
        {heroImages.length > 0 && !heroBroken && (
          <img
            className={`site-hero__img${heroLoaded ? ' site-hero__img--loaded' : ''}`}
            src={heroImages[0]}
            alt=""
            fetchPriority="high"
            onLoad={() => setHeroLoaded(true)}
            onError={() => setHeroBroken(true)}
          />
        )}
        <div className="site-hero__scrim" />
        <div className="site-container site-hero__inner">
          <div className="site-hero__copy">
          {(offerings || lodge.city) && (
            <span className="lodge-public__eyebrow lodge-public__eyebrow--light">
              {[offerings, lodge.city].filter(Boolean).join('  ·  ')}
            </span>
          )}
          <h1>{lodge.name}</h1>
          {fullAddress && <p className="lodge-public__address">{fullAddress}</p>}

          <div className="site-hero__actions">
            {generalWhatsappLink && (
              <a className="site-btn site-btn--whatsapp" href={generalWhatsappLink} target="_blank" rel="noopener noreferrer">
                Chat on WhatsApp
              </a>
            )}
            {lodge.phone && (
              <a className="site-btn site-btn--ghost" href={`tel:${lodge.phone}`}>
                Call {lodge.phone}
              </a>
            )}
            {heroImages.length > 0 && (
              <button type="button" className="site-btn site-btn--ghost" onClick={() => openLightbox(heroImages, 0)}>
                View photos ({heroImages.length})
              </button>
            )}
          </div>

          {facts.length > 0 && (
            <ul className="lodge-public__facts">
              {facts.map((fact) => (
                <li key={fact.label} className={fact.wide ? 'lodge-public__fact--wide' : undefined}>
                  <span className="lodge-public__fact-icon" aria-hidden="true">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      {FACT_ICONS[fact.icon]}
                    </svg>
                  </span>
                  <span className="lodge-public__fact-text">
                    <strong>{fact.value}</strong>
                    <span>{fact.label}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          </div>

          {/* What the property is, in one glance, each row a door into its
              section. This is what makes the opening screen informative
              rather than just a name on a photo. */}
          <aside className="site-glance" aria-label="At a glance">
            <div className="site-glance__head">At a glance</div>
            <ul className="site-glance__list">
              {glance.map((row) => (
                <li key={row.id}>
                  <a className="site-glance__row" href={`#${row.id}`}>
                    <span className="site-glance__text">
                      <span className="site-glance__title">{row.title}</span>
                      <span className="site-glance__detail">{row.detail}</span>
                    </span>
                    <span className="site-glance__cta">{row.cta} →</span>
                  </a>
                </li>
              ))}
            </ul>
            {(lodge.phone || generalWhatsappLink) && (
              <div className="site-glance__foot">
                {lodge.phone && <a href={`tel:${lodge.phone}`}>{lodge.phone}</a>}
                {generalWhatsappLink && (
                  <a href={generalWhatsappLink} target="_blank" rel="noopener noreferrer">
                    WhatsApp
                  </a>
                )}
              </div>
            )}
          </aside>
        </div>

        <a className="site-hero__scroll" href={`#${firstSectionId}`} aria-label="Scroll to content">
          <span>Explore</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </a>
      </header>

      {nothingListed && (
        <p className="lodge-public__empty">Nothing is listed yet — please check back soon.</p>
      )}

      {lodge.hasRooms && roomTypes.length === 0 && !nothingListed && (
        <p className="lodge-public__empty">No rooms are listed yet — please check back soon.</p>
      )}

      {roomTypes.length > 0 && (
        <section className="lodge-public__rooms site-section" id="rooms">
          <div className="site-container">
          {/* A titled section rather than a bare grid of cards: it is the
              difference between a page that lists things and a page that is
              showing you its rooms. */}
          <div className="lodge-public__section-head lodge-public__section-head--row">
            <div>
            <h2>Our rooms</h2>
            <p>
              {validDateRange
                ? `Rates and availability for ${formatDateLong(checkInDate)} – ${formatDateLong(checkOutDate)}.`
                : 'Choose your dates above to see what’s free.'}
            </p>
            </div>
            <button type="button" className="gl-head-btn" onClick={() => openRoomEnquire(undefined)}>
              Book a room
            </button>
          </div>

          {/* Dates and filters in one panel: they are all the same act — a
              guest saying what they want — and splitting them across a card and
              a loose row made the page look assembled rather than designed.
              Every control is still left out when it couldn't change what is on
              screen: a lone room type needs no type filter, and one shared
              occupancy needs no guest picker. */}
          <div className="lodge-public__search">
            <div className="lodge-public__search-row">
              <div className="lodge-public__date-field">
                <label htmlFor="publicCheckIn">Check-in</label>
                <input
                  id="publicCheckIn"
                  type="date"
                  min={todayIso()}
                  value={checkInDate}
                  onChange={(e) => handleCheckInChange(e.target.value)}
                />
              </div>
              <div className="lodge-public__date-field">
                <label htmlFor="publicCheckOut">Check-out</label>
                <input
                  id="publicCheckOut"
                  type="date"
                  min={addDays(checkInDate, 1)}
                  value={checkOutDate}
                  onChange={(e) => setCheckOutDate(e.target.value)}
                />
              </div>

              {/* Beside the dates rather than as a row of chips underneath: a
                  property with a dozen categories wrapped to three lines of
                  pills, which pushed the rooms themselves below the fold and
                  read as navigation rather than as one of the things being
                  asked. As a select it is the same act as the fields around it
                  — when, what, how many — and takes one line whatever the
                  property's list looks like. */}
              {roomTypes.length > 1 && (
                <div className="lodge-public__date-field lodge-public__date-field--wide">
                  <label htmlFor="publicRoomType">Room type</label>
                  <select
                    id="publicRoomType"
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                  >
                    <option value="ALL">All room types</option>
                    {roomTypes.map((t) => {
                      // Through availabilityOf, so the dropdown says exactly
                      // what the card says. A raw count here would publish the
                      // property's free-room tally, which that helper is
                      // deliberately written not to do — and only the answers
                      // that change a decision are worth the words: "Available"
                      // against every row is noise.
                      const availability = availabilityOf(t);
                      const note =
                        availability && availability.tone !== 'yes' ? ` — ${availability.label}` : '';
                      return (
                        <option key={t.id} value={String(t.id)}>
                          {t.name}
                          {note}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              {largestRoom > 0 && (
                <div className="lodge-public__date-field">
                  <label htmlFor="publicGuests">Guests</label>
                  <select
                    id="publicGuests"
                    value={guestFilter}
                    onChange={(e) => setGuestFilter(Number(e.target.value))}
                  >
                    <option value={0}>Any</option>
                    {Array.from({ length: largestRoom }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n} guest{n === 1 ? '' : 's'}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {roomTypes.length > 1 && (
                <div className="lodge-public__date-field">
                  <label htmlFor="publicSort">Sort by</label>
                  <select id="publicSort" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                    <option value="price-asc">Price: low to high</option>
                    <option value="price-desc">Price: high to low</option>
                  </select>
                </div>
              )}

              {/* Pushed to the far end, away from the fields it isn't one of —
                  a switch reading over the results, not another thing to fill
                  in. */}
              {canFilterAvailability && (
                <label className="lodge-public__filter-toggle">
                  <input
                    type="checkbox"
                    checked={availableOnly}
                    onChange={(e) => setAvailableOnly(e.target.checked)}
                  />
                  <span>Available only</span>
                </label>
              )}
            </div>

            {(availabilityLoading || !validDateRange) && (
              <div className="lodge-public__search-status">
                {availabilityLoading && (
                  <span className="lodge-public__dates-status">Checking availability…</span>
                )}
                {!validDateRange && (
                  <span className="lodge-public__dates-status lodge-public__dates-status--error">
                    Check-out must be after check-in.
                  </span>
                )}
              </div>
            )}

            {/* Only once something is actually filtered — an always-present
                "clear" on an unfiltered page is a control that does nothing. */}
            {filtersApplied && (
              <div className="lodge-public__search-chips">
                <span className="lodge-public__filter-summary">
                  Showing {visibleTypes.length} of {roomTypes.length} room types
                </span>
                <button type="button" className="lodge-public__filter-clear" onClick={clearFilters}>
                  Clear filters
                </button>
              </div>
            )}
          </div>

          {visibleTypes.length === 0 ? (
            <p className="lodge-public__empty">
              {guestFilter > largestRoom
                ? `No single room sleeps ${guestFilter}. Message us — we can usually put adjoining rooms together.`
                : 'No rooms match what you’ve chosen. Try widening the filters or changing your dates.'}
            </p>
          ) : (
            <div className="lodge-public__room-grid gl-grid gl-grid--rooms">
              {visibleTypes.map((type) => (
                <RoomTypeCard
                  key={type.id}
                  lodge={lodge}
                  type={type}
                  onOpenPhotos={openLightbox}
                  onEnquireRoom={openRoomEnquire}
                />
              ))}
            </div>
          )}
          </div>
        </section>
      )}

      {lodge.hasEvents && venues.length > 0 && (
        <section className="lodge-public__events site-section site-section--tinted" id="events">
          <div className="site-container">
          <div className="lodge-public__section-head lodge-public__section-head--row">
            <div>
            <h2>Venues &amp; functions</h2>
            <p>Halls and lawns for weddings, receptions, birthdays and corporate events. Message us for a quote.</p>
            </div>
            <button type="button" className="gl-head-btn" onClick={() => openEventEnquire(undefined)}>
              Plan an event
            </button>
          </div>
          <div className="lodge-public__room-grid gl-grid gl-grid--venues">
            {venues.map((venue) => (
              <VenueCard key={venue.id} lodge={lodge} venue={venue} onOpenPhotos={openLightbox} onEnquireEvent={openEventEnquire} />
            ))}
          </div>
          <AddonStrip addons={addons} />
          </div>
        </section>
      )}

      {lodge.servesFood && menu.length > 0 && (
        <section className="lodge-public__food site-section" id="menu">
          <div className="site-container">
          <div className="lodge-public__section-head">
            <h2>Our menu</h2>
            <p>
              {lodge.foodRoomService
                ? 'Freshly prepared and served to your room — order with the PIN from reception.'
                : 'Freshly prepared in our kitchen. Ask at the restaurant to order.'}
            </p>
          </div>
          <MenuCard menu={menu} onOpenPhotos={openLightbox} />
          </div>
        </section>
      )}

      {lodge.hasOtherServices && otherServices.length > 0 && (
        <section className="lodge-public__services site-section site-section--tinted" id="services">
          <div className="site-container">
          <div className="lodge-public__section-head">
            <h2>Other services</h2>
            <p>Extras billed per use — message us to check availability.</p>
          </div>
          <div className="lodge-public__room-grid">
            {otherServices.map((service) => (
              <ServiceCard key={service.id} service={service} onOpenPhotos={openLightbox} onEnquire={openServiceEnquire} />
            ))}
          </div>
          </div>
        </section>
      )}

      {reviews.length > 0 && (
        <section className="lodge-public__reviews site-section" id="reviews">
          <div className="site-container">
            <div className="lodge-public__section-head">
              <h2>What our guests say</h2>
            </div>
            <div className="lodge-public__review-grid">
              {reviews.map((r) => (
                <article className="lodge-public__review-card" key={r.id}>
                  <div className="lodge-public__review-stars" aria-label={`${r.rating} out of 5 stars`}>
                    {'★'.repeat(r.rating)}
                    <span className="lodge-public__review-stars-off">{'★'.repeat(5 - r.rating)}</span>
                  </div>
                  <p className="lodge-public__review-comment">&ldquo;{r.comment}&rdquo;</p>
                  <p className="lodge-public__review-name">{r.guestName}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="site-contact site-section site-section--tinted" id="contact">
        <div className={`site-container site-contact__grid${directionsLink ? ' site-contact__grid--map' : ''}`}>
          <div className="site-contact__copy">
            <h2>Contact &amp; location</h2>
            {fullAddress && <p className="site-contact__address">{fullAddress}</p>}
            <dl className="site-contact__list">
              {lodge.phone && (
                <div>
                  <dt>Phone</dt>
                  <dd>
                    <a href={`tel:${lodge.phone}`}>{lodge.phone}</a>
                  </dd>
                </div>
              )}
              {generalWhatsappLink && (
                <div>
                  <dt>WhatsApp</dt>
                  <dd>
                    <a href={generalWhatsappLink} target="_blank" rel="noopener noreferrer">
                      Message us
                    </a>
                  </dd>
                </div>
              )}
              {checkinType && (
                <div>
                  <dt>Check-in</dt>
                  <dd>
                    {checkinType}
                    {lodge.checkinMode === 'CYCLE' && (
                      <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, fontWeight: 500, color: 'var(--text-muted)' }}>
                        Fixed check-in / checkout cycle
                      </span>
                    )}
                  </dd>
                </div>
              )}
            </dl>
            <div className="site-contact__actions">
              {directionsLink && (
                <a className="site-btn site-btn--primary" href={directionsLink} target="_blank" rel="noopener noreferrer">
                  Get directions
                </a>
              )}
              {generalWhatsappLink && (
                <a className="site-btn site-btn--whatsapp" href={generalWhatsappLink} target="_blank" rel="noopener noreferrer">
                  Chat on WhatsApp
                </a>
              )}
            </div>
          </div>
          {directionsLink && (
            <a className="site-contact__map" href={directionsLink} target="_blank" rel="noopener noreferrer">
              <span className="site-contact__map-pin" aria-hidden="true">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" />
                  <circle cx="12" cy="10" r="2.6" />
                </svg>
              </span>
              <span className="site-contact__map-title">Open in Google Maps</span>
              <span className="site-contact__map-sub">
                {hasPin ? `${lodge.latitude.toFixed(5)}, ${lodge.longitude.toFixed(5)}` : fullAddress}
              </span>
              <span className="site-contact__map-cta">Get directions →</span>
            </a>
          )}
        </div>
      </section>

      <footer className="site-footer">
        <div className="site-container site-footer__inner">
          <div className="site-footer__brand">
            <div className="site-footer__name">{lodge.name}</div>
            {fullAddress && <p>{fullAddress}</p>}
          </div>
          <nav className="site-footer__links" aria-label="Footer">
            {navLinks.map((sec) => (
              <a href={`#${sec.id}`} key={sec.id}>
                {sec.label}
              </a>
            ))}
          </nav>
        </div>
        <div className="site-container site-footer__bottom">
          <span>© {new Date().getFullYear()} {lodge.name}. All rights reserved.</span>
          <span>Rates are indicative and confirmed on enquiry.</span>
        </div>
      </footer>

      {enquireModal && (
        <EnquireModal
          lodge={lodge}
          roomTypes={roomTypes}
          roomAddons={roomAddons}
          venues={venues}
          eventAddons={addons}
          menuAvailable={menuAvailable}
          initial={enquireModal}
          onClose={closeEnquireModal}
          onViewMenu={jumpToMenu}
        />
      )}

      {lightbox && (
        <div className="lodge-public__lightbox" onClick={closeLightbox}>
          <button
            type="button"
            className="lodge-public__lightbox-close"
            onClick={closeLightbox}
            aria-label="Close"
          >
            ×
          </button>

          {lightbox.images.length > 1 && (
            <button
              type="button"
              className="lodge-public__lightbox-nav lodge-public__lightbox-nav--prev"
              onClick={(e) => {
                e.stopPropagation();
                showPrevImage();
              }}
              aria-label="Previous photo"
            >
              ‹
            </button>
          )}

          <img
            src={lightbox.images[lightbox.index]}
            alt={`Photo ${lightbox.index + 1} of ${lightbox.images.length}`}
            className="lodge-public__lightbox-image"
            onClick={(e) => e.stopPropagation()}
          />

          {lightbox.images.length > 1 && (
            <button
              type="button"
              className="lodge-public__lightbox-nav lodge-public__lightbox-nav--next"
              onClick={(e) => {
                e.stopPropagation();
                showNextImage();
              }}
              aria-label="Next photo"
            >
              ›
            </button>
          )}

          {lightbox.images.length > 1 && (
            <span className="lodge-public__lightbox-counter">
              {lightbox.index + 1} / {lightbox.images.length}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
