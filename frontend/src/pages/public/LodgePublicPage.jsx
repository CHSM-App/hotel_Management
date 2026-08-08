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

function RoomCard({ lodge, room, checkInDate, checkOutDate, onOpenPhotos }) {
  const isUnavailable = room.available === false;
  const dateRangeText =
    checkInDate && checkOutDate ? ` for ${formatDateLong(checkInDate)} – ${formatDateLong(checkOutDate)}` : '';
  const enquiryMessage = isUnavailable
    ? `Hi! Room ${room.roomNumber} (${room.categoryName}) at ${lodge.name} shows as booked${dateRangeText}. Do you have anything else available?`
    : `Hi! I'm interested in Room ${room.roomNumber} (${room.categoryName}) at ${lodge.name}${dateRangeText} — ${formatPrice(room.price)}/night. Could you share availability?`;
  const whatsappLink = buildWhatsAppLink(lodge.whatsappNumber, enquiryMessage);

  const chips = [
    room.floor && `Floor ${room.floor}`,
    room.bedSize && `${bedSizeLabel[room.bedSize]} bed`,
    room.bathroomType && bathroomTypeLabel[room.bathroomType],
    room.maxOccupancy && `Max ${room.maxOccupancy} guest${room.maxOccupancy === 1 ? '' : 's'}`,
  ].filter(Boolean);

  return (
    <div className={`lodge-public__room${isUnavailable ? ' lodge-public__room--unavailable' : ''}`}>
      <div className="lodge-public__room-cover">
        {room.available !== null && (
          <span
            className={`lodge-public__availability-badge ${
              isUnavailable ? 'lodge-public__availability-badge--no' : 'lodge-public__availability-badge--yes'
            }`}
          >
            {isUnavailable ? 'Not available' : 'Available'}
          </span>
        )}
        {room.images.length > 0 ? (
          <button
            type="button"
            className="lodge-public__room-cover-btn"
            onClick={() => onOpenPhotos(room.images, 0)}
            aria-label={`View photos of room ${room.roomNumber}`}
          >
            <img
              src={`${API_BASE}/room-images/${room.images[0]}`}
              alt={`Room ${room.roomNumber}`}
              className="lodge-public__room-img"
            />
          </button>
        ) : (
          <div className="lodge-public__room-placeholder">{room.roomNumber}</div>
        )}
        {room.images.length > 1 && (
          <span className="lodge-public__photo-count">+{room.images.length - 1}</span>
        )}
      </div>

      <div className="lodge-public__room-body">
        <div className="lodge-public__room-top">
          <div>
            <div className="lodge-public__room-number">Room {room.roomNumber}</div>
            <div className="lodge-public__room-category">{room.categoryName}</div>
          </div>
          <div className="lodge-public__room-rate">
            {formatPrice(room.price)}
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

        {room.description && <p className="lodge-public__room-description">{room.description}</p>}

        {whatsappLink ? (
          <a
            className="lodge-public__whatsapp-btn"
            href={whatsappLink}
            target="_blank"
            rel="noopener noreferrer"
          >
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

  const { lodge, rooms } = data;
  const generalMessage = `Hi! I'd like to know more about ${lodge.name}.`;
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

      <div className="lodge-public__dates">
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
        {availabilityLoading && <span className="lodge-public__dates-status">Checking availability…</span>}
        {!validDateRange && (
          <span className="lodge-public__dates-status lodge-public__dates-status--error">
            Check-out must be after check-in.
          </span>
        )}
      </div>

      {rooms.length === 0 ? (
        <p className="lodge-public__empty">No rooms are listed yet — please check back soon.</p>
      ) : (
        <div className="lodge-public__room-grid">
          {rooms.map((room) => (
            <RoomCard
              key={room.id}
              lodge={lodge}
              room={room}
              checkInDate={validDateRange ? checkInDate : null}
              checkOutDate={validDateRange ? checkOutDate : null}
              onOpenPhotos={openLightbox}
            />
          ))}
        </div>
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
