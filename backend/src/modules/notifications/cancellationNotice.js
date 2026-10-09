const { getPool, sql } = require('../../config/connection');
const { logger } = require('../../config/logger');
const whatsapp = require('../../config/whatsapp');

// The WhatsApp notice a guest gets when their booking is cancelled.
//
// The template's seven variables, in order:
//
//   {{1}} name           {{5}} checkout
//   {{2}} hotel_name      {{6}} reason
//   {{3}} room_no          {{7}} refund_mode_amount
//   {{4}} check_in
//
// "Dear {{1}}, {{2}}, Your booking has been cancelled as per your request.
//  Booking Details: Room No: {{3}} / Check-in: {{4}} / Check-out: {{5}}
//  / {{6}} / {{7}} / Your refund will be processed within a few business
//  days. If you did not request this cancellation, please contact us
//  immediately. We hope to welcome you another time."
//
// room_no, not a booking ID — nowhere else in the system shows a guest their
// booking ID, so a WhatsApp message naming one would be the only place it
// ever surfaces, with no screen to look it up against. The room number is
// what the guest actually recognises from their stay.
//
// Best-effort, by design — same reasoning as bookingConfirmation.js. The
// cancellation is already committed when this runs, and a provider outage
// must not turn "the cancellation succeeded" into an error at the desk.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Same rule as bookingConfirmation.js and billShare.service.js: the
// template's variables travel as one comma-separated string, so a comma
// inside a value would push every later variable along by one.
function clean(value) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ' - ')
    .trim();
  return text || '-';
}

// This used to leave a missing cancellation reason as a genuine empty
// string rather than falling back to '-' like every other variable. But
// WhatsApp's template API rejects a body parameter that's empty — and
// SMSala's /SendMessage responds with success at submission regardless,
// so the failure never came back as anything this code could see: the
// desk got "WhatsApp notice sent", and the guest got nothing. clean()'s
// own '-' fallback is what every other slot already relies on; the reason
// slot needs the same guarantee of never being empty.

function dateParts(value) {
  if (typeof value === 'string') {
    const [y, m, d] = value.slice(0, 10).split('-').map(Number);
    return { y, m, d };
  }
  return { y: value.getUTCFullYear(), m: value.getUTCMonth() + 1, d: value.getUTCDate() };
}

function formatDate(value) {
  const { y, m, d } = dateParts(value);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// "Refund of Rs 1500.00 via UPI" / "Cancellation charge of Rs 500.00 via Cash"
// / "No refund due" — whichever of the two settlements the desk recorded.
// The two are mutually exclusive on a cancelled booking (see cancelBooking in
// bookings.service.js), so at most one of these ever has something to say.
//
// `booking` here is bookings.service.js's mapped getBooking() shape
// (camelCase), not the raw dbo.bookings row — see notifyBookingCancelled.
function refundModeAmount(booking) {
  const refund = booking.refundAmount != null ? Number(booking.refundAmount) : null;
  const charge = booking.cancellationCharge != null ? Number(booking.cancellationCharge) : null;
  if (refund != null && refund > 0) {
    return `Refund: Rs ${refund.toFixed(2)} via ${booking.refundPaymentMethod || '-'}`;
  }
  if (charge != null && charge > 0) {
    return `Cancellation charge: Rs ${charge.toFixed(2)} via ${booking.cancellationChargePaymentMethod || '-'}`;
  }
  return 'No refund due';
}

// The seven template values, in template order. Pure, so it can be checked
// without a database; booking is getBooking()'s mapped shape (camelCase) —
// see notifyBookingCancelled — lodge the raw dbo.lodges row.
//
// roomNumbers, not roomNumber: a booking can hold more than one room, and
// mapBooking() already joins them into one display string ("204, 205") for
// exactly this kind of guest-facing slot — roomNumber alone would silently
// drop every room past the first on a multi-room booking.
function buildCancellationSample(booking, lodge) {
  return [
    clean(booking.guestName),
    clean(lodge.name),
    clean(booking.roomNumbers),
    clean(formatDate(booking.checkInDate)),
    clean(formatDate(booking.checkOutDate)),
    clean(booking.cancelReason),
    clean(refundModeAmount(booking)),
  ];
}

async function loadLodge(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query('SELECT name FROM dbo.lodges WHERE id = @lodgeId');
  return result.recordset[0] ?? null;
}

// Fires the cancellation notice and reports how it went, never throwing —
// the cancellation stands regardless of whether WhatsApp is reachable.
async function notifyBookingCancelled(lodgeId, booking) {
  if (!whatsapp.isCancellationTemplateConfigured()) return { status: 'skipped', reason: 'not configured' };
  try {
    const lodge = await loadLodge(lodgeId);
    if (!lodge) return { status: 'skipped', reason: 'lodge not found' };
    if (!booking.guestPhone) return { status: 'skipped', reason: 'no guest phone' };

    const sample = buildCancellationSample(booking, lodge);
    const { campaignId } = await whatsapp.sendTemplateMessage(
      booking.guestPhone,
      whatsapp.CANCELLATION_TEMPLATE_ID,
      sample.join(','),
      'booking_cancellation'
    );
    logger.info({ bookingId: booking.id, lodgeId, campaignId }, 'Cancellation notice sent on WhatsApp');
    return { status: 'sent', campaignId };
  } catch (err) {
    logger.warn({ bookingId: booking.id, lodgeId, err }, 'Cancellation notice could not be sent on WhatsApp');
    return { status: 'failed', error: err.message };
  }
}

module.exports = {
  notifyBookingCancelled,
  buildCancellationSample,
  refundModeAmount,
  clean,
};
