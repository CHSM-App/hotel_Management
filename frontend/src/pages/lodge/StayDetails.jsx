import BillDocument from './BillDocument';
import './stayDetails.css';
import { formatPrice } from './priceFormat';
import { describeAdvance } from './paymentSplit';
import {
  VEHICLE_TYPE_LABEL,
  describeParty,
  formatDateLong,
  formatDateTime,
  formatLateBy,
  idProofLabel,
  outstandingBeforeTax,
} from './stayFormat';

// Everything known about a stay, read-only, laid out as the five sections the
// booking was taken through. Shared rather than re-rendered per screen: the
// tape chart and the billing queue both have to answer "what is this stay",
// and two answers to that question is one too many.
//
// The ID-proof "View" links only appear when the caller supplies a handler.
// Billing staff read this to decide what to charge, not to inspect a guest's
// documents, and the routes behind those links want a different permission.
export default function StayDetails({
  booking,
  idProofError = '',
  onViewIdProof,
  onViewGuestIdProof,
  onClearFoodLockout,
  clearingLockout = false,
  // The billing modal works out the real balance due, with tax, a few rows
  // further down its own screen. Two answers to "what is owed" in one modal —
  // one of them a pre-tax estimate — is one too many, so that caller turns
  // this off.
  showOutstanding = true,
}) {
  return (
    <div className="stay-details">
      <div className="form-section">
        <div className="form-section__title">
          <span className="form-section__num">1</span>Stay &amp; room
        </div>
        {/* Label above value, in the same grid the form lays its
            fields out in — so a fact sits exactly where the field
            that captured it does, and Edit is a change of control
            rather than a change of layout. */}
        <div className="detail-facts">
          <div className="detail-fact">
            <span className="detail-fact__label">Room</span>
            <span className="detail-fact__value">
              {booking.roomNumber} · {booking.categoryName}
            </span>
          </div>
          <div className="detail-fact">
            <span className="detail-fact__label">Dates</span>
            <span className="detail-fact__value">
              {formatDateLong(booking.checkInDate)} –{' '}
              {formatDateLong(booking.checkOutDate)}
              {booking.nights?.length > 0 && (
                <span className="bookings-panel__muted">
                  {' · '}
                  {booking.nights.length}{' '}
                  {booking.nights.length === 1 ? 'night' : 'nights'}
                </span>
              )}
            </span>
          </div>
          {/* What the guest booked is above; this is what actually
              happened. Blanks are spelled out rather than dashed — "—"
              makes a reader stop and work out whether the guest hasn't
              arrived or the arrival simply wasn't recorded. */}
          <div className="detail-fact">
            <span className="detail-fact__label">Came in</span>
            <span className="detail-fact__value">
              {booking.actualCheckInAt
                ? formatDateTime(booking.actualCheckInAt)
                : 'Not arrived yet'}
            </span>
          </div>
          <div className="detail-fact">
            <span className="detail-fact__label">Left</span>
            <span className="detail-fact__value">
              {booking.actualCheckOutAt
                ? formatDateTime(booking.actualCheckOutAt)
                : booking.actualCheckInAt
                  ? 'Still staying'
                  : 'Not arrived yet'}
            </span>
          </div>
          {formatLateBy(booking.lateCheckoutMinutes) && (
            <div className="detail-fact">
              <span className="detail-fact__label">Left late by</span>
              <span className="detail-fact__value">
                {formatLateBy(booking.lateCheckoutMinutes)}
                {/* "agreed", not "charged" — this is what reception
                    settled on at the door. Whether it reached the
                    guest's bill is the billing desk's call. */}
                <span className="bookings-panel__muted">
                  {' · '}
                  {booking.lateCheckoutCharge > 0
                    ? `${formatPrice(booking.lateCheckoutCharge)} agreed`
                    : 'no charge taken'}
                </span>
              </span>
            </div>
          )}
          {booking.switchableCharges.length > 0 && (
            <div className="detail-fact detail-fact--wide">
              <span className="detail-fact__label">Extras</span>
              <span className="detail-fact__value">
                {booking.switchableCharges
                  .map((c) => (c.quantity > 1 ? `${c.name} ×${c.quantity}` : c.name))
                  .join(' · ')}
              </span>
            </div>
          )}
          {/* Full width: the PIN carries an instruction to read out,
              and sometimes an unlock button. */}
          {booking.status === 'CHECKED_IN' && booking.foodPin && (
            <div className="detail-fact detail-fact--wide">
              <span className="detail-fact__label">Food PIN</span>
              <div className="bookings-panel__pin">
                <span className="bookings-panel__pin-value">{booking.foodPin}</span>
                {booking.foodOrderingLockedUntil ? (
                  <span className="badge badge--off">Locked</span>
                ) : null}
              </div>
              <div className="bookings-panel__pin-hint">
                {booking.foodOrderingLockedUntil ? (
                  <>
                    Too many wrong PINs — ordering is blocked for this room.
                    <button
                      type="button"
                      className="bookings-panel__link-btn"
                      onClick={onClearFoodLockout}
                      disabled={clearingLockout}
                    >
                      {clearingLockout ? 'Clearing…' : 'Unlock now'}
                    </button>
                  </>
                ) : (
                  'Read this out to the guest — they need it to order food from the QR code.'
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="form-section">
        <div className="form-section__title">
          <span className="form-section__num">2</span>Guest details
        </div>
        <div className="booking-form__party-summary">
          <span className="booking-form__party-total">
            {booking.numGuests} guest{booking.numGuests === 1 ? '' : 's'}
          </span>
          <span className="booking-form__party-split">
            {describeParty(
              booking.numGuests - booking.childCount,
              booking.childCount
            )}
          </span>
        </div>
        {/* One row per person, the same order the party editor lists
            them in: the primary guest first, then adults, then
            children. The role sits under the name rather than beside
            it so a long name and a long ID type can't collide. */}
        <div className="detail-people">
          <div className="detail-person">
            <span className="detail-person__name">
              {booking.guestName}
              <span className="detail-person__role">Primary guest</span>
            </span>
            <span className="detail-person__meta">
              {booking.guestPhone}
              {booking.idProofType && ` · ${idProofLabel(booking.idProofType)}`}
              {booking.hasIdProofDocument && onViewIdProof && (
                <button type="button" className="bookings-panel__link-btn" onClick={onViewIdProof}>
                  View
                </button>
              )}
            </span>
          </div>
          {booking.guests.map((g) => (
            <div className="detail-person" key={g.id}>
              <span className="detail-person__name">
                {g.name}
                {g.isChild && <span className="detail-person__role">Child</span>}
              </span>
              <span className="detail-person__meta">
                {[g.phone, g.idProofType && idProofLabel(g.idProofType)]
                  .filter(Boolean)
                  .join(' · ') || 'No details on file'}
                {g.hasIdProofDocument && onViewGuestIdProof && (
                  <button
                    type="button"
                    className="bookings-panel__link-btn"
                    onClick={() => onViewGuestIdProof(g.id)}
                  >
                    View
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
        {idProofError && <div className="form-banner form-banner--error">{idProofError}</div>}
      </div>

      {/* Sections 3 and 4 share a row the way they do on the form —
          both are usually short, and stacked they push the money down
          the modal. Stated even when empty: "no advance" is an answer
          reception is asked for, and a missing row isn't one. */}
      <div className="booking-form__optional">
        <div className="form-section">
          <div className="form-section__title">
            <span className="form-section__num">3</span>Advance payment
          </div>
          {booking.advanceAmount != null ? (
            <div className="detail-facts">
              <div className="detail-fact">
                <span className="detail-fact__label">Taken</span>
                <span className="detail-fact__value">
                  {formatPrice(booking.advanceAmount)}
                  <span className="bookings-panel__muted">
                    {' · '}
                    {describeAdvance(booking.advancePaymentLines, booking.advancePaymentMethod)}
                  </span>
                </span>
              </div>
              {/* Only ever set for UPI and card — it is the number
                  the settlement statement is reconciled against. */}
              {booking.advanceReference && (
                <div className="detail-fact detail-fact--wide">
                  <span className="detail-fact__label">Transaction no.</span>
                  <span className="detail-fact__value">{booking.advanceReference}</span>
                </div>
              )}
            </div>
          ) : (
            <p className="detail-empty">No advance taken.</p>
          )}
        </div>

        <div className="form-section">
          <div className="form-section__title">
            <span className="form-section__num">4</span>Vehicles
          </div>
          {booking.vehicles.length === 0 ? (
            <p className="detail-empty">None on file.</p>
          ) : (
            <div className="detail-people">
              {booking.vehicles.map((v) => (
                <div className="detail-person" key={v.number}>
                  <span className="detail-person__name">{v.number}</span>
                  <span className="detail-person__meta">
                    {v.type ? VEHICLE_TYPE_LABEL[v.type] : 'Type not recorded'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* What the stay costs and what has been paid against it, from the
          rates frozen when the booking was taken. Composed of rates rather
          than of dates: a guest querying their bill asks what the room cost a
          night and what the extras were, not what each individual night came
          to — and a stay crossing a season shows that in its lines. */}
      <div className="form-section">
        <div className="form-section__title">
          <span className="form-section__num">5</span>Charges &amp; discount
        </div>
        <div className="sim-result">
          {/* What those nightly figures are made of — the base rate,
              any season on top, each extra, the discount — summed
              across the nights each one applied to. Read from the
              booking's own snapshot, so it says what was charged even
              if a season or an extra has been re-priced since. A
              guest querying the total argues about these lines, not
              the sum of them.

              Empty for bookings taken before the snapshot existed,
              which fall through to the total on its own as before. */}
          {booking.roomCharges?.map((line) => (
            <div className="sim-result__line sim-result__line--part" key={line.label}>
              <span>
                {line.label}
                {line.nights > 1 && line.amount > 0 && (
                  <span className="sim-result__part-nights">× {line.nights} nights</span>
                )}
              </span>
              <span>{formatPrice(line.amount)}</span>
            </div>
          ))}
          <div className="sim-result__total">
            <span>
              Room charge for {booking.nights?.length === 1 ? 'the night' : 'all nights'}
            </span>
            <span>{formatPrice(booking.totalPrice)}</span>
          </div>
          {booking.lateCheckoutCharge > 0 && (
            <div className="sim-result__line">
              <span>Agreed for leaving late</span>
              <span>{formatPrice(booking.lateCheckoutCharge)}</span>
            </div>
          )}
          {booking.advanceAmount != null && (
            <div className="sim-result__line">
              <span>
                Advance already paid
                <span className="bookings-panel__muted">
                  {' · '}
                  {describeAdvance(booking.advancePaymentLines, booking.advancePaymentMethod)}
                  {booking.advanceReference ? ` · ${booking.advanceReference}` : ''}
                </span>
              </span>
              <span>− {formatPrice(booking.advanceAmount)}</span>
            </div>
          )}
          {/* Only while the stay is still unbilled. Once a bill
              exists it is the answer to "what is owed", and a
              pre-tax guess sitting beside it would be a second,
              wrong one. */}
          {showOutstanding && !booking.invoice && (
            <div className="sim-result__total">
              <span>Still to collect</span>
              <span>{formatPrice(outstandingBeforeTax(booking))}</span>
            </div>
          )}
        </div>
        {showOutstanding && !booking.invoice && (
          <p className="bookings-panel__hint">
            Before GST — tax is worked out on the bill, night by night, when it is issued.
          </p>
        )}
      </div>

      {/* The issued document itself, rendered by the same component
          the bills screen and the printout use. Reception is asked
          what a guest was charged while looking at this screen, and
          the booking must not become a second opinion on it. */}
      {booking.invoice && (
        <div className="form-section">
          <div className="form-section__title">
            Bill {booking.invoice.invoiceNumber}
          </div>
          <div className="bill-print-target">
            <BillDocument invoice={booking.invoice} />
          </div>
        </div>
      )}
    </div>
  );
}
