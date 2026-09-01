import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiGet, ApiError, API_BASE } from '../../lib/api';
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
};

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

// "Seats 300", "Up to 300 guests" — the capacity is advisory on the desk side
// too, so the public page says it the soft way.
function capacityLabel(venue) {
  return venue.capacityPax ? `Up to ${venue.capacityPax} guests` : null;
}

function VenueCard({ lodge, venue, onOpenPhotos }) {
  const enquiryMessage = `Hi! I'd like to enquire about booking ${venue.name} at ${lodge.name} for a function. Could you share availability and what's included?`;
  const whatsappLink = buildWhatsAppLink(lodge.whatsappNumber, enquiryMessage);
  const capacity = capacityLabel(venue);

  return (
    <div className="lodge-public__room lodge-public__venue">
      <div className="lodge-public__room-cover">
        {venue.images.length > 0 ? (
          <button
            type="button"
            className="lodge-public__room-cover-btn"
            onClick={() => onOpenPhotos(venue.images.map(venueImageUrl), 0)}
            aria-label={`View photos of ${venue.name}`}
          >
            <img src={venueImageUrl(venue.images[0])} alt={`${venue.name} at ${lodge.name}`} className="lodge-public__room-img" />
          </button>
        ) : (
          <div className="lodge-public__room-placeholder">{venue.name}</div>
        )}
        {venue.images.length > 1 && <span className="lodge-public__photo-count">+{venue.images.length - 1}</span>}
      </div>

      <div className="lodge-public__room-body">
        <div className="lodge-public__room-top">
          <div>
            <div className="lodge-public__room-number">{venue.name}</div>
            <div className="lodge-public__room-category">Function venue</div>
          </div>
          <div className="lodge-public__room-rate">
            {venue.baseCharge > 0 ? formatPrice(venue.baseCharge) : 'On request'}
            {venue.baseCharge > 0 && <span className="lodge-public__room-rate-unit"> /function</span>}
          </div>
        </div>

        {capacity && (
          <div className="lodge-public__room-chips">
            <span className="lodge-public__chip">{capacity}</span>
          </div>
        )}

        {whatsappLink ? (
          <a className="lodge-public__whatsapp-btn" href={whatsappLink} target="_blank" rel="noopener noreferrer">
            Enquire for a function
          </a>
        ) : (
          <p className="lodge-public__no-whatsapp">Call {lodge.phone || 'the property'} to enquire.</p>
        )}
      </div>
    </div>
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

// One category as a horizontal shelf of dish tiles, the way a delivery app
// lays a menu out: the heading names the category, the row scrolls sideways
// under it, and every category is on screen at once rather than folded away.
// Arrows appear on a pointer device once the row overflows; on a phone the
// thumb does the work and the arrows stay hidden.
function MenuShelf({ section, onOpenPhotos }) {
  const rowRef = useRef(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const updateArrows = () => {
    const el = rowRef.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 4);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    // Run once the row has laid out, and again whenever it resizes - a
    // rotated phone or a resized window changes what overflows.
    const raf = requestAnimationFrame(updateArrows);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateArrows) : null;
    if (observer) observer.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      if (observer) observer.disconnect();
    };
  }, [section.items.length]);

  const scrollRow = (direction) => {
    const el = rowRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(el.clientWidth * 0.8, 200), behavior: 'smooth' });
  };

  return (
    <section className="lodge-public__shelf" aria-label={section.name}>
      <div className="lodge-public__shelf-head">
        <h3 className="lodge-public__shelf-title">
          {section.name}
          <span className="lodge-public__menu-section-count">{section.items.length}</span>
        </h3>
        {(canPrev || canNext) && (
          <div className="lodge-public__shelf-arrows">
            <button
              type="button"
              className="lodge-public__shelf-arrow"
              onClick={() => scrollRow(-1)}
              disabled={!canPrev}
              aria-label={`Scroll ${section.name} back`}
            >
              &lsaquo;
            </button>
            <button
              type="button"
              className="lodge-public__shelf-arrow"
              onClick={() => scrollRow(1)}
              disabled={!canNext}
              aria-label={`Scroll ${section.name} forward`}
            >
              &rsaquo;
            </button>
          </div>
        )}
      </div>

      <ul className="lodge-public__shelf-row" ref={rowRef} onScroll={updateArrows}>
        {section.items.map((item) => (
          <li className={`lodge-public__dish${item.image ? '' : ' lodge-public__dish--no-photo'}`} key={item.id}>
            {item.image && (
              <button
                type="button"
                className="lodge-public__dish-photo"
                onClick={() => onOpenPhotos([menuImageUrl(item.image)], 0)}
                aria-label={`View photo of ${item.name}`}
              >
                <img src={menuImageUrl(item.image)} alt="" loading="lazy" />
              </button>
            )}
            <div className="lodge-public__dish-body">
              <div className="lodge-public__dish-head">
                <FoodMark type={item.foodType} />
                <span className="lodge-public__dish-name">{item.name}</span>
              </div>
              {item.description && <p className="lodge-public__dish-desc">{item.description}</p>}
              <div className="lodge-public__dish-price">{menuItemPrice(item)}</div>
            </div>
          </li>
        ))}
      </ul>
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
      </div>

      {menu.map((section) => (
        <MenuShelf key={section.id} section={section} onOpenPhotos={onOpenPhotos} />
      ))}
    </div>
  );
}

