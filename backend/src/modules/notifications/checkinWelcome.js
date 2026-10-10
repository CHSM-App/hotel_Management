const { getPool, sql } = require('../../config/connection');
const { logger } = require('../../config/logger');
const whatsapp = require('../../config/whatsapp');

// The WhatsApp welcome a guest gets once they're checked in.
//
// The template's five variables, in order:
//
//   {{1}} name       {{4}} checkout
//   {{2}} hotel_name  {{5}} phone
//   {{3}} room_no
//
// "Hi {{1}}, welcome to {{2}}! We're so glad to have you with us. Your room
//  {{3}} is all ready for you — take your time, relax, and make yourself at
//  home. Your check-out: {{4}}. Need anything at all, just call us at {{5}}
//  — we're happy to help. Wishing you a warm and restful stay."
//
// room_no, not a booking ID — same reasoning as cancellationNotice.js: the
// system never shows a guest their booking ID anywhere, so the room number
// is what they'd actually recognise.
//
// Best-effort, by design — same reasoning as bookingConfirmation.js and
// cancellationNotice.js. The check-in is already committed when this runs,
// and a provider outage must not turn into an error at the desk.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Same rule as the other notifiers: the template's variables travel as one
// comma-separated string, so a comma inside a value would push every later
// variable along by one — and an empty value is sent to WhatsApp as a
// rejected send that reports success at submission anyway (see
// cancellationNotice.js), so nothing here is ever allowed to come out empty.
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

function lodgeContact(lodge) {
  return lodge.phone || lodge.whatsappNumber || '-';
}

// The five template values, in template order. Pure, so it can be checked
// without a database; booking is bookings.service.js's mapped getBooking()
// shape (camelCase) — see notifyCheckedIn — lodge the raw dbo.lodges row,
// mapped the same way loadLodge below hands it over.
//
// roomNumbers, not roomNumber: a booking can hold more than one room, and
// mapBooking() already joins them into one display string ("204, 205") —
// see the same reasoning in cancellationNotice.js.
function buildCheckinSample(booking, lodge) {
  return [
    clean(booking.guestName),
    clean(lodge.name),
    clean(booking.roomNumbers),
    clean(formatDate(booking.checkOutDate)),
    clean(lodgeContact(lodge)),
  ];
}

async function loadLodge(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query('SELECT name, phone, whatsapp_number AS whatsappNumber FROM dbo.lodges WHERE id = @lodgeId');
  return result.recordset[0] ?? null;
}

// Fires the welcome and reports how it went, never throwing — the check-in
// stands regardless of whether WhatsApp is reachable.
async function notifyCheckedIn(lodgeId, booking) {
  if (!whatsapp.isCheckinTemplateConfigured()) return { status: 'skipped', reason: 'not configured' };
  try {
    const lodge = await loadLodge(lodgeId);
    if (!lodge) return { status: 'skipped', reason: 'lodge not found' };
    if (!booking.guestPhone) return { status: 'skipped', reason: 'no guest phone' };

    const sample = buildCheckinSample(booking, lodge);
    const { campaignId } = await whatsapp.sendTemplateMessage(
      booking.guestPhone,
      whatsapp.CHECKIN_TEMPLATE_ID,
      sample.join(','),
      'checkin_welcome'
    );
    logger.info({ bookingId: booking.id, lodgeId, campaignId }, 'Check-in welcome sent on WhatsApp');
    return { status: 'sent', campaignId };
  } catch (err) {
    logger.warn({ bookingId: booking.id, lodgeId, err }, 'Check-in welcome could not be sent on WhatsApp');
    return { status: 'failed', error: err.message };
  }
}

module.exports = {
  notifyCheckedIn,
  buildCheckinSample,
  clean,
};
