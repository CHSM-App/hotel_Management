const { getPool, sql } = require('../../config/connection');
const { logger } = require('../../config/logger');
const whatsapp = require('../../config/whatsapp');
const { toClockTime } = require('../rooms/checkoutPolicy.service');

// The WhatsApp confirmation a guest gets when their booking is written down.
//
// One approved template serves both a stay and a function, because the
// message says the same thing about either: who, where, which booking, when
// it starts, when it ends, how to get there, whom to call. The template's
// seven variables, in order:
//
//   {{1}} customer        {{5}} checkout_time
//   {{2}} rest_name       {{6}} location
//   {{3}} booking_id      {{7}} phone
//   {{4}} checkin_time
//
// "Dear {{1}}, Thank you for choosing Us. Your booking for {{2}} is
//  confirmed. Booking ID: {{3}} / Check-in Date & Time: {{4}} /
//  Check-out Date & Time: {{5}} / Property Directions: {{6}} /
//  Property Phone Number: {{7}} ..."
//
// Best-effort, by design. The booking is already committed when this runs,
// and a provider outage must not turn into "the booking failed" at the desk —
// so nothing here throws: every outcome is returned and logged, and the
// callers fire it without waiting. The desk keeps the guest's number either
// way; a message that did not go out is a phone call, not a lost booking.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// The template's variables travel as one comma-separated string (see
// sendTemplateMessage), so a comma inside a value would push every later
// variable along by one — the address landing in the phone slot. Commas become
// a dash, whitespace collapses, and an empty value becomes a dash too: the
// provider rejects a template with a blank variable outright.
function clean(value) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ' - ')
    .trim();
  return text || '-';
}

// A DATE column arrives from mssql as a Date at UTC midnight; the schemas
// hand over 'YYYY-MM-DD'. Either way the calendar date is the UTC fields.
function dateParts(value) {
  if (typeof value === 'string') {
    const [y, m, d] = value.slice(0, 10).split('-').map(Number);
    return { y, m, d };
  }
  return { y: value.getUTCFullYear(), m: value.getUTCMonth() + 1, d: value.getUTCDate() };
}

function formatDate({ y, m, d }) {
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// '18:00' -> '6:00 PM'. Twelve-hour, because that is how a guest reads a
// check-in time on a phone; the desk's settings screen keeps 24-hour.
function formatClock(hhmm) {
  const [h, min] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(min).padStart(2, '0')} ${suffix}`;
}

// An instant, said in IST — every property on this system is in India, and a
// function booked for "6 PM" must read 6 PM regardless of the server's clock.
function formatInstantIST(value) {
  const shifted = new Date(new Date(value).getTime() + IST_OFFSET_MS);
  const date = formatDate({ y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() });
  const clock = `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`;
  return `${date} ${formatClock(clock)}`;
}

// Where to send the guest. The pin wins when the property has one — a Maps
// link opens turn-by-turn from wherever the guest is, which a typed address
// cannot. The comma between the coordinates is URL-encoded so it survives the
// variable packing described above. Otherwise the postal address, which is
// what the bill prints and at least names the town.
function directionsFor(lodge) {
  if (lodge.latitude != null && lodge.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${Number(lodge.latitude)}%2C${Number(lodge.longitude)}`;
  }
  // Properties often type the town into the address line too; "Vengurla -
  // Vengurla" reads like a mistake, so a part already named is not repeated.
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

// When a stay begins and ends, as the property's own rules put it. A
// NIGHT_BASED or CYCLE property has fixed clock times on the lodge; a
// HOUR_24 property checks out 24 hours after the guest actually arrived, so
// there is no time to promise until they do.
function stayTimes(booking, lodge) {
  const checkIn = formatDate(dateParts(booking.check_in_date));
  const checkOut = formatDate(dateParts(booking.check_out_date));
  if (lodge.checkin_mode === 'HOUR_24') {
    return { checkIn, checkOut: `${checkOut} (24 hrs from check-in)` };
  }
  return {
    checkIn: `${checkIn} ${formatClock(toClockTime(lodge.check_in_time))}`,
    checkOut: `${checkOut} ${formatClock(toClockTime(lodge.check_out_time))}`,
  };
}

function lodgeContact(lodge) {
  return lodge.phone || lodge.whatsapp_number || '-';
}

