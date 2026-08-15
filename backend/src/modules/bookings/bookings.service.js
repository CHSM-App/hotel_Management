const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const { UPLOAD_DIR } = require('../../middleware/idProofUpload');
const pricingService = require('../pricing/pricing.service');
const billingService = require('../billing/billing.service');
const draftsService = require('./drafts.service');
const lateCheckout = require('./lateCheckout');

function round2(n) {
  return Math.round(n * 100) / 100;
}

// The PIN a guest types to order food from their room's QR. Four digits is
// what fits on a check-in slip and gets typed correctly on a phone; it isn't a
// password, and it doesn't need to be — it's only accepted for the one room it
// was issued for, and only while that stay is checked in. randomInt is used
// rather than Math.random so a guest can't predict the next room's PIN.
function newFoodPin() {
  return String(crypto.randomInt(1000, 10000));
}

function toIsoDate(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

// Every lodge on this system is in India — check-in eligibility has to go
// by the IST calendar date, not the server's UTC date. UTC lags IST by up
// to 5.5 hours, so a plain toISOString() would still show "yesterday" for
// the first few hours of an IST day and wrongly block same-day check-in.
function todayIsoIST() {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// check_out_date is exclusive — the stay covers every date up to, not
// including, checkout day, matching the pricing simulator's per-date lookup.
function datesInRange(checkInDate, checkOutDate) {
  const dates = [];
  const cur = new Date(`${checkInDate}T00:00:00Z`);
  const end = new Date(`${checkOutDate}T00:00:00Z`);
  while (cur < end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

const CONCESSION_LABEL = 'Concession';

// A concession is agreed once, on the whole stay, once every extra is on it —
// so it lands here rather than inside the per-night pricing. It is then spread
// back across the nights in proportion to what each one cost, because
// everything downstream reads the per-night snapshot: the bill bands GST on
// each night's own rate, and GST is charged on what the guest was actually
// asked to pay, so a night conceded down to ₹900 must be taxed as a ₹900
// night. Rounding drift goes on the last night, so the nights still sum to the
// stay total to the paisa.
function spreadConcession(nights, grossTotal, discount) {
  const plain = nights.map((night) => ({ date: night.date, total: night.total, lines: night.lines }));
  if (discount <= 0 || grossTotal <= 0) return plain;

  let remaining = discount;
  return plain.map((night, index) => {
    const share = index === plain.length - 1 ? remaining : round2((discount * night.total) / grossTotal);
    remaining = round2(remaining - share);
    return {
      date: night.date,
      lines: [...night.lines, { label: CONCESSION_LABEL, amount: -share }],
      total: round2(night.total - share),
    };
  });
}

// The stay is priced by the same code the price simulator runs, so the demo
// price a guest was quoted is provably the price the booking charges.
// basePriceOverride is the rate a stay was booked at before concessions
// replaced it — no longer settable, still honoured for the bookings that carry
// one so editing one of them doesn't silently re-price it at rack rate.
//
// The concession is clamped rather than rejected because this also serves the
// live quote, which is read while somebody is still typing into the box: a
// half-entered ₹5,000 against a ₹900 stay should show a free stay, not price
// the nights as a refund. Callers that are actually saving compare what they
// asked for against `discountAmount` to catch the clamp.
async function priceStay(
  lodgeId,
  roomId,
  checkInDate,
  checkOutDate,
  chargeIds = [],
  basePriceOverride = null,
  discountAmount = 0
) {
  const quote = await pricingService.simulateRange(
    lodgeId,
    roomId,
    checkInDate,
    checkOutDate,
    chargeIds,
    basePriceOverride
  );

  const grossTotal = quote.total;
  const requested = Number(discountAmount);
  const discount = round2(
    Math.min(Math.max(Number.isFinite(requested) ? requested : 0, 0), grossTotal)
  );

  return {
    // `lines` rides along with each night so a bill cut weeks later can still
    // say what the rate was made of — base, season, each extra, the concession.
    // Snapshotted for the same reason the totals are: seasons get edited and
    // extras get re-priced, and the bill has to keep showing what was actually
    // charged.
    nights: spreadConcession(quote.nights, grossTotal, discount),
    // What the stay is built from, before the concession. The concession is
    // reported on its own rather than folded in as another line, because it
    // isn't one: the desk needs to see the number it is being taken off.
    charges: quote.lines.map((line) => ({ label: line.label, amount: line.amount })),
    grossTotal,
    discountAmount: discount,
    totalPrice: round2(grossTotal - discount),
  };
}

// An extra can only be charged if the lodge still offers it — a charge that
// was retired since the booking screen loaded must not quietly reappear on a
// bill. The count is the desk's business, not this check's.
async function assertChargesAvailable(pool, lodgeId, selections) {
  if (selections.length === 0) return;
  const capableResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query('SELECT id FROM dbo.switchable_charges WHERE lodge_id = @lodgeId AND is_active = 1');
  const capableIds = new Set(capableResult.recordset.map((r) => Number(r.id)));
  if (!selections.every((selection) => capableIds.has(selection.id))) {
    throw new ApiError('One or more extras are not available.', 400);
  }
}

// Extras are replaced wholesale rather than diffed — the desk's list is the
// answer, and a quantity change is otherwise an update-or-insert per row.
async function replaceBookingCharges(transaction, bookingId, selections) {
  await new sql.Request(transaction)
    .input('bookingId', sql.BigInt, bookingId)
    .query('DELETE FROM dbo.booking_switchable_charges WHERE booking_id = @bookingId');

  for (const selection of selections) {
    await new sql.Request(transaction)
      .input('bookingId', sql.BigInt, bookingId)
      .input('chargeId', sql.BigInt, selection.id)
      .input('quantity', sql.Int, selection.quantity)
      .query(`
        INSERT INTO dbo.booking_switchable_charges (booking_id, charge_id, quantity)
        VALUES (@bookingId, @chargeId, @quantity)
      `);
  }
}

// excludeBookingId lets an edit to a booking's own room/dates check against
// every OTHER booking without the row conflicting with itself.
async function hasOverlap(makeRequest, roomId, checkInDate, checkOutDate, excludeBookingId) {
  const request = makeRequest()
    .input('roomId', sql.BigInt, roomId)
    .input('checkInDate', sql.Date, checkInDate)
    .input('checkOutDate', sql.Date, checkOutDate);
  let excludeClause = '';
  if (excludeBookingId) {
    request.input('excludeBookingId', sql.BigInt, excludeBookingId);
    excludeClause = 'AND id <> @excludeBookingId';
  }
  const result = await request.query(`
    SELECT TOP 1 id FROM dbo.bookings
    WHERE room_id = @roomId AND status IN ('BOOKED', 'CHECKED_IN')
      AND check_in_date < @checkOutDate AND check_out_date > @checkInDate
      ${excludeClause}
  `);
  return result.recordset.length > 0;
}

async function getActiveSwitchableCharges(pool, lodgeId) {
  const chargesResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT id, name, charge_per_night, is_counter
      FROM dbo.switchable_charges
      WHERE lodge_id = @lodgeId AND is_active = 1
      ORDER BY name ASC
    `);

  return chargesResult.recordset.map((row) => ({
    id: row.id,
    name: row.name,
    chargePerNight: Number(row.charge_per_night),
    // Extras that come in counts (extra beds) get a "how many" box on the
    // booking form; the rest are a plain tick and always count 1.
    isCounter: !!row.is_counter,
  }));
}

// The stays standing in the way, for a window and optionally ignoring one
// booking's own occupancy. The availability queries answer "which rooms are
// free"; this answers "and what is holding the rest", so a form that has just
// lost the room the user picked can say which dates took it rather than
// silently emptying the picker.
//
// Same overlap rule as the queries above, deliberately: a room is held from
// check-in up to but not including check-out, so a stay ending on the 18th
// does not block one starting on the 18th.
async function listRoomConflicts(pool, lodgeId, checkInDate, checkOutDate, excludeBookingId = null) {
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('checkInDate', sql.Date, checkInDate)
    .input('checkOutDate', sql.Date, checkOutDate)
    .input('excludeBookingId', sql.BigInt, excludeBookingId)
    .query(`
      SELECT b.room_id, b.check_in_date, b.check_out_date
      FROM dbo.bookings b
      JOIN dbo.rooms r ON r.id = b.room_id
      WHERE r.lodge_id = @lodgeId AND r.is_active = 1
        AND b.status IN ('BOOKED', 'CHECKED_IN')
        AND (@excludeBookingId IS NULL OR b.id <> @excludeBookingId)
        AND b.check_in_date < @checkOutDate AND b.check_out_date > @checkInDate
      ORDER BY b.room_id, b.check_in_date ASC
    `);

  // Guest names are deliberately not returned. Naming who holds the room is a
  // detail the picker never shows, and this endpoint feeds a dropdown.
  return result.recordset.map((row) => ({
    roomId: row.room_id,
    checkInDate: toIsoDate(row.check_in_date),
    checkOutDate: toIsoDate(row.check_out_date),
  }));
}

async function listAvailableRooms(lodgeId, checkInDate, checkOutDate) {
  const pool = await getPool();

  const roomsResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('checkInDate', sql.Date, checkInDate)
    .input('checkOutDate', sql.Date, checkOutDate)
    .query(`
      SELECT r.id, r.room_number, r.floor, r.bed_size, r.bathroom_type, r.max_occupancy, r.description,
             c.name AS category_name, c.base_price AS category_base_price
      FROM dbo.rooms r
      JOIN dbo.room_categories c ON c.id = r.category_id
      WHERE r.lodge_id = @lodgeId AND r.is_active = 1
        AND NOT EXISTS (
          SELECT 1 FROM dbo.bookings b
          WHERE b.room_id = r.id AND b.status IN ('BOOKED', 'CHECKED_IN')
            AND b.check_in_date < @checkOutDate AND b.check_out_date > @checkInDate
        )
      ORDER BY r.room_number ASC
    `);

  const switchableCharges = await getActiveSwitchableCharges(pool, lodgeId);
  const conflicts = await listRoomConflicts(pool, lodgeId, checkInDate, checkOutDate);

  return {
    rooms: roomsResult.recordset.map((row) => ({
      id: row.id,
      roomNumber: row.room_number,
      floor: row.floor,
      bedSize: row.bed_size,
      bathroomType: row.bathroom_type,
      maxOccupancy: row.max_occupancy,
      description: row.description,
      categoryName: row.category_name,
      categoryBasePrice: Number(row.category_base_price),
      switchableCharges,
    })),
    conflicts,
  };
}

// Rooms a booking could move into for an edited check-out date — same
// overlap rule as listAvailableRooms, but excludes the booking's own
// occupancy so its current room still shows up as a valid choice (it isn't
// "conflicting with itself").
async function listAvailableRoomsForBooking(lodgeId, bookingId, checkOutDate) {
  const pool = await getPool();

  const bookingResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .query('SELECT check_in_date FROM dbo.bookings WHERE id = @bookingId AND lodge_id = @lodgeId');
  const bookingRow = bookingResult.recordset[0];
  if (!bookingRow) {
    throw new ApiError('Booking not found.', 404);
  }
  const checkInDate = toIsoDate(bookingRow.check_in_date);

  const roomsResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .input('checkInDate', sql.Date, checkInDate)
    .input('checkOutDate', sql.Date, checkOutDate)
    .query(`
      SELECT r.id, r.room_number, r.floor, r.bed_size, r.bathroom_type, r.max_occupancy, r.description,
             c.name AS category_name, c.base_price AS category_base_price
      FROM dbo.rooms r
      JOIN dbo.room_categories c ON c.id = r.category_id
      WHERE r.lodge_id = @lodgeId AND r.is_active = 1
        AND NOT EXISTS (
          SELECT 1 FROM dbo.bookings b
          WHERE b.room_id = r.id AND b.id <> @bookingId AND b.status IN ('BOOKED', 'CHECKED_IN')
            AND b.check_in_date < @checkOutDate AND b.check_out_date > @checkInDate
        )
      ORDER BY r.room_number ASC
    `);

  // Same shape listAvailableRooms returns, extras included — the booking form
  // is one form whether it is taking a stay or correcting one, and a room that
  // arrived without its extras would render an empty picker on the edit pass.
  const switchableCharges = await getActiveSwitchableCharges(pool, lodgeId);
  // Excluding this booking's own stay, exactly as the room query does — its own
  // nights are not a clash with itself.
  const conflicts = await listRoomConflicts(pool, lodgeId, checkInDate, checkOutDate, bookingId);

  return {
    checkInDate,
    rooms: roomsResult.recordset.map((row) => ({
      id: row.id,
      roomNumber: row.room_number,
      floor: row.floor,
      bedSize: row.bed_size,
      bathroomType: row.bathroom_type,
      maxOccupancy: row.max_occupancy,
      description: row.description,
      categoryName: row.category_name,
      categoryBasePrice: Number(row.category_base_price),
      switchableCharges,
    })),
    conflicts,
  };
}

// Guest & ID register — every booking whose stay overlaps the given date
// range, across every status. Same overlap convention as the tape chart and
// hasOverlap(), so "who was here on this date" reads consistently everywhere.
async function listBookings(lodgeId, { fromDate, toDate } = {}) {
  const pool = await getPool();
  const request = pool.request().input('lodgeId', sql.BigInt, lodgeId);

  let dateFilter = '';
  if (fromDate && toDate) {
    request.input('fromDate', sql.Date, fromDate).input('toDate', sql.Date, toDate);
    dateFilter = 'AND b.check_in_date <= @toDate AND b.check_out_date > @fromDate';
  }

  const result = await request.query(`
    SELECT b.id, b.guest_name, b.guest_phone, b.num_guests, b.id_proof_type, b.id_proof_document,
           b.check_in_date, b.check_out_date, b.status, b.total_price,
           b.actual_check_in_at, b.actual_check_out_at,
           r.room_number, c.name AS category_name,
           (SELECT STRING_AGG(bv.vehicle_number, ', ') FROM dbo.booking_vehicles bv WHERE bv.booking_id = b.id)
             AS vehicle_numbers,
           i.invoice_number, i.total_amount AS invoice_total_amount
    FROM dbo.bookings b
    JOIN dbo.rooms r ON r.id = b.room_id
    JOIN dbo.room_categories c ON c.id = r.category_id
    OUTER APPLY (
      SELECT TOP 1 invoice_number, total_amount FROM dbo.invoices
      WHERE booking_id = b.id AND status = 'ISSUED'
      ORDER BY created_at DESC
    ) i
    WHERE b.lodge_id = @lodgeId ${dateFilter}
    ORDER BY b.check_in_date DESC, b.id DESC
  `);

  return result.recordset.map((row) => ({
    id: row.id,
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    numGuests: row.num_guests,
    idProofType: row.id_proof_type,
    hasIdProofDocument: !!row.id_proof_document,
    vehicleNumbers: row.vehicle_numbers ? row.vehicle_numbers.split(', ') : [],
    roomNumber: row.room_number,
    categoryName: row.category_name,
    checkInDate: toIsoDate(row.check_in_date),
    checkOutDate: toIsoDate(row.check_out_date),
    actualCheckInAt: row.actual_check_in_at,
    actualCheckOutAt: row.actual_check_out_at,
    status: row.status,
    totalPrice: Number(row.total_price),
    invoiceNumber: row.invoice_number,
    billAmount: row.invoice_total_amount != null ? Number(row.invoice_total_amount) : Number(row.total_price),
  }));
}

// Completed stays are on the chart alongside live ones so a month that has
// already happened reads as what happened, not as a month of empty rooms.
// CANCELLED is left off: it held nothing, and drawing it would report a room
// as taken on a night it was always on sale.
//
// A checked-out stay never blocks a night, though — hasOverlap() and the room
// pickers both ignore CHECKED_OUT — so the chart only paints its nights that
// have already passed. Otherwise a guest who left early would leave their
// remaining nights looking sold on a chart while the room picker sells them.
async function getTapeChart(lodgeId, startDate, endDate) {
  const pool = await getPool();

  const roomsResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT r.id, r.room_number, r.floor, c.name AS category_name
      FROM dbo.rooms r
      JOIN dbo.room_categories c ON c.id = r.category_id
      WHERE r.lodge_id = @lodgeId AND r.is_active = 1
      ORDER BY r.room_number ASC
    `);

  const bookingsResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('startDate', sql.Date, startDate)
    .input('endDate', sql.Date, endDate)
    .query(`
      SELECT id, room_id, guest_name, guest_phone, check_in_date, check_out_date, status, total_price
      FROM dbo.bookings
      WHERE lodge_id = @lodgeId AND status IN ('BOOKED', 'CHECKED_IN', 'CHECKED_OUT')
        AND check_in_date < @endDate AND check_out_date > @startDate
      ORDER BY check_in_date ASC
    `);

  // Kept apart from `bookings` rather than merged with a flag: a draft holds
  // no room and can sit on top of a real booking for the same nights, so the
  // chart has to be able to draw it as a mark on the tile rather than as the
  // tile. Anything that treats them as one list would eventually let a draft
  // stand in for a stay.
  const drafts = await draftsService.listDraftsForRange(pool, lodgeId, startDate, endDate);

  return {
    rooms: roomsResult.recordset.map((r) => ({
      id: r.id,
      roomNumber: r.room_number,
      floor: r.floor,
      categoryName: r.category_name,
    })),
    drafts,
    bookings: bookingsResult.recordset.map((b) => ({
      id: b.id,
      roomId: b.room_id,
      guestName: b.guest_name,
      guestPhone: b.guest_phone,
      checkInDate: toIsoDate(b.check_in_date),
      checkOutDate: toIsoDate(b.check_out_date),
      status: b.status,
      totalPrice: Number(b.total_price),
    })),
  };
}

// What each night of the stay cost, read from the snapshot frozen at booking
// time. A stay spanning a season change is not one nightly rate repeated, and
// the register is where that gets explained to a guest asking why their four
// nights weren't four times the first one. Falls back to an even split for
// bookings made before the column existed — the same fallback billing uses.
function nightlyLines(row) {
  const dates = datesInRange(toIsoDate(row.check_in_date), toIsoDate(row.check_out_date));
  if (row.nightly_breakdown) {
    try {
      return JSON.parse(row.nightly_breakdown).map((n) => ({ date: n.date, amount: Number(n.total) }));
    } catch {
      // A malformed snapshot is not worth failing the whole record over.
    }
  }
  const even = dates.length > 0 ? round2(Number(row.total_price) / dates.length) : 0;
  return dates.map((date) => ({ date, amount: even }));
}

function mapBooking(row, charges = [], guests = [], vehicles = [], extra = {}) {
  return {
    id: row.id,
    roomId: row.room_id,
    roomNumber: row.room_number,
    categoryName: row.category_name,
    // How many the room sleeps, so check-in can say something when the party
    // that turned up outgrows it. Advice, not a limit — the desk decides, and
    // NULL wherever the property never recorded one.
    roomMaxOccupancy: row.max_occupancy ?? null,
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    numGuests: row.num_guests,
    idProofType: row.id_proof_type,
    hasIdProofDocument: !!row.id_proof_document,
    checkInDate: toIsoDate(row.check_in_date),
    checkOutDate: toIsoDate(row.check_out_date),
    // What the stay is charged after the concession, which is the number the
    // guest was quoted and the one every screen shows.
    totalPrice: Number(row.total_price),
    // What reception knocked off the quote; 0 on the stays nobody haggled
    // over, which is most of them. The edit form reads it back to show what
    // was actually agreed.
    discountAmount: Number(row.discount_amount ?? 0),
    // Before the concession — the quote the concession was taken off, kept so
    // the register can show both halves rather than a total nobody can check.
    grossTotalPrice: round2(Number(row.total_price) + Number(row.discount_amount ?? 0)),
    // What the room charge is made of — base rate, season uplift, each extra,
    // the concession — summed across the nights each one applied to, read from
    // the snapshot frozen at booking time. Aggregated by the same code the bill
    // uses, so the stay reads identically on both. Empty for bookings taken
    // before the snapshot existed; the screen falls back to the total alone.
    roomCharges: billingService.roomChargeLines(row),
    // NULL for a stay priced at the category's own rate, which is now every
    // new booking — only stays predating concessions carry a negotiated rate.
    basePriceOverride: row.base_price_override != null ? Number(row.base_price_override) : null,
    status: row.status,
    actualCheckInAt: row.actual_check_in_at,
    actualCheckOutAt: row.actual_check_out_at,
    advanceAmount: row.advance_amount != null ? Number(row.advance_amount) : null,
    advancePaymentMethod: row.advance_payment_method,
    // The UPI/card transaction number, for reconciling the property's
    // settlement statement against what the desk says it took. NULL on cash,
    // which leaves no such trail.
    advanceReference: row.advance_reference ?? null,
    nights: nightlyLines(row),
    lateCheckoutCharge: Number(row.late_checkout_charge ?? 0),
    lateCheckoutMinutes: row.late_checkout_minutes ?? null,
    // chargePerNight is the price of one; quantity is how many the guest took,
    // so the nightly cost of this extra is the two multiplied.
    switchableCharges: charges.map((c) => ({
      id: c.id,
      name: c.name,
      chargePerNight: Number(c.charge_per_night),
      quantity: Number(c.quantity ?? 1),
    })),
    guests: guests.map((g) => ({
      id: g.id,
      name: g.guest_name,
      phone: g.guest_phone,
      idProofType: g.id_proof_type,
      hasIdProofDocument: !!g.id_proof_document,
      isChild: !!g.is_child,
    })),
    // Adults are num_guests minus the children on file, not a count of adult
    // rows: the primary guest has no row here, and a booking made before the
    // party split existed has no rows at all — both still add up this way.
    childCount: guests.filter((g) => g.is_child).length,
    // NULL type means the plate predates the type being asked for — the UI
    // shows the number alone rather than inventing a category for it.
    vehicles: vehicles.map((v) => ({ number: v.vehicle_number, type: v.vehicle_type })),
    // Reception reads this out to the guest at check-in — it is the only way a
    // guest ever learns their PIN, so the booking screen has to show it. NULL
    // once they check out, which is what closes in-room ordering (see checkOut).
    // Withheld where a guest couldn't use one, which also covers the stays
    // that were checked in before this property's food service was turned off:
    // the column may still hold a number, but reading it out to a guest would
    // be reading out a key to a door that no longer exists.
    foodPin: extra.takesRoomOrders === false ? null : row.food_pin ?? null,
    foodOrderingLockedUntil: extra.foodOrderingLockedUntil ?? null,
    // A booking stays editable (extras, for now) right up until its bill is
    // issued — that's the point a guest's stay turns into a fixed, printed
    // number. Voiding an invoice drops this back to false, reopening editing.
    hasIssuedInvoice: !!extra.hasIssuedInvoice,
    // The issued bill in full — line items, tax split, what was collected. The
    // guest register is where a stay is answered for after the fact, and
    // "₹4,720" on its own answers nothing.
    invoice: extra.invoice ?? null,
    availableSwitchableCharges: extra.availableSwitchableCharges || [],
  };
}

// Only the four characters T-SQL treats as special in a LIKE pattern. The
// escape character may not precede anything else — "\^" is not a literal caret,
// it is undefined — so escaping a wider set would break on ordinary names.
const LIKE_SPECIALS = /[%_[\\]/g;

function likeContains(value) {
  return `%${value.replace(LIKE_SPECIALS, (ch) => `\\${ch}`)}%`;
}

// Whether a stored ID-proof filename still resolves to a file. The column and
// the disk can disagree — a document removed by hand, a restored database, a
// half-finished upload — and everything that offers to reuse a guest's ID has
// to ask the disk before it promises anything.
async function idProofExists(filename) {
  if (!filename) return false;
  try {
    await fs.access(path.join(UPLOAD_DIR, path.basename(filename)));
    return true;
  } catch {
    return false;
  }
}

// A name typed into the booking form, answered with "have we had them before?".
// The desk's own reason for asking is that a returning guest shouldn't be made
// to spell out a phone number and hand over an ID card they already handed over
// last time.
//
// Matched anywhere in the name rather than from the start: reception types the
// surname as often as the first name, and one property's guest history is small
// enough that scanning it costs nothing a person would notice.
async function searchGuests(lodgeId, query) {
  const term = String(query ?? '').trim();
  // Two characters is where a suggestion list stops being the whole guest book.
  if (term.length < 2) return [];

  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('q', sql.NVarChar, likeContains(term))
    .query(`
      WITH matches AS (
        SELECT id, guest_name, guest_phone, id_proof_type, id_proof_document, check_in_date
        FROM dbo.bookings
        WHERE lodge_id = @lodgeId
          -- A cancelled booking is not evidence anybody ever stayed, and its
          -- details were never checked against an ID card at a desk.
          AND status <> 'CANCELLED'
          AND guest_name LIKE @q ESCAPE '\\'
      ),
      ranked AS (
        SELECT *,
               -- Their stays, best candidate first: ones carrying an ID
               -- document ahead of ones without, then most recent. Several are
               -- kept rather than just the winner because whether a document is
               -- really there is a question about the disk, which SQL can't
               -- answer — so the choosing finishes in JS below.
               ROW_NUMBER() OVER (
                 PARTITION BY guest_name, guest_phone
                 ORDER BY CASE WHEN id_proof_document IS NULL THEN 1 ELSE 0 END,
                          check_in_date DESC, id DESC
               ) AS rn,
               COUNT(*) OVER (PARTITION BY guest_name, guest_phone) AS stay_count,
               MAX(check_in_date) OVER (PARTITION BY guest_name, guest_phone) AS last_stay
        FROM matches
      ),
      people AS (
        SELECT TOP 8 guest_name, guest_phone, last_stay
        FROM ranked
        WHERE rn = 1
        ORDER BY last_stay DESC
      )
      SELECT r.id, r.guest_name, r.guest_phone, r.id_proof_type, r.id_proof_document,
             r.stay_count, r.last_stay, r.rn
      FROM ranked r
      JOIN people p ON p.guest_name = r.guest_name AND p.guest_phone = r.guest_phone
      -- Five deep: enough that one guest's tidied-up old document doesn't cost
      -- them the feature, bounded so a regular with fifty stays doesn't have
      -- all fifty checked against the disk on every keystroke.
      WHERE r.rn <= 5
      ORDER BY p.last_stay DESC, r.guest_name, r.guest_phone, r.rn
    `);

  // The query returns several stays per guest, best candidate first. One
  // suggestion is built from each guest's run of them: the first stay whose
  // document is actually on disk wins, and if none is, the guest is still
  // suggested — just without a document to carry.
  //
  // Checking the disk is the whole point. A row can name a file that is no
  // longer there, and a suggestion that promises a document the save then
  // can't produce sends reception back to the upload box *after* they have
  // filled the form in. Better the badge never appears and the card is asked
  // for up front.
  const byPerson = new Map();
  for (const row of result.recordset) {
    const key = `${row.guest_name} ${row.guest_phone}`;
    if (!byPerson.has(key)) byPerson.set(key, []);
    byPerson.get(key).push(row);
  }

  const suggestions = [];
  for (const stays of byPerson.values()) {
    let chosen = stays[0];
    let hasDocument = false;
    for (const stay of stays) {
      if (await idProofExists(stay.id_proof_document)) {
        chosen = stay;
        hasDocument = true;
        break;
      }
    }
    suggestions.push({
      // The stay this suggestion was read off — quoted back on save as the
      // booking to copy the ID document from.
      bookingId: chosen.id,
      name: chosen.guest_name,
      phone: chosen.guest_phone,
      // Read off the stay whose document is being offered, so the type named
      // in the form is the type of the card that will actually be attached.
      idProofType: hasDocument ? chosen.id_proof_type : stays[0].id_proof_type,
      // The document itself never leaves the server here; the form only needs
      // to know there is one, so it can say so instead of asking again.
      hasIdProofDocument: hasDocument,
      stayCount: chosen.stay_count,
      lastStayDate: toIsoDate(chosen.last_stay),
    });
  }
  return suggestions;
}

// Carries a returning guest's ID document onto the booking being taken now.
//
// The file is copied rather than the filename shared: dbo.bookings owns its
// id_proof_document one-to-one, and two rows pointing at one file would mean
// replacing the document on this year's stay silently rewrote last year's, and
// deleting either one broke the other.
//
// Returns null when there is nothing to copy, which the caller treats the same
// as no document — a suggestion can go stale between being shown and being
// saved, and that is not worth failing a booking over.
async function copyIdProofFromBooking(lodgeId, bookingId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    // Scoped to the lodge: the booking id arrives from the browser, and without
    // this it would read a document out of another property's guest file.
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT id_proof_document FROM dbo.bookings
      WHERE id = @bookingId AND lodge_id = @lodgeId
    `);

  const source = result.recordset[0]?.id_proof_document;
  if (!source) return null;

  // basename, because the stored value is the only thing standing between a
  // crafted id and a copy of an arbitrary file on this disk.
  const from = path.join(UPLOAD_DIR, path.basename(source));
  const copy = `${crypto.randomUUID()}${path.extname(source)}`;
  try {
    await fs.copyFile(from, path.join(UPLOAD_DIR, copy));
  } catch {
    // The row named a file that is no longer on disk. The booking is still a
    // booking; it just goes in without a document, exactly as it would have
    // before this feature existed.
    return null;
  }
  return copy;
}

async function getIdProofFilename(lodgeId, bookingId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .query('SELECT id_proof_document FROM dbo.bookings WHERE id = @bookingId AND lodge_id = @lodgeId');
  const row = result.recordset[0];
  if (!row || !row.id_proof_document) {
    throw new ApiError('No ID proof on file for this booking.', 404);
  }
  return row.id_proof_document;
}

async function getGuestIdProofFilename(lodgeId, bookingId, guestId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .input('guestId', sql.BigInt, guestId)
    .query(`
      SELECT bg.id_proof_document
      FROM dbo.booking_guests bg
      JOIN dbo.bookings b ON b.id = bg.booking_id
      WHERE bg.id = @guestId AND bg.booking_id = @bookingId AND b.lodge_id = @lodgeId
    `);
  const row = result.recordset[0];
  if (!row || !row.id_proof_document) {
    throw new ApiError('No ID proof on file for this guest.', 404);
  }
  return row.id_proof_document;
}

async function getBooking(lodgeId, bookingId) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT b.*, r.room_number, r.max_occupancy, c.name AS category_name,
             l.serves_food, l.food_room_service
      FROM dbo.bookings b
      JOIN dbo.rooms r ON r.id = b.room_id
      JOIN dbo.room_categories c ON c.id = r.category_id
      JOIN dbo.lodges l ON l.id = b.lodge_id
      WHERE b.id = @bookingId AND b.lodge_id = @lodgeId
    `);

  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('Booking not found.', 404);
  }

  const chargesResult = await pool
    .request()
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT sc.id, sc.name, sc.charge_per_night, bsc.quantity
      FROM dbo.booking_switchable_charges bsc
      JOIN dbo.switchable_charges sc ON sc.id = bsc.charge_id
      WHERE bsc.booking_id = @bookingId
    `);

  const guestsResult = await pool
    .request()
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT id, guest_name, guest_phone, id_proof_type, id_proof_document, is_child
      FROM dbo.booking_guests
      WHERE booking_id = @bookingId
      ORDER BY id ASC
    `);

  const vehiclesResult = await pool
    .request()
    .input('bookingId', sql.BigInt, bookingId)
    .query(
      'SELECT vehicle_number, vehicle_type FROM dbo.booking_vehicles WHERE booking_id = @bookingId ORDER BY id ASC'
    );

  const invoiceResult = await pool
    .request()
    .input('bookingId', sql.BigInt, bookingId)
    .query("SELECT TOP 1 id FROM dbo.invoices WHERE booking_id = @bookingId AND status = 'ISSUED'");

  // Loaded through the billing service rather than re-queried here, so the
  // register shows the same document the bills screen and the printed invoice
  // do — one mapping, one set of rounding rules.
  const invoice = invoiceResult.recordset[0]
    ? await billingService.getInvoice(lodgeId, Number(invoiceResult.recordset[0].id))
    : null;

  // Whether this room has locked itself out of food ordering by failing the
  // PIN too many times. Reception is who the guest complains to, so it belongs
  // on the booking they're already looking at. Keyed on the room number
  // because that's what the guest typed — see dbo.food_pin_lockouts.
  // Skipped entirely where nobody can order to a room — there is no PIN to
  // fail, so no lockout to look for, and the register shouldn't pay a query
  // for the answer "no".
  const takesRoomOrders = !!row.serves_food && !!row.food_room_service;
  const lockoutResult = takesRoomOrders
    ? await pool
        .request()
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('roomLabel', sql.NVarChar, row.room_number)
        .query(`
          SELECT locked_until FROM dbo.food_pin_lockouts
          WHERE lodge_id = @lodgeId AND room_label = @roomLabel
            AND locked_until IS NOT NULL AND locked_until > SYSDATETIMEOFFSET()
        `)
    : { recordset: [] };

  const availableSwitchableCharges = await getActiveSwitchableCharges(pool, lodgeId);

  return mapBooking(row, chargesResult.recordset, guestsResult.recordset, vehiclesResult.recordset, {
    takesRoomOrders,
    hasIssuedInvoice: invoiceResult.recordset.length > 0,
    invoice,
    availableSwitchableCharges,
    foodOrderingLockedUntil: lockoutResult.recordset[0]?.locked_until ?? null,
  });
}

async function createBooking(lodgeId, userId, input) {
  const pool = await getPool();

  const roomResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roomId', sql.BigInt, input.roomId)
    .query('SELECT id FROM dbo.rooms WHERE id = @roomId AND lodge_id = @lodgeId AND is_active = 1');
  if (roomResult.recordset.length === 0) {
    throw new ApiError('Choose a valid room.', 400);
  }

  const switchableCharges = pricingService.normalizeSelections(input.switchableCharges);
  await assertChargesAvailable(pool, lodgeId, switchableCharges);

  if (await hasOverlap(() => pool.request(), input.roomId, input.checkInDate, input.checkOutDate)) {
    throw new ApiError('This room is already booked for part of that date range.', 409);
  }

  const requestedDiscount = input.discountAmount ?? 0;

  const { nights, totalPrice, discountAmount, grossTotal } = await priceStay(
    lodgeId,
    input.roomId,
    input.checkInDate,
    input.checkOutDate,
    switchableCharges,
    null,
    requestedDiscount
  );

  // priceStay clamps for the sake of the live quote; a save is a decision, so
  // a concession bigger than the stay is an error rather than a silent haircut
  // reception never sees.
  if (round2(requestedDiscount) > discountAmount) {
    throw new ApiError(`The concession can’t be more than the stay total of ₹${grossTotal}.`, 400);
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const conflict = await hasOverlap(
      () => new sql.Request(transaction),
      input.roomId,
      input.checkInDate,
      input.checkOutDate
    );
    if (conflict) {
      throw new ApiError('This room is already booked for part of that date range.', 409);
    }

    const insertResult = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('roomId', sql.BigInt, input.roomId)
      .input('guestName', sql.NVarChar, input.guestName)
      .input('guestPhone', sql.NVarChar, input.guestPhone)
      .input('numGuests', sql.Int, input.numGuests)
      .input('idProofType', sql.NVarChar, input.idProofType ?? null)
      .input('idProofDocument', sql.NVarChar, input.idProofDocument ?? null)
      .input('checkInDate', sql.Date, input.checkInDate)
      .input('checkOutDate', sql.Date, input.checkOutDate)
      .input('totalPrice', sql.Decimal(10, 2), totalPrice)
      .input('discountAmount', sql.Decimal(10, 2), discountAmount)
      .input('nightlyBreakdown', sql.NVarChar(sql.MAX), JSON.stringify(nights))
      .input('createdBy', sql.BigInt, userId ?? null)
      .input('advanceAmount', sql.Decimal(10, 2), input.advanceAmount ?? null)
      .input('advancePaymentMethod', sql.NVarChar, input.advancePaymentMethod ?? null)
      .input('advanceReference', sql.NVarChar, input.advanceReference ?? null)
      .query(`
        INSERT INTO dbo.bookings
          (lodge_id, room_id, guest_name, guest_phone, num_guests, id_proof_type, id_proof_document,
           check_in_date, check_out_date, total_price, discount_amount, nightly_breakdown, created_by,
           advance_amount, advance_payment_method, advance_reference)
        OUTPUT inserted.id
        VALUES
          (@lodgeId, @roomId, @guestName, @guestPhone, @numGuests, @idProofType, @idProofDocument,
           @checkInDate, @checkOutDate, @totalPrice, @discountAmount, @nightlyBreakdown, @createdBy,
           @advanceAmount, @advancePaymentMethod, @advanceReference)
      `);

    const bookingId = insertResult.recordset[0].id;

    await replaceBookingCharges(transaction, bookingId, switchableCharges);

    await insertGuestsAndVehicles(transaction, bookingId, input.guests, input.vehicles);

    await transaction.commit();
    return { id: bookingId };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

// Shared by createBooking and checkIn — a booking's extra occupants and
// vehicles can be added at either point (or both: a few now, the rest once
// the guest actually arrives with a vehicle).
async function insertGuestsAndVehicles(transaction, bookingId, guests, vehicles) {
  for (const guest of guests) {
    await new sql.Request(transaction)
      .input('bookingId', sql.BigInt, bookingId)
      .input('guestName', sql.NVarChar, guest.name)
      .input('guestPhone', sql.NVarChar, guest.phone)
      .input('idProofType', sql.NVarChar, guest.idProofType)
      .input('idProofDocument', sql.NVarChar, guest.idProofDocument)
      .input('isChild', sql.Bit, guest.isChild ? 1 : 0)
      .query(`
        INSERT INTO dbo.booking_guests (booking_id, guest_name, guest_phone, id_proof_type, id_proof_document, is_child)
        VALUES (@bookingId, @guestName, @guestPhone, @idProofType, @idProofDocument, @isChild)
      `);
  }

  for (const vehicle of vehicles) {
    await new sql.Request(transaction)
      .input('bookingId', sql.BigInt, bookingId)
      .input('vehicleNumber', sql.NVarChar, vehicle.number)
      .input('vehicleType', sql.NVarChar, vehicle.type)
      .query(`
        INSERT INTO dbo.booking_vehicles (booking_id, vehicle_number, vehicle_type)
        VALUES (@bookingId, @vehicleNumber, @vehicleType)
      `);
  }
}

// The party after an edit. Unlike extras and vehicles this can't be a delete
// and re-insert: a guest row owns an uploaded ID proof, and re-creating the
// row would strand the document and lose the link to it. So rows that came
// back with an id are updated in place, rows without one are new, and rows
// that didn't come back at all were removed from the party.
//
// A guest's ID proof is only ever replaced, never cleared — the same rule the
// primary guest's follows. Removing the guest is how you get rid of it.
async function replaceBookingGuests(transaction, bookingId, guests, existingGuests) {
  const existingIds = new Set(existingGuests.map((g) => Number(g.id)));
  const keptIds = new Set();

  for (const guest of guests) {
    const id = Number(guest.id);
    if (guest.id != null && existingIds.has(id)) {
      keptIds.add(id);
      await new sql.Request(transaction)
        .input('id', sql.BigInt, id)
        .input('bookingId', sql.BigInt, bookingId)
        .input('guestName', sql.NVarChar, guest.name)
        .input('guestPhone', sql.NVarChar, guest.phone)
        .input('idProofType', sql.NVarChar, guest.idProofType)
        .input('idProofDocument', sql.NVarChar, guest.idProofDocument)
        .input('isChild', sql.Bit, guest.isChild ? 1 : 0)
        .query(`
          UPDATE dbo.booking_guests
          SET guest_name = @guestName, guest_phone = @guestPhone,
              id_proof_type = COALESCE(@idProofType, id_proof_type),
              id_proof_document = COALESCE(@idProofDocument, id_proof_document),
              is_child = @isChild
          WHERE id = @id AND booking_id = @bookingId
        `);
      continue;
    }

    await new sql.Request(transaction)
      .input('bookingId', sql.BigInt, bookingId)
      .input('guestName', sql.NVarChar, guest.name)
      .input('guestPhone', sql.NVarChar, guest.phone)
      .input('idProofType', sql.NVarChar, guest.idProofType)
      .input('idProofDocument', sql.NVarChar, guest.idProofDocument)
      .input('isChild', sql.Bit, guest.isChild ? 1 : 0)
      .query(`
        INSERT INTO dbo.booking_guests (booking_id, guest_name, guest_phone, id_proof_type, id_proof_document, is_child)
        VALUES (@bookingId, @guestName, @guestPhone, @idProofType, @idProofDocument, @isChild)
      `);
  }

  const removed = existingGuests.filter((g) => !keptIds.has(Number(g.id)));
  for (const guest of removed) {
    await new sql.Request(transaction)
      .input('id', sql.BigInt, guest.id)
      .input('bookingId', sql.BigInt, bookingId)
      .query('DELETE FROM dbo.booking_guests WHERE id = @id AND booking_id = @bookingId');
  }
}

// Vehicles carry no uploads and nothing references them, so the desk's list is
// simply the answer — the same wholesale replace extras get.
async function replaceBookingVehicles(transaction, bookingId, vehicles) {
  await new sql.Request(transaction)
    .input('bookingId', sql.BigInt, bookingId)
    .query('DELETE FROM dbo.booking_vehicles WHERE booking_id = @bookingId');

  for (const vehicle of vehicles) {
    await new sql.Request(transaction)
      .input('bookingId', sql.BigInt, bookingId)
      .input('vehicleNumber', sql.NVarChar, vehicle.number)
      .input('vehicleType', sql.NVarChar, vehicle.type)
      .query(`
        INSERT INTO dbo.booking_vehicles (booking_id, vehicle_number, vehicle_type)
        VALUES (@bookingId, @vehicleNumber, @vehicleType)
      `);
  }
}

async function checkIn(lodgeId, bookingId, input) {
  const pool = await getPool();

  const bookingResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT b.num_guests, b.id_proof_type, b.check_in_date,
             l.serves_food, l.food_room_service
      FROM dbo.bookings b
      JOIN dbo.lodges l ON l.id = b.lodge_id
      WHERE b.id = @bookingId AND b.lodge_id = @lodgeId AND b.status = 'BOOKED'
    `);
  const bookingRow = bookingResult.recordset[0];
  if (!bookingRow) {
    throw new ApiError('Booking not found or not ready for check-in.', 409);
  }

  // A pre-reservation holds the room for a future date — it can't be
  // checked in early, only from its reserved date onward. A walk-in is
  // always booked for today, so this never blocks the common case.
  if (toIsoDate(bookingRow.check_in_date) > todayIsoIST()) {
    throw new ApiError('This booking is for a future date — check-in opens on the reserved date.', 409);
  }

  // A walk-in booking already has its ID proof on file; a pre-reservation
  // doesn't, so check-in is where it becomes mandatory — a guest can't
  // actually be checked in without one on record.
  if (!bookingRow.id_proof_type && !input.idProofType) {
    throw new ApiError('Upload the guest’s ID proof before check-in.', 400);
  }

  // Who actually turned up, counting the primary guest. Check-in used to
  // reject a party larger than the one booked, which is backwards: a
  // reservation for two arriving as three is an ordinary evening at a desk,
  // and the register is meant to record who slept in the room. So the booked
  // count gives way to the counted one — never downward, since a party that
  // arrives short has still paid for the room it booked, and num_guests is
  // what the stay was sold as.
  //
  // Safe to move: num_guests is a record of the party, not an input to
  // anything priced. Nothing in pricing reads it, and a room's max_occupancy
  // is advice to the desk rather than a constraint the database enforces.
  let newNumGuests = bookingRow.num_guests;
  if (input.guests.length > 0) {
    const existingGuestsResult = await pool
      .request()
      .input('bookingId', sql.BigInt, bookingId)
      .query('SELECT COUNT(*) AS count FROM dbo.booking_guests WHERE booking_id = @bookingId');
    const existingCount = existingGuestsResult.recordset[0].count;
    newNumGuests = Math.max(bookingRow.num_guests, existingCount + input.guests.length + 1);
  }

  const takesRoomOrders = !!bookingRow.serves_food && !!bookingRow.food_room_service;

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('bookingId', sql.BigInt, bookingId)
      .input('advanceAmount', sql.Decimal(10, 2), input.advanceAmount ?? null)
      .input('advancePaymentMethod', sql.NVarChar, input.advancePaymentMethod ?? null)
      .input('advanceReference', sql.NVarChar, input.advanceReference ?? null)
      .input('idProofType', sql.NVarChar, input.idProofType ?? null)
      .input('idProofDocument', sql.NVarChar, input.idProofDocument ?? null)
      .input('numGuests', sql.Int, newNumGuests)
      // Only where a guest could actually use one. A rooms-only property has
      // no kitchen and no QR to scan, so a PIN there is a number reception
      // reads out for nothing — and one more secret sitting in the database.
      .input('foodPin', sql.NVarChar, takesRoomOrders ? newFoodPin() : null)
      .query(`
        UPDATE dbo.bookings
        SET status = 'CHECKED_IN', actual_check_in_at = SYSDATETIMEOFFSET(),
            food_pin = @foodPin,
            num_guests = @numGuests,
            advance_amount = CASE
              WHEN @advanceAmount IS NULL THEN advance_amount
              ELSE ISNULL(advance_amount, 0) + @advanceAmount
            END,
            advance_payment_method = COALESCE(@advancePaymentMethod, advance_payment_method),
            advance_reference = COALESCE(@advanceReference, advance_reference),
            id_proof_type = COALESCE(@idProofType, id_proof_type),
            id_proof_document = COALESCE(@idProofDocument, id_proof_document)
        OUTPUT inserted.id
        WHERE id = @bookingId AND lodge_id = @lodgeId AND status = 'BOOKED'
      `);
    if (result.recordset.length === 0) {
      throw new ApiError('Booking not found or not ready for check-in.', 409);
    }

    await insertGuestsAndVehicles(transaction, bookingId, input.guests, input.vehicles);

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  return getBooking(lodgeId, bookingId);
}

// What reception is shown before they check anyone out: when the stay was due
// to end, how far past that it is right now, and what the property's own policy
// says that is worth. The suggestion is advisory — the desk decides.
async function getLateCheckout(lodgeId, bookingId, at = new Date()) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT b.check_in_date, b.check_out_date, b.actual_check_in_at, b.status,
             b.total_price, b.nightly_breakdown, b.late_checkout_charge,
             l.checkin_mode, l.check_out_time, l.late_grace_minutes,
             l.late_half_day_percent, l.late_full_day_after_minutes, l.late_full_day_percent
      FROM dbo.bookings b
      JOIN dbo.lodges l ON l.id = b.lodge_id
      WHERE b.id = @bookingId AND b.lodge_id = @lodgeId
    `);
  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('Booking not found.', 404);
  }

  const checkInDate = toIsoDate(row.check_in_date);
  const checkOutDate = toIsoDate(row.check_out_date);

  const policy = {
    lateGraceMinutes: row.late_grace_minutes,
    lateHalfDayPercent: Number(row.late_half_day_percent),
    lateFullDayAfterMinutes: row.late_full_day_after_minutes,
    lateFullDayPercent: Number(row.late_full_day_percent),
  };

  const deadline = lateCheckout.checkoutDeadline({
    checkinMode: row.checkin_mode,
    // TIME comes back as a Date on the 1970 epoch, so the clock is read off it
    // rather than the value being used as a moment in its own right.
    checkOutTime: toClockTime(row.check_out_time),
    checkInDate,
    checkOutDate,
    actualCheckInAt: row.actual_check_in_at,
  });

  const minutesLate = lateCheckout.overdueMinutes(deadline, at);
  const lastNightRate = lastNightlyRate(row);
  const suggestion = lateCheckout.suggestLateCharge(policy, minutesLate, lastNightRate);

  return {
    bookingId: Number(bookingId),
    status: row.status,
    checkinMode: row.checkin_mode,
    deadline: deadline.toISOString(),
    minutesLate,
    lateLabel: lateCheckout.lateLabel(minutesLate),
    isLate: minutesLate > 0,
    // Past the grace period is what makes it chargeable, which is not the same
    // as being late — twenty minutes over is late and free.
    isChargeable: suggestion.amount > 0,
    lastNightRate,
    suggestedCharge: suggestion.amount,
    band: suggestion.band,
    percent: suggestion.percent,
    policy,
    appliedCharge: Number(row.late_checkout_charge),
  };
}

// The rate the room was going at on its final night. Reads the frozen
// per-night snapshot where there is one, and falls back to an even split of
// total_price for bookings made before that column existed — the same fallback
// the billing service uses, for the same reason.
function lastNightlyRate(row) {
  if (row.nightly_breakdown) {
    const nights = JSON.parse(row.nightly_breakdown);
    if (nights.length > 0) return round2(Number(nights[nights.length - 1].total));
  }
  const nights = lateCheckout.nightsBetween(toIsoDate(row.check_in_date), toIsoDate(row.check_out_date));
  return round2(Number(row.total_price) / nights);
}

function toClockTime(value) {
  if (value == null) return '11:00:00';
  if (typeof value === 'string') return value.slice(0, 8);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`;
}

// lateCharge is whatever reception decided, including 0 for "waived" — it is
// never recomputed from the policy here. The policy only ever produced a
// suggestion, and overriding it is the entire point of asking.
async function checkOut(lodgeId, bookingId, { lateCharge = 0 } = {}) {
  const pool = await getPool();

  // Read before write so the minutes are recorded against the same moment the
  // charge was agreed for, rather than a later one.
  const late = await getLateCheckout(lodgeId, bookingId);

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .input('lateCharge', sql.Decimal(10, 2), round2(Number(lateCharge) || 0))
    .input('lateMinutes', sql.Int, late.minutesLate)
    .query(`
      UPDATE dbo.bookings
      SET status = 'CHECKED_OUT', actual_check_out_at = SYSDATETIMEOFFSET(),
          late_checkout_charge = @lateCharge,
          late_checkout_minutes = @lateMinutes,
          -- Clearing the PIN is what closes in-room ordering. The QR on the
          -- wall stays valid for the *room*; it just stops accepting orders
          -- until the next guest checks in and gets their own PIN.
          food_pin = NULL
      OUTPUT inserted.id
      WHERE id = @bookingId AND lodge_id = @lodgeId AND status = 'CHECKED_IN'
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Booking not found or not checked in.', 409);
  }
  return getBooking(lodgeId, bookingId);
}

