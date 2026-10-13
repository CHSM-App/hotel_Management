const { getPool, sql } = require('../../config/connection');
const { logger } = require('../../config/logger');
const whatsapp = require('../../config/whatsapp');
const { toClockTime } = require('../rooms/checkoutPolicy.service');

// The WhatsApp confirmation a guest gets when their booking is written down.
//
// One approved template serves both a stay and a function — for a stay,
// {{3}} carries the room number(s); for a function, the same slot carries
// the venue name, since neither booking kind shows a guest its booking ID
// anywhere else in the system (same reasoning as cancellationNotice.js's
// room_no and stayReminder.js's days_away: the template says something
// different depending on the caller, not something generic). The template's
// ten variables, in order:
//
//   {{1}} customer         {{6}} advance_paid
//   {{2}} property_name    {{7}} total_amount
//   {{3}} room_no/venue    {{8}} balance_due
//   {{4}} checkin_time     {{9}} directions
//   {{5}} checkout_time    {{10}} phone
//
// "Dear {{1}}, Thank you for choosing us! Your booking for {{2}} is
//  confirmed. Room No: {{3}} / Check-in: {{4}} / Check-out: {{5}} /
//  Advance Paid: ₹{{6}} / Total Amount: ₹{{7}} / Balance Due: ₹{{8}} /
//  Directions: {{9}} / Contact: {{10}} ..."
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

// Plain digits, no currency mark — the template's own text already carries
// the ₹ sign in front of each of these three slots, same convention
// cancellationNotice.js's refundModeAmount uses.
function money(value) {
  return Number(value || 0).toFixed(2);
}

// The ten template values for a stay, in template order. Pure, so it can be
// checked without a database; booking is the dbo.bookings row (plus
// room_numbers, advance_amount, total_price — see loadBooking), lodge the
// dbo.lodges row.
function buildStaySample(booking, lodge) {
  const times = stayTimes(booking, lodge);
  const advance = Number(booking.advance_amount || 0);
  const total = Number(booking.total_price || 0);
  return [
    booking.guest_name,
    lodge.name,
    booking.room_numbers,
    times.checkIn,
    times.checkOut,
    money(advance),
    money(total),
    money(total - advance),
    directionsFor(lodge),
    lodgeContact(lodge),
  ].map(clean);
}

// The same ten for a function. `event` is the API shape getEventBooking
// returns (camelCase, ISO instants, and already-computed advanceAmount/
// totalAmount/balanceDue — see events.service.js), which is what the events
// service holds at the moment it fires this. venueName takes the room-number
// slot; the property name alone (not "name (venue)") now that the venue has
// its own slot to be named in.
function buildEventSample(event, lodge) {
  return [
    event.organiserName,
    lodge.name,
    event.venueName || '-',
    formatInstantIST(event.startAt),
    formatInstantIST(event.endAt),
    money(event.advanceAmount),
    money(event.totalAmount),
    money(event.balanceDue ?? Number(event.totalAmount || 0) - Number(event.advanceAmount || 0)),
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
      SELECT b.id, b.guest_name, b.guest_phone, b.check_in_date, b.check_out_date,
             b.advance_amount, b.total_price,
             -- Every room the booking holds, same STRING_AGG shape
             -- bookings.service.js's own listBookings/mapBooking uses for
             -- roomNumbers — a fresh booking's rooms are all still 'BOOKED'
             -- (confirmation fires right after createBooking), but the
             -- CANCELLED exclusion is kept for consistency with that query.
             (
               SELECT STRING_AGG(r.room_number, ', ') WITHIN GROUP (ORDER BY br.id)
               FROM dbo.booking_rooms br
               JOIN dbo.rooms r ON r.id = br.room_id
               WHERE br.booking_id = b.id AND br.status <> 'CANCELLED'
             ) AS room_numbers
      FROM dbo.bookings b
      WHERE b.id = @bookingId AND b.lodge_id = @lodgeId
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
// CONFIRMED. The events service passes the booking it already
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