function RoomTypeCard({ lodge, type, checkInDate, checkOutDate, onOpenPhotos }) {
  const availability = availabilityOf(type);
  const isUnavailable = type.availableCount === 0;
  const dateRangeText =
    checkInDate && checkOutDate ? ` for ${formatDateLong(checkInDate)} – ${formatDateLong(checkOutDate)}` : '';
  const enquiryMessage = isUnavailable
    ? `Hi! The ${type.name} rooms at ${lodge.name} show as fully booked${dateRangeText}. Do you have anything else available?`
    : `Hi! I'd like to book a ${type.name} room at ${lodge.name}${dateRangeText} — ${formatPrice(type.price)}/night. Could you confirm availability?`;
  const whatsappLink = buildWhatsAppLink(lodge.whatsappNumber, enquiryMessage);

  const beds = type.bedSizes.map((b) => bedSizeLabel[b]).filter(Boolean);
  const baths = type.bathroomTypes.map((b) => bathroomTypeLabel[b]).filter(Boolean);
  const sleeps =
    type.maxOccupancy &&
    (type.minOccupancy === type.maxOccupancy
      ? `Sleeps ${type.maxOccupancy}`
      : `Sleeps ${type.minOccupancy}–${type.maxOccupancy}`);

  const chips = [beds.length > 0 && `${joinWords(beds)} bed`, baths.length > 0 && joinWords(baths), sleeps].filter(
    Boolean
  );

  return (
    <div className={`lodge-public__room${isUnavailable ? ' lodge-public__room--unavailable' : ''}`}>
      <div className="lodge-public__room-cover">
        {availability && (
          <span className={`lodge-public__availability-badge lodge-public__availability-badge--${availability.tone}`}>
            {availability.label}
          </span>
        )}
        {type.images.length > 0 ? (
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
            />
          </button>
        ) : (
          <div className="lodge-public__room-placeholder">{type.name}</div>
        )}
        {type.images.length > 1 && <span className="lodge-public__photo-count">+{type.images.length - 1}</span>}
      </div>

      <div className="lodge-public__room-body">
        <div className="lodge-public__room-top">
          <div>
            <div className="lodge-public__room-number">{type.name}</div>
            <div className="lodge-public__room-category">
              {type.roomCount} room{type.roomCount === 1 ? '' : 's'} of this type
            </div>
          </div>
          <div className="lodge-public__room-rate">
            {formatPrice(type.price)}
            <span className="lodge-public__room-rate-unit"> /night</span>
          </div>
        </div>

        {chips.length > 0 && (
          <div className="lodge-public__room-chips">
            {chips.map((chip) => (
              <span className="lodge-public__chip" key={chip}>
                {chip}
              </span>
            ))}
          </div>
        )}

        {type.description && <p className="lodge-public__room-description">{type.description}</p>}

        {whatsappLink ? (
          <a className="lodge-public__whatsapp-btn" href={whatsappLink} target="_blank" rel="noopener noreferrer">
            {isUnavailable ? 'Ask about other dates' : 'Enquire on WhatsApp'}
          </a>
        ) : (
          <p className="lodge-public__no-whatsapp">Call {lodge.phone || 'the lodge'} to enquire.</p>
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
    const targets = ['home', 'rooms', 'events', 'menu', 'contact'].map((id) => document.getElementById(id)).filter(Boolean);
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

  const { lodge, roomTypes, venues = [], addons = [], menu = [] } = data;
  const generalMessage = `Hi! I'd like to know more about ${lodge.name}.`;

  // Which parts of the page this property has. The nav strip only appears
  // once there are two or more — one section needs no table of contents.
  const sections = [
    lodge.hasRooms && { id: 'rooms', label: 'Rooms' },
    lodge.hasEvents && venues.length > 0 && { id: 'events', label: 'Venues & functions' },
    lodge.servesFood && menu.length > 0 && { id: 'menu', label: 'Menu' },
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

  // The photos across the top: rooms first, then venues, the first three shown
  // and the rest reachable through the lightbox. A property with no photos
  // gets a single-column hero rather than an empty frame.
  const heroImages = [
    ...roomTypes.flatMap((t) => t.images.map(roomImageUrl)),
    ...venues.flatMap((v) => v.images.map(venueImageUrl)),
  ].slice(0, 12);
  const showHeroPhoto = heroImages.length > 0 && !heroBroken;

  const cheapestRate = roomTypes.reduce((min, t) => (min == null || t.price < min ? t.price : min), null);
  const totalRooms = roomTypes.reduce((n, t) => n + (t.roomCount || 0), 0);
  const allVegMenu =
    menu.length > 0 && menu.every((section) => section.items.every((item) => item.foodType !== 'NON_VEG'));
  const checkinType = lodge.hasRooms ? CHECKIN_MODE_LABEL[lodge.checkinMode] : null;

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
    {
      id: 'contact',
      title: 'Find us',
      detail: [lodge.city, lodge.state].filter(Boolean).join(', ') || 'Contact & directions',
      cta: 'Contact',
    },
  ].filter(Boolean);

  const facts = [
    cheapestRate != null && { value: formatPrice(cheapestRate), label: 'per night, from' },
    totalRooms > 0 && { value: String(totalRooms), label: totalRooms === 1 ? 'room' : 'rooms' },
    lodge.hasEvents && venues.length > 0 && { value: String(venues.length), label: venues.length === 1 ? 'venue' : 'venues' },
    lodge.servesFood && menu.length > 0 && { value: allVegMenu ? 'Pure veg' : 'Veg & non-veg', label: 'restaurant' },
    checkinType && { value: checkinType, label: 'check-in' },
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
  const generalWhatsappLink = buildWhatsAppLink(lodge.whatsappNumber, generalMessage);

  return (
    <div className="lodge-public site" id="top">
      <nav className="site-nav" aria-label="Site">
        <div className="site-container site-nav__inner">
          <a className="site-nav__brand" href="#top">
            {lodge.name}
          </a>
          <div className="site-nav__links">
            {navLinks.map((sec) => (
              <a
                className={`site-nav__link${activeSection === sec.id ? ' site-nav__link--active' : ''}`}
                href={`#${sec.id}`}
                key={sec.id}
                aria-current={activeSection === sec.id ? 'true' : undefined}
              >
                {sec.label}
              </a>
            ))}
          </div>
          {generalWhatsappLink ? (
            <a className="site-btn site-btn--accent site-nav__cta" href={generalWhatsappLink} target="_blank" rel="noopener noreferrer">
              Enquire
            </a>
          ) : lodge.phone ? (
            <a className="site-btn site-btn--accent site-nav__cta" href={`tel:${lodge.phone}`}>
              Call us
            </a>
          ) : null}
        </div>
      </nav>

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
                <li key={fact.label}>
                  <strong>{fact.value}</strong>
                  <span>{fact.label}</span>
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
          <div className="lodge-public__section-head">
            <span className="lodge-public__eyebrow">Stay</span>
            <h2>Our rooms</h2>
            <p>
              {validDateRange
                ? `Rates and availability for ${formatDateLong(checkInDate)} – ${formatDateLong(checkOutDate)}.`
                : 'Choose your dates above to see what’s free.'}
            </p>
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
            <div className="lodge-public__room-grid">
              {visibleTypes.map((type) => (
                <RoomTypeCard
                  key={type.id}
                  lodge={lodge}
                  type={type}
                  checkInDate={validDateRange ? checkInDate : null}
                  checkOutDate={validDateRange ? checkOutDate : null}
                  onOpenPhotos={openLightbox}
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
          <div className="lodge-public__section-head">
            <span className="lodge-public__eyebrow">Celebrate</span>
            <h2>Venues & functions</h2>
            <p>Halls and lawns for weddings, receptions, birthdays and corporate events. Message us for a quote.</p>
          </div>
          <div className="lodge-public__room-grid">
            {venues.map((venue) => (
              <VenueCard key={venue.id} lodge={lodge} venue={venue} onOpenPhotos={openLightbox} />
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
            <span className="lodge-public__eyebrow">Dine</span>
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

      <section className="site-contact site-section site-section--tinted" id="contact">
        <div className={`site-container site-contact__grid${directionsLink ? ' site-contact__grid--map' : ''}`}>
          <div className="site-contact__copy">
            <span className="lodge-public__eyebrow">Find us</span>
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
                  <dd>{checkinType}</dd>
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