// A booking stays editable for its whole life, not just at creation — a
// guest might extend their stay, ask to switch rooms, add someone to the
// party, or the front desk just mistyped a phone number. The only hard
// stop is an issued invoice: once a bill is cut the stay is frozen,
// matching billing's own "already invoiced" guard on issueInvoice. Room
// and check-out date changes are further restricted to BOOKED/CHECKED_IN —
// once a guest has actually checked out there's no "stay" left to move or
// extend, only extras can still be corrected. check-in date is never
// editable here; changing when a stay started is a cancel-and-rebook, not
// an edit.
async function updateBooking(lodgeId, bookingId, input) {
  const pool = await getPool();

  const bookingResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT room_id, check_in_date, check_out_date, status, num_guests, guest_name, guest_phone,
             base_price_override, discount_amount
      FROM dbo.bookings WHERE id = @bookingId AND lodge_id = @lodgeId
    `);
  const bookingRow = bookingResult.recordset[0];
  if (!bookingRow) {
    throw new ApiError('Booking not found.', 404);
  }
  if (bookingRow.status === 'CANCELLED') {
    throw new ApiError('This booking is cancelled and can’t be edited.', 409);
  }

  const invoiceResult = await pool
    .request()
    .input('bookingId', sql.BigInt, bookingId)
    .query("SELECT TOP 1 id FROM dbo.invoices WHERE booking_id = @bookingId AND status = 'ISSUED'");
  if (invoiceResult.recordset.length > 0) {
    throw new ApiError('This booking already has an issued bill. Void it before editing.', 409);
  }

  const checkInDate = toIsoDate(bookingRow.check_in_date);
  const currentCheckOutDate = toIsoDate(bookingRow.check_out_date);
  const changingStayDetails = input.checkOutDate != null || input.roomId != null;

  if (changingStayDetails && bookingRow.status === 'CHECKED_OUT') {
    throw new ApiError('This stay is already checked out — only extras can still be edited.', 409);
  }

  const newRoomId = input.roomId ?? bookingRow.room_id;
  const newCheckOutDate = input.checkOutDate ?? currentCheckOutDate;

  if (newCheckOutDate <= checkInDate) {
    throw new ApiError('Check-out date must be after check-in date.', 400);
  }

  if (newRoomId !== bookingRow.room_id) {
    const roomResult = await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('roomId', sql.BigInt, newRoomId)
      .query('SELECT id FROM dbo.rooms WHERE id = @roomId AND lodge_id = @lodgeId AND is_active = 1');
    if (roomResult.recordset.length === 0) {
      throw new ApiError('Choose a valid room.', 400);
    }
  }

  if (newRoomId !== bookingRow.room_id || newCheckOutDate !== currentCheckOutDate) {
    const conflict = await hasOverlap(() => pool.request(), newRoomId, checkInDate, newCheckOutDate, bookingId);
    if (conflict) {
      throw new ApiError('That room is already booked for part of this date range.', 409);
    }
  }

  // Every guest on file, with the ID proof each already carries — an edit
  // that doesn't re-upload one must not wipe it.
  const existingGuestsResult = await pool
    .request()
    .input('bookingId', sql.BigInt, bookingId)
    .query('SELECT id, id_proof_document FROM dbo.booking_guests WHERE booking_id = @bookingId');
  const existingGuests = existingGuestsResult.recordset;

  // The party as it will stand after this save, which is what the guest count
  // has to accommodate — checked against the list in this request rather than
  // the one on file, since both are changing at once.
  const partySize = (input.guests ? input.guests.length : existingGuests.length) + 1;

  let newNumGuests = bookingRow.num_guests;
  if (input.numGuests != null) {
    if (input.numGuests < partySize) {
      throw new ApiError('Guest count can’t be less than the guests on the booking.', 400);
    }
    newNumGuests = input.numGuests;
  } else if (partySize > newNumGuests) {
    throw new ApiError('Guest details can’t exceed the number of guests.', 400);
  }

  const newGuestName = input.guestName != null ? input.guestName : bookingRow.guest_name;
  const newGuestPhone = input.guestPhone != null ? input.guestPhone : bookingRow.guest_phone;

  let switchableCharges;
  if (input.switchableCharges == null) {
    const currentChargesResult = await pool
      .request()
      .input('bookingId', sql.BigInt, bookingId)
      .query('SELECT charge_id, quantity FROM dbo.booking_switchable_charges WHERE booking_id = @bookingId');
    switchableCharges = currentChargesResult.recordset.map((r) => ({
      id: Number(r.charge_id),
      quantity: Number(r.quantity),
    }));
  } else {
    switchableCharges = pricingService.normalizeSelections(input.switchableCharges);
    await assertChargesAvailable(pool, lodgeId, switchableCharges);
  }

  // Omitted means "keep the concession that was agreed" — an edit that only
  // moves the checkout date must not quietly charge the guest full price
  // again. An explicit 0 is how reception takes a concession back.
  const requestedDiscount =
    input.discountAmount === undefined
      ? Number(bookingRow.discount_amount ?? 0)
      : input.discountAmount;

  // Never settable any more, only carried: a stay booked at a negotiated
  // nightly rate before concessions existed keeps pricing at that rate when
  // its dates or extras are edited.
  const legacyBasePriceOverride =
    bookingRow.base_price_override != null ? Number(bookingRow.base_price_override) : null;

  const { nights, totalPrice, discountAmount, grossTotal } = await priceStay(
    lodgeId,
    newRoomId,
    checkInDate,
    newCheckOutDate,
    switchableCharges,
    legacyBasePriceOverride,
    requestedDiscount
  );

  if (round2(requestedDiscount) > discountAmount) {
    throw new ApiError(`The concession can’t be more than the stay total of ₹${grossTotal}.`, 400);
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await replaceBookingCharges(transaction, bookingId, switchableCharges);

    await new sql.Request(transaction)
      .input('bookingId', sql.BigInt, bookingId)
      .input('roomId', sql.BigInt, newRoomId)
      .input('checkOutDate', sql.Date, newCheckOutDate)
      .input('numGuests', sql.Int, newNumGuests)
      .input('guestName', sql.NVarChar, newGuestName)
      .input('guestPhone', sql.NVarChar, newGuestPhone)
      .input('totalPrice', sql.Decimal(10, 2), totalPrice)
      .input('discountAmount', sql.Decimal(10, 2), discountAmount)
      .input('nightlyBreakdown', sql.NVarChar(sql.MAX), JSON.stringify(nights))
      // The advance is set to what was typed, not added to — an edit corrects
      // the record. Sending nothing leaves it alone; sending null clears it,
      // which is how a deposit keyed against the wrong stay is taken back off.
      .input('setAdvance', sql.Bit, input.advanceAmount !== undefined ? 1 : 0)
      .input('advanceAmount', sql.Decimal(10, 2), input.advanceAmount ?? null)
      .input('advancePaymentMethod', sql.NVarChar, input.advancePaymentMethod ?? null)
      .input('advanceReference', sql.NVarChar, input.advanceReference ?? null)
      // COALESCE, not a flag: an ID proof is only ever replaced, never
      // cleared — a stay that has one on file must not be editable back into
      // one that doesn't.
      .input('idProofType', sql.NVarChar, input.idProofType ?? null)
      .input('idProofDocument', sql.NVarChar, input.idProofDocument ?? null)
      .query(`
        UPDATE dbo.bookings
        SET room_id = @roomId, check_out_date = @checkOutDate, num_guests = @numGuests,
            guest_name = @guestName, guest_phone = @guestPhone,
            total_price = @totalPrice, discount_amount = @discountAmount,
            nightly_breakdown = @nightlyBreakdown,
            advance_amount = CASE WHEN @setAdvance = 1 THEN @advanceAmount ELSE advance_amount END,
            advance_payment_method =
              CASE WHEN @setAdvance = 1 THEN @advancePaymentMethod ELSE advance_payment_method END,
            advance_reference =
              CASE WHEN @setAdvance = 1 THEN @advanceReference ELSE advance_reference END,
            id_proof_type = COALESCE(@idProofType, id_proof_type),
            id_proof_document = COALESCE(@idProofDocument, id_proof_document)
        WHERE id = @bookingId
      `);

    if (input.guests) {
      await replaceBookingGuests(transaction, bookingId, input.guests, existingGuests);
    }

    if (input.vehicles) {
      await replaceBookingVehicles(transaction, bookingId, input.vehicles);
    }

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  return getBooking(lodgeId, bookingId);
}

async function cancelBooking(lodgeId, bookingId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      UPDATE dbo.bookings
      SET status = 'CANCELLED'
      OUTPUT inserted.id
      WHERE id = @bookingId AND lodge_id = @lodgeId AND status = 'BOOKED'
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Booking not found or cannot be cancelled.', 409);
  }
  return getBooking(lodgeId, bookingId);
}

module.exports = {
  priceStay,
  listAvailableRooms,
  listAvailableRoomsForBooking,
  listBookings,
  searchGuests,
  copyIdProofFromBooking,
  getTapeChart,
  getBooking,
  getIdProofFilename,
  getGuestIdProofFilename,
  createBooking,
  checkIn,
  getLateCheckout,
  checkOut,
  updateBooking,
  cancelBooking,
};