// The seven template values for a stay, in template order. Pure, so it can be
// checked without a database; booking is the dbo.bookings row, lodge the
// dbo.lodges row.
function buildStaySample(booking, lodge) {
  const times = stayTimes(booking, lodge);
  return [
    booking.guest_name,
    lodge.name,
    `#${booking.id}`,
    times.checkIn,
    times.checkOut,
    directionsFor(lodge),
    lodgeContact(lodge),
  ].map(clean);
}

// The same seven for a function. `event` is the API shape getEventBooking
// returns (camelCase, ISO instants), which is what the events service holds
// at the moment it fires this. The venue name rides with the property name so
// a lodge with a hall and a lawn tells the organiser which one they have.
function buildEventSample(event, lodge) {
  const where = event.venueName ? `${lodge.name} (${event.venueName})` : lodge.name;
  return [
    event.organiserName,
    where,
    `EV-${event.id}`,
    formatInstantIST(event.startAt),
    formatInstantIST(event.endAt),
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
      SELECT name, phone, whatsapp_number, address, city, state, latitude, longitude,
             checkin_mode, check_in_time, check_out_time
      FROM dbo.lodges
      WHERE id = @lodgeId
    `);
  return result.recordset[0] ?? null;
}

async function loadBooking(lodgeId, bookingId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT id, guest_name, guest_phone, check_in_date, check_out_date
      FROM dbo.bookings
      WHERE id = @bookingId AND lodge_id = @lodgeId
    `);
  return result.recordset[0] ?? null;
}

// Runs the send and reports how it went, never throwing. `kind` and `id`
// label the log lines so "did the guest for booking 41 get a message" can be
// answered from the log after the fact.
async function deliver({ kind, id, lodgeId, phone, sample }) {
  const context = { kind, id, lodgeId };
  try {
    const { campaignId } = await whatsapp.sendTemplateMessage(
      phone,
      whatsapp.BOOKING_TEMPLATE_ID,
      sample.join(','),
      'booking_confirmation'
    );
    logger.info({ ...context, campaignId }, 'Booking confirmation sent on WhatsApp');
    return { status: 'sent', campaignId };
  } catch (err) {
    // A warning, not an error: the booking stands, and the usual cause — a
    // number that is not on WhatsApp — is nothing the server can fix.
    logger.warn({ ...context, err }, 'Booking confirmation could not be sent on WhatsApp');
    return { status: 'failed', error: err.message };
  }
}

function skipped(reason) {
  return { status: 'skipped', reason };
}

// A stay, freshly saved. Reads the row back rather than trusting the input,
// so what the guest is told is what the database holds.
async function notifyStayBooked(lodgeId, bookingId) {
  if (!whatsapp.isBookingTemplateConfigured()) return skipped('not configured');
  try {
    const [booking, lodge] = await Promise.all([loadBooking(lodgeId, bookingId), loadLodge(lodgeId)]);
    if (!booking || !lodge) return skipped('booking or lodge not found');
    return await deliver({
      kind: 'stay',
      id: bookingId,
      lodgeId,
      phone: booking.guest_phone,
      sample: buildStaySample(booking, lodge),
    });
  } catch (err) {
    logger.warn({ kind: 'stay', id: bookingId, lodgeId, err }, 'Booking confirmation could not be prepared');
    return { status: 'failed', error: err.message };
  }
}

// A function that has just taken its venue — created as, or moved to,
// TENTATIVE or CONFIRMED. The events service passes the booking it already
// holds, so only the lodge is read here.
async function notifyEventBooked(lodgeId, event) {
  if (!whatsapp.isBookingTemplateConfigured()) return skipped('not configured');
  try {
    const lodge = await loadLodge(lodgeId);
    if (!lodge) return skipped('lodge not found');
    return await deliver({
      kind: 'event',
      id: event.id,
      lodgeId,
      phone: event.organiserPhone,
      sample: buildEventSample(event, lodge),
    });
  } catch (err) {
    logger.warn({ kind: 'event', id: event?.id, lodgeId, err }, 'Booking confirmation could not be prepared');
    return { status: 'failed', error: err.message };
  }
}

module.exports = {
  notifyStayBooked,
  notifyEventBooked,
  buildStaySample,
  buildEventSample,
  formatInstantIST,
  directionsFor,
  clean,
};
