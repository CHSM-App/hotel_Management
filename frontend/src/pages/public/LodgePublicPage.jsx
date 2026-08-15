import { useEffect, useState } from 'react';
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
            onClick={() => onOpenPhotos(type.images, 0)}
            aria-label={`View photos of the ${type.name} room`}
          >
            <img
              src={`${API_BASE}/room-images/${type.images[0]}`}
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
      <div className="lodge-public lodge-public--state">
        <p>{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="lodge-public lodge-public--state">
        <p>Loading…</p>
      </div>
    );
  }

  const { lodge, roomTypes } = data;
  const generalMessage = `Hi! I'd like to know more about ${lodge.name}.`;

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
    <div className="lodge-public">
      <header className="lodge-public__header">
        <h1>{lodge.name}</h1>
        {(lodge.address || lodge.city || lodge.state) && (
          <p className="lodge-public__address">
            {[lodge.address, lodge.city, lodge.state].filter(Boolean).join(', ')}
          </p>
        )}
        <div className="lodge-public__contact">
          {lodge.phone && (
            <a className="lodge-public__contact-link" href={`tel:${lodge.phone}`}>
              Call {lodge.phone}
            </a>
          )}
          {generalWhatsappLink && (
            <a
              className="lodge-public__contact-link lodge-public__contact-link--whatsapp"
              href={generalWhatsappLink}
              target="_blank"
              rel="noopener noreferrer"
            >
              Chat on WhatsApp
            </a>
          )}
        </div>
      </header>

      {roomTypes.length === 0 ? (
        <p className="lodge-public__empty">No rooms are listed yet — please check back soon.</p>
      ) : (
        <section className="lodge-public__rooms">
          {/* A titled section rather than a bare grid of cards: it is the
              difference between a page that lists things and a page that is
              showing you its rooms. */}
          <div className="lodge-public__section-head">
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

            {roomTypes.length > 1 && (
              <div className="lodge-public__search-chips">
                <div className="lodge-public__filter-chips">
                  <button
                    type="button"
                    className="lodge-public__filter-chip"
                    aria-pressed={typeFilter === 'ALL'}
                    onClick={() => setTypeFilter('ALL')}
                  >
                    All rooms
                  </button>
                  {roomTypes.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="lodge-public__filter-chip"
                      aria-pressed={typeFilter === String(t.id)}
                      onClick={() => setTypeFilter(String(t.id))}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
                {filtersApplied && (
                  <button type="button" className="lodge-public__filter-clear" onClick={clearFilters}>
                    Clear filters
                  </button>
                )}
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
        </section>
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
            src={`${API_BASE}/room-images/${lightbox.images[lightbox.index]}`}
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
