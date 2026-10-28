const { getPool, sql } = require('../../config/connection');
const { logger } = require('../../config/logger');
const whatsapp = require('../../config/whatsapp');
const lateCheckout = require('../bookings/lateCheckout');
const { toClockTime } = require('../rooms/checkoutPolicy.service');

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
// {{4}} is the guest's actual checkout moment — date and time — worked out
// from when each room was checked in, because on a 24-hour or hybrid property
// it differs guest to guest (in at 10am, out at 10am). See checkoutDeadlines.
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

// "23 Oct 2026 10:00 AM", at the property's wall clock (IST) whatever zone the
// server runs in. No comma: the template's variables travel comma-separated.
function formatMoment(instant) {
  const time = instant.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });
  return `${formatDate(lateCheckout.isoDateInLodgeZone(instant))} ${time.toUpperCase()}`;
}

// When this guest is actually due out. Each checked-in room has its own arrival
// and dates, so it is worked out per room; rooms due out at the same moment
// collapse to one, and a booking whose rooms differ shows each distinct moment.
// Falls back to the booked date alone when nothing can be worked out.
function checkoutText(booking, deadlines) {
  if (!deadlines || deadlines.length === 0) return formatDate(booking.checkOutDate);
  const distinct = [...new Set(deadlines.map((d) => d.getTime()))].sort((a, b) => a - b);
  return distinct.map((t) => formatMoment(new Date(t))).join(' / ');
}

// The five template values, in template order. Pure, so it can be checked
// without a database; booking is bookings.service.js's mapped getBooking()
// shape (camelCase) — see notifyCheckedIn — lodge the raw dbo.lodges row,
// mapped the same way loadLodge below hands it over.
//
// roomNumbers, not roomNumber: a booking can hold more than one room, and
// mapBooking() already joins them into one display string ("204, 205") —
// see the same reasoning in cancellationNotice.js.
function buildCheckinSample(booking, lodge, deadlines = null) {
  return [
    clean(booking.guestName),
    clean(lodge.name),
    clean(booking.roomNumbers),
    clean(checkoutText(booking, deadlines)),
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

// The checkout moment for each room the guest has checked into, by the
// property's own rule (see lateCheckout.checkoutDeadline).
async function loadDeadlines(lodgeId, bookingId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT br.check_in_date, br.check_out_date, br.actual_check_in_at,
             l.checkin_mode, l.check_in_time, l.check_out_time, l.early_arrival_from
      FROM dbo.booking_rooms br
      JOIN dbo.bookings b ON b.id = br.booking_id
      JOIN dbo.lodges l ON l.id = b.lodge_id
      WHERE br.booking_id = @bookingId AND b.lodge_id = @lodgeId AND br.status = 'CHECKED_IN'
    `);
  const day = (v) => (typeof v === 'string' ? v : v.toISOString()).slice(0, 10);
  return result.recordset.map((row) =>
    lateCheckout.checkoutDeadline({
      checkinMode: row.checkin_mode,
      checkOutTime: toClockTime(row.check_out_time),
      checkInTime: toClockTime(row.check_in_time),
      earlyArrivalFrom: row.early_arrival_from == null ? null : toClockTime(row.early_arrival_from),
      checkInDate: day(row.check_in_date),
      checkOutDate: day(row.check_out_date),
      actualCheckInAt: row.actual_check_in_at,
    })
  );
}

// Fires the welcome and reports how it went, never throwing — the check-in
// stands regardless of whether WhatsApp is reachable.
async function notifyCheckedIn(lodgeId, booking) {
  if (!whatsapp.isCheckinTemplateConfigured()) return { status: 'skipped', reason: 'not configured' };
  try {
    const lodge = await loadLodge(lodgeId);
    if (!lodge) return { status: 'skipped', reason: 'lodge not found' };
    if (!booking.guestPhone) return { status: 'skipped', reason: 'no guest phone' };

    // A lookup that fails must not cost the guest the welcome; the booked date
    // is a fair thing to say when the exact moment can't be worked out.
    const deadlines = await loadDeadlines(lodgeId, booking.id).catch(() => null);
    const sample = buildCheckinSample(booking, lodge, deadlines);
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
  formatMoment,
  clean,
};
