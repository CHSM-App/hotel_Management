const { getPool, sql } = require('../../config/connection');
const { logger } = require('../../config/logger');
const whatsapp = require('../../config/whatsapp');

// The WhatsApp confirmation an organiser gets when their function takes its
// venue — split out of bookingConfirmation.js once a function's own wording
// (venue, a single date, a start-end time range) stopped fitting the stay
// template's shape (room number, separate check-in/check-out instants).
//
// The template's ten variables, in order:
//
//   {{1}} name        {{6}} advance_paid
//   {{2}} hotel_name   {{7}} total_amount
//   {{3}} venue        {{8}} balance_due
//   {{4}} event_date   {{9}} directions
//   {{5}} time_range   {{10}} phone
//
// "Dear {{1}}, Thank you for choosing {{2}}! Your event booking is
//  confirmed 🎉 Venue: {{3}} / Date: {{4}} / Time: {{5}} / Advance Paid:
//  ₹{{6}} / Total Amount: ₹{{7}} / Balance Due: ₹{{8}} / Directions: {{9}}
//  / Contact: {{10}}. We look forward to hosting your event. Thank you!"
//
// Best-effort, by design — same reasoning as every other notifier here. The
// venue is already held when this runs, and a provider outage must not turn
// into "the booking failed" at the desk.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Same rule as every other notifier: the template's variables travel as one
// comma-separated string, so a comma inside a value would push every later
// variable along by one, and an empty value is sent to WhatsApp as a
// rejected send the provider still reports as submitted (see
// cancellationNotice.js) — so nothing here is ever allowed to come out empty.
function clean(value) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ' - ')
    .trim();
  return text || '-';
}

// An instant, said in IST — every property on this system is in India, and
// an event booked for "6 PM" must read 6 PM regardless of the server's clock.
function istParts(value) {
  const shifted = new Date(new Date(value).getTime() + IST_OFFSET_MS);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    min: shifted.getUTCMinutes(),
  };
}

function formatClock({ h, min }) {
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(min).padStart(2, '0')} ${suffix}`;
}

// The event's own calendar day, read off when it starts — a function that
// crosses midnight is still "that evening's" event to the organiser.
function eventDate(startAt) {
  const { y, m, d } = istParts(startAt);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// "6:00 PM - 10:00 PM" — one variable, not two (start_time/end_time), per
// the user's own request: a single slot the template joins with a plain
// hyphen, which is safe here since only a comma is the variable separator.
function eventTimeRange(startAt, endAt) {
  return `${formatClock(istParts(startAt))} - ${formatClock(istParts(endAt))}`;
}

// Plain digits, no currency mark — the template's own text already carries
// the ₹ sign in front of each of these three slots.
function money(value) {
  return Number(value || 0).toFixed(2);
}

// Where to send the organiser. The pin wins when the property has one — a
// Maps link opens turn-by-turn from wherever they are, which a typed
// address cannot. Same logic as bookingConfirmation.js's directionsFor,
// duplicated rather than imported — see that file's own note on why each
// notifier here is self-contained.
function directionsFor(lodge) {
  if (lodge.latitude != null && lodge.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${Number(lodge.latitude)}%2C${Number(lodge.longitude)}`;
  }
  const parts = [];
  for (const raw of [lodge.address, lodge.city, lodge.state]) {
    const part = clean(raw);
    if (part === '-') continue;
    const seen = parts.join(' ').toLowerCase();
    if (seen.includes(part.toLowerCase())) continue;
    parts.push(part);
  }
  return parts.length > 0 ? parts.join(' - ') : '-';
}

function lodgeContact(lodge) {
  return lodge.phone || lodge.whatsapp_number || '-';
}

// The ten template values, in template order. Pure, so it can be checked
// without a database; event is the API shape getEventBooking returns
// (camelCase, ISO instants, already-computed advanceAmount/totalAmount/
// balanceDue), lodge the raw dbo.lodges row loadLodge below hands over.
function buildEventConfirmationSample(event, lodge) {
  const advance = Number(event.advanceAmount || 0);
  const total = Number(event.totalAmount || 0);
  const balance = event.balanceDue ?? total - advance;
  return [
    event.organiserName,
    lodge.name,
    event.venueName,
    eventDate(event.startAt),
    eventTimeRange(event.startAt, event.endAt),
    money(advance),
    money(total),
    money(balance),
    directionsFor(lodge),
    lodgeContact(lodge),
  ].map(clean);
}

async function loadLodge(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT name, phone, whatsapp_number, address, city, state, latitude, longitude
      FROM dbo.lodges
      WHERE id = @lodgeId
    `);
  return result.recordset[0] ?? null;
}

// Fires the confirmation and reports how it went, never throwing — the
// venue is already held when this runs, so a failed send is a missed
// courtesy, not a lost booking.
async function notifyEventBooked(lodgeId, event) {
  if (!whatsapp.isEventBookingTemplateConfigured()) return { status: 'skipped', reason: 'not configured' };
  try {
    const lodge = await loadLodge(lodgeId);
    if (!lodge) return { status: 'skipped', reason: 'lodge not found' };
    if (!event.organiserPhone) return { status: 'skipped', reason: 'no organiser phone' };

    const sample = buildEventConfirmationSample(event, lodge);
    const { campaignId } = await whatsapp.sendTemplateMessage(
      event.organiserPhone,
      whatsapp.EVENT_BOOKING_TEMPLATE_ID,
      sample.join(','),
      'event_booking_confirmation'
    );
    logger.info({ eventId: event.id, lodgeId, campaignId }, 'Event booking confirmation sent on WhatsApp');
    return { status: 'sent', campaignId };
  } catch (err) {
    logger.warn({ eventId: event.id, lodgeId, err }, 'Event booking confirmation could not be sent on WhatsApp');
    return { status: 'failed', error: err.message };
  }
}

module.exports = {
  notifyEventBooked,
  buildEventConfirmationSample,
  eventDate,
  eventTimeRange,
  directionsFor,
  clean,
};
