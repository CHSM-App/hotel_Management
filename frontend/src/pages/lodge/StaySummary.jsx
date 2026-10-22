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
  outstandingBeforeTax,
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

// One guest with every detail that was entered for them, each on its own
// labelled line — a missing value says so rather than being left out.
function PersonCard({ name, tag, muted, phone, idType, idNumber, hasDocument, onViewDocument, viewLabel }) {
  const missing = <span className="stay-summary__fact-muted">—</span>;
  return (
    <div className="stay-summary__person">
      <span className="stay-summary__person-icon"><UserIcon /></span>
      <div className="stay-summary__person-body">
        <div className="stay-summary__person-head">
          <strong>{name}</strong>
          <span className={`stay-summary__person-tag${muted ? ' stay-summary__person-tag--muted' : ''}`}>{tag}</span>
        </div>
        <dl className="stay-summary__person-details">
          <div>
            <dt>Phone</dt>
            <dd>{phone || missing}</dd>
          </div>
          <div>
            <dt>ID type</dt>
            <dd>{idType ? idProofLabel(idType) : missing}</dd>
          </div>
          <div>
            <dt>ID number</dt>
            <dd>{idNumber || missing}</dd>
          </div>
          <div>
            <dt>ID document</dt>
            <dd>
              {hasDocument ? (
                <>
                  Uploaded
                  {onViewDocument && <IconButton label={viewLabel} icon={<EyeIcon />} onClick={onViewDocument} />}
                </>
              ) : (
                missing
              )}
            </dd>
          </div>
        </dl>
      </div>
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
  // One PIN per room that has one — a multi-room stay can carry several.
  const pins =
    booking.rooms?.length > 1
      ? booking.rooms.filter((r) => r.status === 'CHECKED_IN' && r.foodPin).map((r) => ({ label: `Room ${r.roomNumber}`, pin: r.foodPin }))
      : booking.foodPin
        ? [{ label: `Room ${booking.roomNumber}`, pin: booking.foodPin }]
        : [];
  const rooms = roomSections(booking.roomCharges);
  const datesDiffer = rooms && new Set(rooms.map((r) => `${r.base.firstDate}|${r.base.lastDate}`)).size > 1;
  const totalAgreed = booking.totalPrice + (booking.lateCheckoutCharge || 0);
  // What this stay has run up that no bill carries yet, as the stay record
  // below it reads them: food on the room bill and completed services.
  const foodOpen = (booking.foodOrders || []).filter((o) => !o.billed && o.onRoomBill);
  const servicesOpen = (booking.serviceUsages || []).filter((u) => !u.billed && u.onRoomBill && u.status === 'COMPLETED');
  const round2 = (n) => Math.round(n * 100) / 100;
  // Everything the guest took from the property on this stay, whether or not
  // it has reached the room bill yet — the breakdown below only totals what is
  // on the bill, this lists it all.
  const allFood = booking.foodOrders || [];
  const allServices = booking.serviceUsages || [];
  const tagFor = (item) => (item.billed ? 'Billed' : item.onRoomBill ? 'On room bill' : 'Not on room bill yet');
  const foodOpenTotal = round2(foodOpen.reduce((n, o) => n + o.subtotal, 0));
  const servicesOpenTotal = round2(servicesOpen.reduce((n, u) => n + u.amount, 0));
  const paidInFull =
    booking.advanceAmount != null &&
    booking.totalPrice != null &&
    Math.round(booking.advanceAmount * 100) >= Math.round(booking.totalPrice * 100);
  // Once a bill exists it is the answer to what is owed, and a pre-tax figure
  // beside it would be a second one.
  const showDue = !booking.invoice && booking.status !== 'CANCELLED';

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
              <small>Checked in</small>
              {booking.actualCheckInAt ? formatDateTime(booking.actualCheckInAt) : 'Not arrived yet'}
            </span>
          </div>
          <div className="stay-summary__hero-time">
            <ClockIcon />
            <span>
              <small>Checked out</small>
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
              label="Checked in"
              value={booking.actualCheckInAt ? formatDateTime(booking.actualCheckInAt) : 'Not arrived yet'}
            />
            <Fact
              icon={<ClockIcon />}
              label="Checked out"
              value={
                booking.actualCheckOutAt
                  ? formatDateTime(booking.actualCheckOutAt)
                  : booking.actualCheckInAt
                    ? 'Still staying'
                    : 'Not arrived yet'
              }
            />
            {booking.status === 'CHECKED_IN' && pins.length > 0 && (
              <div className="stay-summary__pin-box">
                <div className="stay-summary__pin-head">
                  <InfoIcon />
                  <span>Food PIN</span>
                  {booking.foodOrderingLockedUntil && <span className="stay-summary__chip">Locked</span>}
                </div>
                <div className="stay-summary__pins">
                  {pins.map((p) => (
                    <span className="stay-summary__pin" key={p.label}>
                      {pins.length > 1 && <span className="stay-summary__pin-room">{p.label}</span>}
                      <span className="stay-summary__pin-value">{p.pin}</span>
                    </span>
                  ))}
                </div>
                <p className="stay-summary__pin-hint">Guest needs it to order food from the QR code.</p>
              </div>
            )}
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
              <PersonCard
                name={booking.guestName}
                tag="Primary"
                phone={booking.guestPhone}
                idType={booking.idProofType}
                idNumber={booking.idProofNumber}
                hasDocument={booking.hasIdProofDocument}
                onViewDocument={onViewIdProof}
                viewLabel="View ID proof"
              />
              {booking.guests?.map((g) => (
                <PersonCard
                  key={g.id}
                  name={g.name}
                  tag={g.isChild ? 'Child' : 'Adult'}
                  muted={g.isChild}
                  phone={g.phone}
                  idType={g.idProofType}
                  idNumber={g.idProofNumber}
                  hasDocument={g.hasIdProofDocument}
                  onViewDocument={onViewGuestIdProof ? () => onViewGuestIdProof(g.id) : undefined}
                  viewLabel={`View ID proof for ${g.name}`}
                />
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
            {foodOpen.length > 0 && (
              <>
                <div className="stay-summary__pb-group stay-summary__pb-group--gap">Food</div>
                {foodOpen.map((o) => (
                  <div className="stay-summary__pb-line" key={o.id}>
                    <span>
                      Order #{o.orderNumber}
                      <span className="stay-summary__pb-nights">
                        {o.origin === 'ROOM_SERVICE' ? 'room service' : `from ${o.placedFrom || 'restaurant'}`}
                        {o.status !== 'DELIVERED' ? ' · in progress' : ''}
                      </span>
                    </span>
                    <span>{formatPrice(o.subtotal)}</span>
                  </div>
                ))}
                <div className="stay-summary__pb-sub">
                  <span>Food ordered</span>
                  <span>{formatPrice(foodOpenTotal)}</span>
                </div>
              </>
            )}
            {servicesOpen.length > 0 && (
              <>
                <div className="stay-summary__pb-group stay-summary__pb-group--gap">Services</div>
                {servicesOpen.map((u) => (
                  <div className="stay-summary__pb-line" key={u.id}>
                    <span>
                      {u.name}
                      <span className="stay-summary__pb-nights">
                        {formatPrice(u.unitPrice ?? u.amount / (u.quantity * (u.headcount || 1)))} per {u.unitLabel} × {u.quantity}
                        {u.headcount > 1 ? ` × ${u.headcount} people` : ''}
                        {u.gstRatePercent > 0 ? ` · incl. ${u.gstRatePercent}% GST` : ''}
                      </span>
                    </span>
                    <span>{formatPrice(u.amount)}</span>
                  </div>
                ))}
                <div className="stay-summary__pb-sub">
                  <span>Services used · {servicesOpen.length} {servicesOpen.length === 1 ? 'item' : 'items'}</span>
                  <span>{formatPrice(servicesOpenTotal)}</span>
                </div>
              </>
            )}
            {(booking.advanceAmount != null || foodOpen.length > 0 || servicesOpen.length > 0) && (
              <div className="stay-summary__pb-group stay-summary__pb-group--gap">Payments</div>
            )}
            {booking.advanceAmount != null && (
              <div className="stay-summary__pb-line">
                <span>
                  {paidInFull ? 'Paid in full at booking' : 'Advance already paid'}
                  <span className="stay-summary__pb-nights">
                    {' · '}
                    {describeAdvance(booking.advancePaymentLines, booking.advancePaymentMethod)}
                    {booking.advanceReference ? ` · ${booking.advanceReference}` : ''}
                  </span>
                </span>
                <span>− {formatPrice(booking.advanceAmount)}</span>
              </div>
            )}
            {showDue ? (
              <div className="stay-summary__due">
                <div>
                  <span>Still to collect</span>
                  <small>
                    {'Room' +
                      (booking.lateCheckoutCharge > 0 ? ' + late checkout' : '') +
                      (foodOpen.length > 0 ? ' + food' : '') +
                      (servicesOpen.length > 0 ? ' + services' : '') +
                      ' − advance'}
                  </small>
                </div>
                <strong>{formatPrice(outstandingBeforeTax(booking) + foodOpenTotal + servicesOpenTotal)}</strong>
              </div>
            ) : (
              <div className="stay-summary__total">
                <InfoIcon />
                <div>
                  <span>Total amount agreed for this stay{booking.lateCheckoutCharge > 0 ? ' (including late check-out)' : ''}</span>
                  <strong>{formatPrice(totalAgreed)}</strong>
                </div>
              </div>
            )}
            {showDue && <p className="stay-summary__pb-note">Before GST — tax is worked out on the bill, night by night, when it is issued.</p>}
          </section>

          {(allFood.length > 0 || allServices.length > 0) && (
            <section className="stay-summary__section">
              <h4>
                <span className="stay-summary__section-icon"><StarIcon /></span>
                Food &amp; Services Taken
              </h4>
              {allFood.map((o) => (
                <div className="stay-summary__taken" key={`f${o.id}`}>
                  <div className="stay-summary__taken-head">
                    <strong>Order #{o.orderNumber}</strong>
                    <span className={`stay-summary__taken-tag${o.billed || o.onRoomBill ? '' : ' stay-summary__taken-tag--warn'}`}>{tagFor(o)}</span>
                    <span className="stay-summary__taken-amount">{formatPrice(o.subtotal)}</span>
                  </div>
                  <div className="stay-summary__taken-items">
                    {o.items?.map((i) => `${i.name} × ${i.quantity}`).join(', ')}
                  </div>
                  <div className="stay-summary__taken-where">
                    {o.origin === 'ROOM_SERVICE' ? 'Room service' : `From ${o.placedFrom || 'restaurant'}`}
                    {o.placedAt ? ` · ${formatDateTime(o.placedAt)}` : ''}
                    {o.status !== 'DELIVERED' ? ' · in progress' : ''}
                  </div>
                </div>
              ))}
              {allServices.map((u) => (
                <div className="stay-summary__taken" key={`s${u.id}`}>
                  <div className="stay-summary__taken-head">
                    <strong>{u.name}</strong>
                    <span className={`stay-summary__taken-tag${u.billed || u.onRoomBill ? '' : ' stay-summary__taken-tag--warn'}`}>{tagFor(u)}</span>
                    <span className="stay-summary__taken-amount">{formatPrice(u.amount)}</span>
                  </div>
                  <div className="stay-summary__taken-where">
                    {u.quantity} {u.unitLabel}
                    {u.headcount > 1 ? ` × ${u.headcount} people` : ''}
                    {u.startedAt ? ` · ${formatDateTime(u.startedAt)}` : ''}
                    {u.status !== 'COMPLETED' ? ' · in progress' : ''}
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
