import './staySummary.css';
import { roomSections } from './multiRoom';
import { formatPrice } from './priceFormat';
import { describeAdvance } from './paymentSplit';
import IconButton from '../../components/IconButton';
import { EyeIcon } from '../../components/ActionIcons';
import {
  BedIcon,
  CalendarIcon,
  ClockIcon,
  StarIcon,
  UsersIcon,
  UserIcon,
  PhoneIcon,
  WalletIcon,
  CarIcon,
  InfoIcon,
  ReceiptIcon,
} from '../../components/StaySummaryIcons';
import {
  VEHICLE_TYPE_LABEL,
  describeParty,
  formatDateLong,
  formatDateTime,
  formatLateBy,
  idProofLabel,
} from './stayFormat';

const formatNightDate = (key) =>
  new Date(`${String(key).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

const addOneNight = (key) => {
  const d = new Date(`${String(key).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

function Fact({ icon, label, value }) {
  return (
    <div className="stay-summary__fact">
      <span className="stay-summary__fact-icon">{icon}</span>
      <span className="stay-summary__fact-label">{label}</span>
      <span className="stay-summary__fact-value">{value}</span>
    </div>
  );
}

// A richer, read-only stay record for the billing queue's "View" button —
// built for this one modal rather than folded into StayDetails, which three
// other screens (Bookings' detail modal, the tape chart popup, the bill
// modal's own collapsible) still use at its original, denser layout. Two
// different jobs: those read a stay mid-task; this is the whole answer to
// "what is this stay", read on its own.
export default function StaySummary({ booking, idProofError = '', onViewIdProof, onViewGuestIdProof }) {
  const roomLabel =
    booking.rooms?.length > 1
      ? `${booking.rooms.length} rooms · ${booking.roomNumbers}`
      : `${booking.roomNumber} · ${booking.categoryName}`;
  const nights = booking.nights?.length || 0;
  const lateBy = formatLateBy(booking.lateCheckoutMinutes);
  const rooms = roomSections(booking.roomCharges);
  const datesDiffer = rooms && new Set(rooms.map((r) => `${r.base.firstDate}|${r.base.lastDate}`)).size > 1;
  const totalAgreed = booking.totalPrice + (booking.lateCheckoutCharge || 0);

  const row = (line) => (
    <div className="stay-summary__pb-line" key={`${line.label}-${line.amount}`}>
      <span>
        {line.label}
        {line.nights > 1 && line.amount > 0 && <span className="stay-summary__pb-nights"> × {line.nights} nights</span>}
      </span>
      <span>{formatPrice(line.amount)}</span>
    </div>
  );

  return (
    <div className="stay-summary">
      {/* The answer to "whose stay, which room, when" in one glance — the
          five numbered sections below are what that answer is built from,
          not a second attempt at saying it. */}
      <div className="stay-summary__hero">
        <div className="stay-summary__hero-col">
          <div className="stay-summary__hero-name">{booking.guestName}</div>
          <div className="stay-summary__hero-room">{roomLabel}</div>
          <div className="stay-summary__hero-dates">
            <CalendarIcon />
            <span>
              {formatDateLong(booking.checkInDate)} – {formatDateLong(booking.checkOutDate)}
              {nights > 0 && <small>{nights} {nights === 1 ? 'night' : 'nights'}</small>}
            </span>
          </div>
        </div>
        <div className="stay-summary__hero-col">
          <div className="stay-summary__hero-time">
            <ClockIcon />
            <span>
              <small>Came in</small>
              {booking.actualCheckInAt ? formatDateTime(booking.actualCheckInAt) : 'Not arrived yet'}
            </span>
          </div>
          <div className="stay-summary__hero-time">
            <ClockIcon />
            <span>
              <small>Left</small>
              {booking.actualCheckOutAt
                ? formatDateTime(booking.actualCheckOutAt)
                : booking.actualCheckInAt
                  ? 'Still staying'
                  : 'Not arrived yet'}
            </span>
          </div>
          {lateBy && (
            <div className="stay-summary__late-pill">
              <ClockIcon />
              Left late by {lateBy} · {booking.lateCheckoutCharge > 0 ? `${formatPrice(booking.lateCheckoutCharge)} agreed` : 'no charge taken'}
            </div>
          )}
        </div>
      </div>

      <div className="stay-summary__grid">
        <div className="stay-summary__col">
          <section className="stay-summary__section">
            <h4>
              <span className="stay-summary__section-icon"><BedIcon /></span>
              1. Stay &amp; Room
            </h4>
            <Fact
              icon={<BedIcon />}
              label="Room"
              value={
                booking.rooms?.length > 1 ? (
                  roomLabel
                ) : (
                  <span className="stay-summary__chips">
                    <span className="stay-summary__chip">{booking.roomNumber}</span>
                    <span className="stay-summary__chip">{booking.categoryName}</span>
                  </span>
                )
              }
            />
            <Fact
              icon={<CalendarIcon />}
              label="Dates"
              value={
                <>
                  {formatDateLong(booking.checkInDate)} – {formatDateLong(booking.checkOutDate)}
                  {nights > 0 && <span className="stay-summary__fact-muted"> · {nights} {nights === 1 ? 'night' : 'nights'}</span>}
                </>
              }
            />
            <Fact
              icon={<ClockIcon />}
              label="Came in"
              value={booking.actualCheckInAt ? formatDateTime(booking.actualCheckInAt) : 'Not arrived yet'}
            />
            <Fact
              icon={<ClockIcon />}
              label="Left"
              value={
                booking.actualCheckOutAt
                  ? formatDateTime(booking.actualCheckOutAt)
                  : booking.actualCheckInAt
                    ? 'Still staying'
                    : 'Not arrived yet'
              }
            />
            {lateBy && (
              <Fact
                icon={<ClockIcon />}
                label="Left late by"
                value={
                  <>
                    {lateBy}
                    <span className="stay-summary__fact-muted">
                      {' · '}
                      {booking.lateCheckoutCharge > 0 ? `${formatPrice(booking.lateCheckoutCharge)} agreed` : 'no charge taken'}
                    </span>
                  </>
                }
              />
            )}
            {booking.switchableCharges?.length > 0 && (
              <Fact
                icon={<StarIcon />}
                label="Extras"
                value={
                  <span className="stay-summary__chips">
                    {booking.switchableCharges.map((c) => (
                      <span className="stay-summary__chip" key={c.name}>
                        {c.quantity > 1 ? `${c.name} ×${c.quantity}` : c.name}
                      </span>
                    ))}
                  </span>
                }
              />
            )}
          </section>

          <section className="stay-summary__section">
            <h4>
              <span className="stay-summary__section-icon"><UsersIcon /></span>
              2. Guest Details
            </h4>
            {/* One number, not two that happen to agree — describeParty's
                adult/child breakdown already says how many guests there are
                by what it adds up to, so a separate "N guests" in front of
                it was the same fact said twice. */}
            <Fact
              icon={<UsersIcon />}
              label="Total Guests"
              value={describeParty(booking.numGuests - booking.childCount, booking.childCount)}
            />
            <div className="stay-summary__people">
              {/* Primary first, then every other guest on the booking — a
                  party of five is five people to account for, not a count
                  with one name attached to it. */}
              <div className="stay-summary__person">
                <span className="stay-summary__person-icon"><UserIcon /></span>
                <div className="stay-summary__person-body">
                  <div className="stay-summary__person-head">
                    <strong>{booking.guestName}</strong>
                    <span className="stay-summary__person-tag">Primary</span>
                  </div>
                  <div className="stay-summary__person-meta">
                    <span><PhoneIcon /> {booking.guestPhone || 'No phone on file'}</span>
                    <span>
                      {booking.idProofType
                        ? `${idProofLabel(booking.idProofType)}${booking.idProofNumber ? ` · ${booking.idProofNumber}` : ''}`
                        : 'No ID proof on file'}
                      {booking.hasIdProofDocument && onViewIdProof && (
                        <IconButton label="View ID proof" icon={<EyeIcon />} onClick={onViewIdProof} />
                      )}
                    </span>
                  </div>
                </div>
              </div>
              {booking.guests?.map((g) => (
                <div className="stay-summary__person" key={g.id}>
                  <span className="stay-summary__person-icon"><UserIcon /></span>
                  <div className="stay-summary__person-body">
                    <div className="stay-summary__person-head">
                      <strong>{g.name}</strong>
                      {g.isChild && <span className="stay-summary__person-tag stay-summary__person-tag--muted">Child</span>}
                    </div>
                    <div className="stay-summary__person-meta">
                      <span>
                        {[g.phone, g.idProofType && `${idProofLabel(g.idProofType)}${g.idProofNumber ? ` · ${g.idProofNumber}` : ''}`]
                          .filter(Boolean)
                          .join(' · ') || 'No details on file'}
                      </span>
                      {g.hasIdProofDocument && onViewGuestIdProof && (
                        <IconButton label={`View ID proof for ${g.name}`} icon={<EyeIcon />} onClick={() => onViewGuestIdProof(g.id)} />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {idProofError && <div className="form-banner form-banner--error">{idProofError}</div>}
          </section>

          <section className="stay-summary__section">
            <h4>
              <span className="stay-summary__section-icon"><WalletIcon /></span>
              3. Advance Payment
            </h4>
            {/* Money actually in hand is the genuinely successful state —
                green. "No advance taken" is an absence, not a result, so it
                stays the same neutral grey every other empty fact on this
                card uses. */}
            {booking.advanceAmount != null ? (
              <div className="stay-summary__fact--received">
                <Fact
                  icon={<WalletIcon />}
                  label="Taken"
                  value={
                    <>
                      {formatPrice(booking.advanceAmount)}
                      <span className="stay-summary__fact-muted"> · {describeAdvance(booking.advancePaymentLines, booking.advancePaymentMethod)}</span>
                    </>
                  }
                />
              </div>
            ) : (
              <p className="stay-summary__empty">No advance taken.</p>
            )}
          </section>

          <section className="stay-summary__section">
            <h4>
              <span className="stay-summary__section-icon"><CarIcon /></span>
              4. Vehicles
            </h4>
            {booking.vehicles?.length > 0 ? (
              booking.vehicles.map((v) => (
                <Fact key={v.number} icon={<CarIcon />} label={v.number} value={v.type ? VEHICLE_TYPE_LABEL[v.type] : 'Type not recorded'} />
              ))
            ) : (
              <p className="stay-summary__empty">None on file.</p>
            )}
          </section>
        </div>

        <div className="stay-summary__col">
          <section className="stay-summary__section stay-summary__section--pb">
            <h4>
              <span className="stay-summary__section-icon"><ReceiptIcon /></span>
              5. Price Breakdown
            </h4>
            <div className="stay-summary__pb-group">Room</div>
            {!rooms
              ? booking.roomCharges?.map((line) => row(line))
              : rooms.map(({ room, base, extras }) => (
                  <div className="stay-summary__pb-room" key={room}>
                    <div className="stay-summary__pb-room-head">
                      <strong>Room {room} · {base.nights} {base.nights === 1 ? 'night' : 'nights'}</strong>
                      {datesDiffer && base.firstDate && (
                        <span>{formatNightDate(base.firstDate)} → {formatNightDate(addOneNight(base.lastDate))}</span>
                      )}
                    </div>
                    {[base, ...extras].map((line) => row(line))}
                  </div>
                ))}
            <div className="stay-summary__pb-sub">
              <span>Room charge for {nights === 1 ? 'the night' : 'all nights'}</span>
              <span>{formatPrice(booking.totalPrice)}</span>
            </div>
            {booking.lateCheckoutCharge > 0 && (
              <div className="stay-summary__late-charge">
                <ClockIcon />
                <span>Agreed for leaving late</span>
                <strong>{formatPrice(booking.lateCheckoutCharge)}</strong>
              </div>
            )}
            <div className="stay-summary__total">
              <InfoIcon />
              <div>
                <span>Total amount agreed for this stay{booking.lateCheckoutCharge > 0 ? ' (including late check-out)' : ''}</span>
                <strong>{formatPrice(totalAgreed)}</strong>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
