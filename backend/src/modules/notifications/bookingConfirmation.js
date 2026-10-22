const { getPool, sql } = require('../../config/connection');
const { logger } = require('../../config/logger');
const whatsapp = require('../../config/whatsapp');
const { toClockTime } = require('../rooms/checkoutPolicy.service');

// The WhatsApp confirmation a guest gets when their stay booking is written
// down. Function bookings get their own template/module now — see
// notifications/eventConfirmation.js — once a function's own wording (venue,
// a single date, a start-end time range) stopped fitting this one's shape
// (room number, separate check-in/check-out instants). The template's ten
// variables, in order:
//
//   {{1}} customer         {{6}} advance_paid
//   {{2}} property_name    {{7}} total_amount
//   {{3}} room_no          {{8}} balance_due
//   {{4}} checkin_time     {{9}} directions
//   {{5}} checkout_time    {{10}} phone
//
// "Dear {{1}}, Thank you for choosing us! Your booking for {{2}} is
//  confirmed. Room No: {{3}} / Check-in: {{4}} / Check-out: {{5}} /
//  Advance Paid: ₹{{6}} / Total Amount: ₹{{7}} / Balance Due: ₹{{8}} /
//  Directions: {{9}} / Contact: {{10}} ..."
//
// One booking can hold rooms on different date ranges — dbo.booking_rooms
// carries its own check_in_date/check_out_date per room, and
// dbo.bookings.check_in_date/check_out_date (see syncBookingFromRooms in
// bookings.service.js) is only the envelope: earliest check-in to latest
// check-out across all of them. A single {{4}}/{{5}} pair can only ever
// honestly speak for rooms that actually share one date range, so:
//
//   - every active room has the same check-in AND check-out  -> one message,
//     {{3}} names every room (the existing STRING_AGG'd room_numbers), {{4}}/
//     {{5}} are that one shared range, {{6}}-{{8}} are the booking's own
//     totals — unchanged from before this split existed.
//   - the rooms disagree on dates -> one message per room instead, each
//     naming just that room and its own dates. Advance Paid and Balance Due
//     are not stored per room (only total_price is, on booking_rooms), so
//     the booking's one advance payment is split across the per-room
//     messages in proportion to each room's own share of the booking total —
//     see buildPerRoomSample.
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
// NIGHT_BASED, CYCLE or HYBRID property has fixed clock times on the lodge; a
// HOUR_24 property checks out 24 hours after the guest actually arrived, so
// there is no time to promise until they do.
function stayTimes(booking, lodge) {
  const checkIn = formatDate(dateParts(booking.check_in_date));
  const checkOut = formatDate(dateParts(booking.check_out_date));
  if (lodge.checkin_mode === 'HOUR_24') {
    return { checkIn, checkOut: `${checkOut} (24 hrs from check-in)` };
  }
  if (lodge.checkin_mode === 'HYBRID') {
    // An early arrival is out 24 hours after walking in; a later one by the
    // fixed time — so the promise is the fixed time, with the early rule beside it.
    const outAt = formatClock(toClockTime(lodge.check_out_time));
    return {
      checkIn: `${checkIn} ${formatClock(toClockTime(lodge.check_in_time))}`,
      checkOut: `${checkOut} ${outAt} (24 hrs from check-in if you arrive before ${formatClock(toClockTime(lodge.check_in_time))})`,
    };
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

// The same ten values for one room out of a booking whose rooms don't all
// share a date range. `room` is one row from loadBookingRooms (room_number,
// check_in_date, check_out_date, total_price); `booking` only for its
// advance_amount/total_price, used to work out this room's share of the
// one advance payment the guest actually made — there's no per-room advance
// column to read instead. A booking with no price on it yet (total_price 0,
// which priceBooking never actually allows through createBooking but costs
// nothing to guard anyway) splits the advance evenly instead of dividing by
// zero.
function buildPerRoomSample(room, booking, lodge, roomCount) {
  const times = stayTimes(room, lodge);
  const bookingTotal = Number(booking.total_price || 0);
  const bookingAdvance = Number(booking.advance_amount || 0);
  const roomTotal = Number(room.total_price || 0);
  const share = bookingTotal > 0 ? roomTotal / bookingTotal : 1 / roomCount;
  const roomAdvance = round2(bookingAdvance * share);
  return [
    booking.guest_name,
    lodge.name,
    room.room_number,
    times.checkIn,
    times.checkOut,
    money(roomAdvance),
    money(roomTotal),
    money(roomTotal - roomAdvance),
    directionsFor(lodge),
    lodgeContact(lodge),
  ].map(clean);
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
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

// Every active room the booking actually holds, each with its own date range
// and its own price — the detail the booking-level roll-up (loadBooking
// above) deliberately throws away. Ordered by br.id, same as the
// STRING_AGG, so a single-message room_numbers list and this array name
// rooms in the same order.
async function loadBookingRooms(lodgeId, bookingId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT r.room_number, br.check_in_date, br.check_out_date, br.total_price
      FROM dbo.booking_rooms br
      JOIN dbo.rooms r ON r.id = br.room_id
      JOIN dbo.bookings b ON b.id = br.booking_id AND b.lodge_id = @lodgeId
      WHERE br.booking_id = @bookingId AND br.status <> 'CANCELLED'
      ORDER BY br.id
    `);
  return result.recordset;
}

// Whether every room actually shares one date range — the only condition
// under which a single {{4}}/{{5}} pair can honestly speak for all of them.
// Compared as plain ISO date strings rather than Date objects. so two rows
// naming the same calendar day always compare equal regardless of which
// shape mssql happened to hand either one back as.
function sameDatesAcrossRooms(rooms) {
  if (rooms.length <= 1) return true;
  const first = rooms[0];
  const firstIn = toIsoDate(first.check_in_date);
  const firstOut = toIsoDate(first.check_out_date);
  return rooms.every((r) => toIsoDate(r.check_in_date) === firstIn && toIsoDate(r.check_out_date) === firstOut);
}

function toIsoDate(value) {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
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
//
// One message if every room shares a date range — the ordinary case, and
// the only shape this ever had before rooms could disagree on dates.
// Otherwise one message per room, each naming just that room and its own
// check-in/check-out, since a single {{4}}/{{5}} pair can't honestly speak
// for rooms on different dates. Returns { status: 'sent', rooms: [...] } for
// the split case rather than the single { status, campaignId } shape, so a
// caller can tell at a glance which happened.
async function notifyStayBooked(lodgeId, bookingId) {
  if (!whatsapp.isBookingTemplateConfigured()) return skipped('not configured');
  try {
    const [booking, lodge, rooms] = await Promise.all([
      loadBooking(lodgeId, bookingId),
      loadLodge(lodgeId),
      loadBookingRooms(lodgeId, bookingId),
    ]);
    if (!booking || !lodge) return skipped('booking or lodge not found');
    if (rooms.length === 0) return skipped('no active rooms on this booking');

    if (sameDatesAcrossRooms(rooms)) {
      return await deliver({
        kind: 'stay',
        id: bookingId,
        lodgeId,
        phone: booking.guest_phone,
        sample: buildStaySample(booking, lodge),
      });
    }

    const outcomes = [];
    for (const room of rooms) {
      const outcome = await deliver({
        kind: 'stay-room',
        id: `${bookingId}/${room.room_number}`,
        lodgeId,
        phone: booking.guest_phone,
        sample: buildPerRoomSample(room, booking, lodge, rooms.length),
      });
      outcomes.push({ roomNumber: room.room_number, ...outcome });
    }
    return { status: 'sent', rooms: outcomes };
  } catch (err) {
    logger.warn({ kind: 'stay', id: bookingId, lodgeId, err }, 'Booking confirmation could not be prepared');
    return { status: 'failed', error: err.message };
  }
}

module.exports = {
  notifyStayBooked,
  buildStaySample,
  buildPerRoomSample,
  sameDatesAcrossRooms,
  directionsFor,
  clean,
};
