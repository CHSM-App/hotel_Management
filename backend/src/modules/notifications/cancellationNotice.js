const { getPool, sql } = require('../../config/connection');
const { logger } = require('../../config/logger');
const whatsapp = require('../../config/whatsapp');

// The WhatsApp notice a guest gets when their booking is cancelled.
//
// The template's seven variables, in order:
//
//   {{1}} name           {{5}} checkout
//   {{2}} hotel_name      {{6}} reason
//   {{3}} b_id (booking)  {{7}} refund_mode_amount
//   {{4}} check_in
//
// "Dear {{1}}, {{2}}, Your booking has been cancelled as per your request.
//  Booking Details: Booking ID: #{{3}} / Check-in: {{4}} / Check-out: {{5}}
//  / {{6}} / {{7}} / Your refund will be processed within a few business
//  days. If you did not request this cancellation, please contact us
//  immediately. We hope to welcome you another time."
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
function buildCancellationSample(booking, lodge) {
  return [
    booking.guestName,
    lodge.name,
    `#${booking.id}`,
    formatDate(booking.checkInDate),
    formatDate(booking.checkOutDate),
    booking.cancelReason || 'Not specified',
    refundModeAmount(booking),
  ].map(clean);
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
