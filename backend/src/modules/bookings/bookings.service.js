const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const { parseBeds } = require('../rooms/rooms.service');
const { UPLOAD_DIR } = require('../../middleware/idProofUpload');
const pricingService = require('../pricing/pricing.service');
const notifications = require('../notifications/bookingConfirmation');
const billingService = require('../billing/billing.service');
const { splitAcross } = require('../reports/reports.service');
const advanceReceiptsService = require('../billing/advanceReceipts.service');
const { logger } = require('../../config/logger');
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
// basePriceOverride is the nightly rate reception agreed for this stay, where
// it is not the category's own. Seasons still apply on top of it, and the
// extras are still added flat after that — it replaces the starting rate, not
// the whole night. NULL means the category price, which is most stays.
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
    // chargeId and quantity ride along on the extras lines, and isBase on the
    // room line, so the booking form can offer either as an editable total. A
    // season line carries neither and stays read-only: it is a percentage of
    // the rate above it, so it follows on its own.
    //
    // isBase is a flag rather than a label match on purpose — the label carries
    // the price, so it changes the moment reception negotiates one.
    charges: quote.lines.map((line) => ({
      label: line.label,
      amount: line.amount,
      isBase: Boolean(line.isBase),
      chargeId: line.chargeId,
      quantity: line.quantity,
    })),
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
      // Snapshotted, not joined live: a later change to the lodge's price must
      // not reprice a stay that has already been billed.
      .input('agreedAmount', sql.Decimal(10, 2), selection.agreedAmount ?? null)
      .query(`
        INSERT INTO dbo.booking_switchable_charges (booking_id, charge_id, quantity, agreed_amount)
        VALUES (@bookingId, @chargeId, @quantity, @agreedAmount)
      `);
  }
}

// An advance is a part-payment of the stay, so it cannot exceed it. Taking
// more is a data-entry slip — a stray zero — and one that would otherwise
// travel a long way before anyone noticed: the receipt would print a negative
// balance due, and the final bill a negative net payment.
//
// It also has to be caught here rather than left to the receipt. The receipt is
// raised automatically now and cannot fail the booking that triggered it, so an
// over-large advance would save quietly and simply leave no receipt behind.
function assertAdvanceWithinTotal(advanceAmount, stayTotal, alreadyHeld = 0) {
  const amount = Number(advanceAmount);
  if (!Number.isFinite(amount) || amount <= 0) return;
  const held = round2(Number(alreadyHeld) || 0);
  if (round2(held + amount) <= round2(Number(stayTotal))) return;
  throw new ApiError(
    held > 0
      ? `That would take the advance past the stay total of ₹${round2(stayTotal)} — ₹${held} is already held.`
      : `An advance can’t be more than the stay total of ₹${round2(stayTotal)}.`,
    400
  );
}

// Money taken at the desk gets its receipt then and there, without anyone
// pressing anything. The desk has already typed the amount, the method and the
// reference into the booking form — which is everything an advance receipt
// needs — so asking for a second, separate "issue" click adds a step and no
// information. (The stay bill is different and keeps its step: what the guest
// hands over at checkout is not known until checkout.)
//
// Deliberately after the booking's own transaction has committed, and
// deliberately unable to fail it. A receipt that cannot be raised — a numbering
// row that will not lock, a slab table mid-edit — must not undo a booking that
// is otherwise good and a guest who is standing at the desk. It is logged and
// the desk can raise it by hand from the stay.
async function autoIssueAdvanceReceipt(lodgeId, userId, bookingId, input) {
  const amount = Number(input.advanceAmount);
  if (!Number.isFinite(amount) || amount <= 0 || !input.advancePaymentMethod) return;
  try {
    await advanceReceiptsService.issueAdvanceReceipt(
      lodgeId,
      userId,
      bookingId,
      {
        amountReceived: amount,
        paymentMethod: input.advancePaymentMethod,
        paymentReference: input.advanceReference ?? undefined,
        // Only on a real split. One line is what issueAdvanceReceipt already
        // synthesises from the method above, so sending it changes nothing
        // except the number of code paths that got here.
        ...(input.advanceLines?.length > 1 ? { paymentLines: input.advanceLines } : {}),
      },
      // The booking row already holds this advance — see the note on the flag.
      { alreadyOnBooking: true }
    );
  } catch (err) {
    logger.error({ err, bookingId, lodgeId }, 'Could not auto-issue the advance receipt');
  }
}

// excludeBookingId lets an edit to a booking's own room/dates check against
// every OTHER booking without the row conflicting with itself.
//
// `lock` takes UPDLOCK + HOLDLOCK over the range this scans, and is what makes
// the answer binding rather than advisory. It only means anything inside an
// explicit transaction — outside one the locks are released as soon as the
// statement ends — so callers using this as a cheap pre-flight leave it off.
//
// Both hints are needed, for different reasons:
//
//   HOLDLOCK holds a *range* lock until the transaction ends, so nothing else
//   can INSERT a booking into the gap this query just found empty. Without it
//   there is a window between deciding a room is free and writing the row, and
//   two clerks can both walk through it.
//
//   UPDLOCK makes that range lock an *update* lock rather than a shared one.
//   Shared range locks are compatible with each other, so both transactions
//   would take one, and then both would need an incompatible insert lock to
//   write — each waiting on the other's read lock. That is a deadlock, and SQL
//   Server resolves it by killing one transaction with error 1205. 1205 is not
//   an ApiError, so it reaches the clerk as a generic 500 rather than "this
//   room is taken". Update range locks are mutually exclusive, so the second
//   transaction waits instead, then re-reads, sees the committed booking, and
//   returns a clean 409.
async function hasOverlap(
  makeRequest,
  roomId,
  checkInDate,
  checkOutDate,
  excludeBookingId,
  { lock = false } = {}
) {
  const request = makeRequest()
    .input('roomId', sql.BigInt, roomId)
    .input('checkInDate', sql.Date, checkInDate)
    .input('checkOutDate', sql.Date, checkOutDate);
  let excludeClause = '';
  if (excludeBookingId) {
    request.input('excludeBookingId', sql.BigInt, excludeBookingId);
    excludeClause = 'AND id <> @excludeBookingId';
  }
  // Fixed strings selected by a boolean, never interpolated input — as far as
  // anything arriving from a request is concerned, this query is a constant.
  const lockHint = lock ? 'WITH (UPDLOCK, HOLDLOCK)' : '';
  const result = await request.query(`
    SELECT TOP 1 id FROM dbo.bookings ${lockHint}
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
      SELECT r.id, r.room_number, r.floor, r.bed_size, r.beds, r.bathroom_type, r.max_occupancy, r.description,
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
      beds: parseBeds(row),
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

// Rooms a booking could move into for an edited date range — same overlap
// rule as listAvailableRooms, but excludes the booking's own occupancy so
// its current room still shows up as a valid choice (it isn't "conflicting
// with itself").
//
// requestedCheckInDate is the date the edit form currently has in its box,
// which is not necessarily the one on file — a reservation being re-dated has
// to be shown the rooms free over the range being *proposed*. Absent means the
// edit isn't moving the arrival, so the stored date stands; a caller that
// hasn't learned about re-dating keeps getting exactly what it got before.
async function listAvailableRoomsForBooking(lodgeId, bookingId, checkOutDate, requestedCheckInDate = null) {
  const pool = await getPool();

  const bookingResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .query('SELECT check_in_date, status FROM dbo.bookings WHERE id = @bookingId AND lodge_id = @lodgeId');
  const bookingRow = bookingResult.recordset[0];
  if (!bookingRow) {
    throw new ApiError('Booking not found.', 404);
  }
  const storedCheckInDate = toIsoDate(bookingRow.check_in_date);
  // The same rule updateBooking enforces on save, applied here so the picker
  // never offers rooms against a range the save would go on to refuse.
  const checkInDate =
    requestedCheckInDate && bookingRow.status === 'BOOKED' ? requestedCheckInDate : storedCheckInDate;
  if (checkOutDate <= checkInDate) {
    throw new ApiError('Check-out date must be after check-in date.', 400);
  }

  const roomsResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .input('checkInDate', sql.Date, checkInDate)
    .input('checkOutDate', sql.Date, checkOutDate)
    .query(`
      SELECT r.id, r.room_number, r.floor, r.bed_size, r.beds, r.bathroom_type, r.max_occupancy, r.description,
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
      beds: parseBeds(row),
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
           b.id_proof_number,
           b.check_in_date, b.check_out_date, b.status, b.total_price,
           b.actual_check_in_at, b.actual_check_out_at,
           r.room_number, c.name AS category_name,
           (SELECT STRING_AGG(bv.vehicle_number, ', ') FROM dbo.booking_vehicles bv WHERE bv.booking_id = b.id)
             AS vehicle_numbers,
           -- The rest of the party. The register's search box has to find a
           -- stay by anyone travelling on it, not only by whoever's name went
           -- on the booking, so the co-guests come down with the row rather
           -- than costing a trip per booking to ask who else is on it.
           -- Aggregated on a control character for the same reason the chart
           -- does it: a name carrying a comma would otherwise arrive as two
           -- people.
           (SELECT STRING_AGG(g.guest_name, CHAR(31)) FROM dbo.booking_guests g
            WHERE g.booking_id = b.id) AS co_guest_names,
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
    idProofNumber: row.id_proof_number ?? null,
    hasIdProofDocument: !!row.id_proof_document,
    vehicleNumbers: row.vehicle_numbers ? row.vehicle_numbers.split(', ') : [],
    coGuestNames: row.co_guest_names ? row.co_guest_names.split('') : [],
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
// CANCELLED is kept out of `bookings`: it holds nothing, and drawing it as a
// stay would report a room as taken on a night it was always on sale. It
// comes back in its own `cancelled` list instead — the chart marks the nights
// it would have held with a border, not a fill, so the desk can see a booking
// fell through there while the night itself still reads as sellable.
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
      SELECT b.id, b.room_id, b.guest_name, b.guest_phone, b.id_proof_number,
             b.check_in_date, b.check_out_date, b.status, b.total_price,
             -- What the chart's search box matches on beyond the primary guest.
             -- Both are aggregated here rather than fetched per booking: the
             -- chart already draws every stay in the window, and a second round
             -- trip per tile to answer "is this the Sharma party?" would cost
             -- far more than two joins do.
             -- Aggregated with a control character rather than a comma or a
             -- pipe: the client splits on this, and a guest whose name or ID
             -- carries the separator would otherwise arrive as two people.
             (SELECT STRING_AGG(g.guest_name, CHAR(31)) FROM dbo.booking_guests g
              WHERE g.booking_id = b.id) AS co_guest_names,
             (SELECT STRING_AGG(g.id_proof_number, CHAR(31)) FROM dbo.booking_guests g
              WHERE g.booking_id = b.id AND g.id_proof_number IS NOT NULL) AS co_guest_id_numbers,
             i.invoice_number
      FROM dbo.bookings b
      -- The issued bill, if the stay has been billed. OUTER APPLY rather than a
      -- join so an unbilled stay still draws — most of the chart is unbilled.
      OUTER APPLY (
        SELECT TOP 1 invoice_number FROM dbo.invoices
        WHERE booking_id = b.id AND status = 'ISSUED'
        ORDER BY created_at DESC
      ) i
      WHERE b.lodge_id = @lodgeId AND b.status IN ('BOOKED', 'CHECKED_IN', 'CHECKED_OUT')
        AND b.check_in_date < @endDate AND b.check_out_date > @startDate
      ORDER BY b.check_in_date ASC
    `);

  // Kept apart from `bookings` rather than merged with a flag: a draft holds
  // no room and can sit on top of a real booking for the same nights, so the
  // chart has to be able to draw it as a mark on the tile rather than as the
  // tile. Anything that treats them as one list would eventually let a draft
  // stand in for a stay.
  const drafts = await draftsService.listDraftsForRange(pool, lodgeId, startDate, endDate);

  // Cancelled stays, apart for the same reason drafts are: they hold no
  // night, and a live booking can sit on the very dates one fell through on.
  // Only what the border mark and its hover card say — the full record is a
  // click away in the register's Cancelled cut.
  const cancelledResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('startDate', sql.Date, startDate)
    .input('endDate', sql.Date, endDate)
    .query(`
      SELECT b.id, b.room_id, b.guest_name, b.check_in_date, b.check_out_date,
             b.cancelled_at, b.refund_amount, b.cancellation_charge
      FROM dbo.bookings b
      WHERE b.lodge_id = @lodgeId AND b.status = 'CANCELLED'
        AND b.check_in_date < @endDate AND b.check_out_date > @startDate
      ORDER BY b.check_in_date ASC
    `);

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
      // The rest of what the stay can be looked up by on the chart. Names, not
      // shown on any tile — the chart deliberately keeps guests off the grid —
      // but searched, so typing a co-guest or a bill number finds the strip
      // that guest is actually on.
      idProofNumber: b.id_proof_number ?? null,
      invoiceNumber: b.invoice_number ?? null,
      coGuestNames: b.co_guest_names ? b.co_guest_names.split('\u001f') : [],
      coGuestIdNumbers: b.co_guest_id_numbers ? b.co_guest_id_numbers.split('\u001f') : [],
      checkInDate: toIsoDate(b.check_in_date),
      checkOutDate: toIsoDate(b.check_out_date),
      status: b.status,
      totalPrice: Number(b.total_price),
    })),
    cancelled: cancelledResult.recordset.map((b) => ({
      id: b.id,
      roomId: b.room_id,
      guestName: b.guest_name,
      checkInDate: toIsoDate(b.check_in_date),
      checkOutDate: toIsoDate(b.check_out_date),
      cancelledAt: b.cancelled_at ?? null,
      refundAmount: b.refund_amount != null ? Number(b.refund_amount) : null,
      cancellationCharge: b.cancellation_charge != null ? Number(b.cancellation_charge) : null,
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
    idProofNumber: row.id_proof_number ?? null,
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
    // The nightly rate agreed for this stay, or NULL where it is the
    // category's own — which is most of them.
    basePriceOverride: row.base_price_override != null ? Number(row.base_price_override) : null,
    status: row.status,
    actualCheckInAt: row.actual_check_in_at,
    actualCheckOutAt: row.actual_check_out_at,
    // The settlement a cancellation recorded: what went back to the guest and
    // what the house kept as the cancellation charge. All NULL on a live stay,
    // and on a cancellation that never settled the question.
    cancelReason: row.cancel_reason ?? null,
    refundAmount: row.refund_amount != null ? Number(row.refund_amount) : null,
    refundPaymentMethod: row.refund_payment_method ?? null,
    cancellationCharge: row.cancellation_charge != null ? Number(row.cancellation_charge) : null,
    // Set only on a charge collected at the desk — a charge kept from an
    // advance has no tender of its own.
    cancellationChargePaymentMethod: row.cancellation_charge_payment_method ?? null,
    cancelledAt: row.cancelled_at ?? null,
    advanceAmount: row.advance_amount != null ? Number(row.advance_amount) : null,
    // The first tender, kept as it always was. A stay whose advance arrived two
    // ways still has one method here, which is why advancePaymentLines exists.
    advancePaymentMethod: row.advance_payment_method,
    // Every way the advance actually arrived, with what came in by each.
    //
    // Only getBooking pays for the query behind it, so a booking mapped from a
    // list endpoint has none — the screens fall back to advancePaymentMethod
    // above, which is what they showed before any of this existed.
    advancePaymentLines: extra.advancePaymentLines ?? null,
    // The UPI/card transaction number, for reconciling the property's
    // settlement statement against what the desk says it took. NULL on cash,
    // which leaves no such trail.
    advanceReference: row.advance_reference ?? null,
    nights: nightlyLines(row),
    lateCheckoutCharge: Number(row.late_checkout_charge ?? 0),
    lateCheckoutMinutes: row.late_checkout_minutes ?? null,
    // chargePerNight is what this booking is actually charged for one — the
    // price reception agreed, falling back to the lodge's for extras nobody
    // haggled over. lodgeChargePerNight is the list price beside it, so the
    // form can show what was given away without re-deriving it.
    switchableCharges: charges.map((c) => ({
      id: c.id,
      name: c.name,
      chargePerNight: Number(c.charge_per_night),
      // What the whole line costs per night when reception agreed a figure —
      // null when nobody haggled, and the count times the rate applies.
      agreedAmount: c.agreed_amount == null ? null : Number(c.agreed_amount),
      quantity: Number(c.quantity ?? 1),
    })),
    guests: guests.map((g) => ({
      id: g.id,
      name: g.guest_name,
      phone: g.guest_phone,
      idProofType: g.id_proof_type,
      idProofNumber: g.id_proof_number ?? null,
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
        SELECT id, guest_name, guest_phone, id_proof_type, id_proof_number, id_proof_document, check_in_date
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
      SELECT r.id, r.guest_name, r.guest_phone, r.id_proof_type, r.id_proof_number, r.id_proof_document,
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
    // Type and number are read off ONE stay, never mixed. They describe the
    // same card, and a row that pairs "Aadhaar" with the number off a passport
    // is worse than a blank field — it looks checked.
    const idSource = hasDocument ? chosen : stays[0];

    suggestions.push({
      // The stay this suggestion was read off — quoted back on save as the
      // booking to copy the ID document from.
      bookingId: chosen.id,
      name: chosen.guest_name,
      phone: chosen.guest_phone,
      // Read off the stay whose document is being offered, so the type named
      // in the form is the type of the card that will actually be attached.
      idProofType: idSource.id_proof_type,
      // Unlike the document, the number can come back down and be shown: it is
      // what reception would otherwise copy off the card by hand, and a guest
      // who has stayed before should not be asked to read it out again.
      idProofNumber: idSource.id_proof_number ?? null,
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
      SELECT sc.id, sc.name, sc.charge_per_night, bsc.quantity, bsc.agreed_amount
      FROM dbo.booking_switchable_charges bsc
      JOIN dbo.switchable_charges sc ON sc.id = bsc.charge_id
      WHERE bsc.booking_id = @bookingId
    `);

  const guestsResult = await pool
    .request()
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT id, guest_name, guest_phone, id_proof_type, id_proof_number, id_proof_document, is_child
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

  // How the advance on this stay actually arrived, one entry per method.
  //
  // Grouped, so an advance taken across two receipts by the same method reads
  // as one figure. Ordered by the first line entered, which is the order the
  // desk keyed them and the order the receipt prints them.
  const advanceLines = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT pl.method, SUM(pl.amount) AS amount
      FROM dbo.payment_lines pl
      JOIN dbo.advance_receipts ar ON ar.id = pl.advance_receipt_id
      WHERE pl.lodge_id = @lodgeId AND ar.lodge_id = @lodgeId
        AND ar.booking_id = @bookingId AND ar.status = 'ISSUED'
      GROUP BY pl.method
      ORDER BY MIN(pl.id)
    `);

  return mapBooking(row, chargesResult.recordset, guestsResult.recordset, vehiclesResult.recordset, {
    // Always populated, so the screen has one shape to render. An advance taken
    // before payment lines existed, or one paid a single way, comes back as a
    // single entry built from the booking's own advance_payment_method — which
    // is also where any money the lines do not account for goes, because that
    // column is the only record of how it arrived.
    advancePaymentLines: splitAcross(
      Number(row.advance_amount) || 0,
      advanceLines.recordset.map((r) => ({ method: r.method, amount: Number(r.amount) })),
      row.advance_payment_method
    ),
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

  // Pre-flight, deliberately unlocked: it rejects the common case before the
  // pricing work below without holding a lock across it. The check that decides
  // the outcome is the one inside the transaction.
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
    input.basePriceOverride ?? null,
    requestedDiscount
  );

  // priceStay clamps for the sake of the live quote; a save is a decision, so
  // a concession bigger than the stay is an error rather than a silent haircut
  // reception never sees.
  if (round2(requestedDiscount) > discountAmount) {
    throw new ApiError(`The concession can’t be more than the stay total of ₹${grossTotal}.`, 400);
  }

  // Against what is actually payable, not the gross: a stay discounted to ₹900
  // cannot take ₹1,000 up front.
  assertAdvanceWithinTotal(input.advanceAmount, totalPrice);

  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const conflict = await hasOverlap(
      () => new sql.Request(transaction),
      input.roomId,
      input.checkInDate,
      input.checkOutDate,
      undefined,
      { lock: true }
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
      .input('idProofNumber', sql.NVarChar, input.idProofNumber ?? null)
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
      .input('basePriceOverride', sql.Decimal(10, 2), input.basePriceOverride ?? null)
      .query(`
        INSERT INTO dbo.bookings
          (lodge_id, room_id, guest_name, guest_phone, num_guests, id_proof_type, id_proof_number, id_proof_document,
           check_in_date, check_out_date, total_price, discount_amount, nightly_breakdown, created_by,
           advance_amount, advance_payment_method, advance_reference, base_price_override)
        OUTPUT inserted.id
        VALUES
          (@lodgeId, @roomId, @guestName, @guestPhone, @numGuests, @idProofType, @idProofNumber, @idProofDocument,
           @checkInDate, @checkOutDate, @totalPrice, @discountAmount, @nightlyBreakdown, @createdBy,
           @advanceAmount, @advancePaymentMethod, @advanceReference, @basePriceOverride)
      `);

    const bookingId = insertResult.recordset[0].id;

    await replaceBookingCharges(transaction, bookingId, switchableCharges);

    await insertGuestsAndVehicles(transaction, bookingId, input.guests, input.vehicles);

    await transaction.commit();

    await autoIssueAdvanceReceipt(lodgeId, userId, bookingId, input);

    // Not awaited: the guest's confirmation is best-effort and the desk should
    // not wait on the provider. The notifier never rejects — it logs.
    void notifications.notifyStayBooked(lodgeId, bookingId);

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
      .input('idProofNumber', sql.NVarChar, guest.idProofNumber ?? null)
      .input('idProofDocument', sql.NVarChar, guest.idProofDocument)
      .input('isChild', sql.Bit, guest.isChild ? 1 : 0)
      .query(`
        INSERT INTO dbo.booking_guests (booking_id, guest_name, guest_phone, id_proof_type, id_proof_number, id_proof_document, is_child)
        VALUES (@bookingId, @guestName, @guestPhone, @idProofType, @idProofNumber, @idProofDocument, @isChild)
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
        .input('idProofNumber', sql.NVarChar, guest.idProofNumber ?? null)
        .input('idProofDocument', sql.NVarChar, guest.idProofDocument)
        .input('isChild', sql.Bit, guest.isChild ? 1 : 0)
        .query(`
          UPDATE dbo.booking_guests
          SET guest_name = @guestName, guest_phone = @guestPhone,
              id_proof_type = COALESCE(@idProofType, id_proof_type),
              id_proof_number = COALESCE(@idProofNumber, id_proof_number),
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
      .input('idProofNumber', sql.NVarChar, guest.idProofNumber ?? null)
      .input('idProofDocument', sql.NVarChar, guest.idProofDocument)
      .input('isChild', sql.Bit, guest.isChild ? 1 : 0)
      .query(`
        INSERT INTO dbo.booking_guests (booking_id, guest_name, guest_phone, id_proof_type, id_proof_number, id_proof_document, is_child)
        VALUES (@bookingId, @guestName, @guestPhone, @idProofType, @idProofNumber, @idProofDocument, @isChild)
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

async function checkIn(lodgeId, bookingId, input, userId = null) {
  const pool = await getPool();

  const bookingResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT b.num_guests, b.id_proof_type, b.check_in_date,
             b.total_price, b.advance_amount,
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

  // check-in ADDS to whatever was already taken, so the two are weighed
  // together — ₹500 at booking and ₹600 at the door is ₹1,100 against the stay.
  assertAdvanceWithinTotal(input.advanceAmount, bookingRow.total_price, bookingRow.advance_amount);

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
      .input('idProofNumber', sql.NVarChar, input.idProofNumber ?? null)
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
            id_proof_number = COALESCE(@idProofNumber, id_proof_number),
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

  // A deposit taken at the door gets its receipt the same way one taken at
  // booking does. checkIn adds to whatever advance was already on the stay, so
  // this receipts the instalment just taken rather than the running total.
  await autoIssueAdvanceReceipt(lodgeId, userId ?? null, bookingId, input);

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
             l.checkin_mode, l.check_out_time, l.check_in_time, l.late_grace_minutes,
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
  const plannedNights = lateCheckout.nightsBetween(checkInDate, checkOutDate);

  // CYCLE prices the overstay in whole nights: how many checkout-time
  // boundaries the stay actually crossed, against how many it was booked for.
  // The other two modes keep their percentage bands. A CYCLE booking with no
  // arrival on record can't be counted, so it falls back to the bands too.
  const isCycle = row.checkin_mode === 'CYCLE' && row.actual_check_in_at;
  const actualNights = isCycle
    ? lateCheckout.cycleNights({
        checkOutTime: toClockTime(row.check_out_time),
        actualCheckInAt: row.actual_check_in_at,
        at,
        graceMinutes: row.late_grace_minutes,
      })
    : plannedNights;
  const extraNights = Math.max(0, actualNights - plannedNights);
  const suggestion = isCycle
    ? lateCheckout.suggestCycleCharge(extraNights, lastNightRate)
    : lateCheckout.suggestLateCharge(policy, minutesLate, lastNightRate);

  return {
    plannedNights,
    actualNights,
    extraNights,
    checkInTime: toClockTime(row.check_in_time),
    checkOutTime: toClockTime(row.check_out_time),
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
// extend, only extras can still be corrected. The check-in date is narrower
// still: only a booking that hasn't been checked in yet can be moved, because
// once a guest is in the room the day they arrived is a recorded fact rather
// than a plan. Re-dating a reservation is an ordinary desk correction; re-dating
// a stay already under way is a cancel-and-rebook.
async function updateBooking(lodgeId, bookingId, input, userId = null) {
  const pool = await getPool();

  const bookingResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT room_id, check_in_date, check_out_date, status, num_guests, guest_name, guest_phone,
             base_price_override, discount_amount, advance_amount
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

  const currentCheckInDate = toIsoDate(bookingRow.check_in_date);
  const currentCheckOutDate = toIsoDate(bookingRow.check_out_date);
  const changingStayDetails =
    input.checkInDate != null || input.checkOutDate != null || input.roomId != null;

  if (changingStayDetails && bookingRow.status === 'CHECKED_OUT') {
    throw new ApiError('This stay is already checked out — only extras can still be edited.', 409);
  }

  const newRoomId = input.roomId ?? bookingRow.room_id;
  const newCheckInDate = input.checkInDate ?? currentCheckInDate;
  const newCheckOutDate = input.checkOutDate ?? currentCheckOutDate;

  // A guest standing in the room arrived on a particular day, and that day is
  // now part of the record — the folio, the register and any receipt already
  // raised all read from it. Sending the same date back is not a change, so a
  // form that posts every field it shows keeps working on a checked-in stay.
  if (newCheckInDate !== currentCheckInDate && bookingRow.status !== 'BOOKED') {
    throw new ApiError(
      'The guest has already checked in — the check-in date can’t be changed. Cancel and rebook instead.',
      409
    );
  }

  if (newCheckOutDate <= newCheckInDate) {
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

  // Whether this edit can free or take a night. An edit that only corrects a
  // phone number moves no dates and needs no availability check at all.
  const movingStay =
    newRoomId !== bookingRow.room_id ||
    newCheckInDate !== currentCheckInDate ||
    newCheckOutDate !== currentCheckOutDate;

  // Pre-flight only — see the matching note in createBooking. The binding check
  // is inside the transaction below, because everything between here and there
  // (guest list, charges, pricing) is several round trips during which another
  // clerk can take the room.
  if (movingStay) {
    const conflict = await hasOverlap(() => pool.request(), newRoomId, newCheckInDate, newCheckOutDate, bookingId);
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
      .query('SELECT charge_id, quantity, agreed_amount FROM dbo.booking_switchable_charges WHERE booking_id = @bookingId');
    switchableCharges = currentChargesResult.recordset.map((r) => ({
      id: Number(r.charge_id),
      quantity: Number(r.quantity),
      // Carried forward so an edit that does not touch the extras cannot
      // silently reprice them to the lodge's current rate.
      agreedAmount: r.agreed_amount == null ? undefined : Number(r.agreed_amount),
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

  // Absent leaves the agreed rate as it is — a save that only moves the dates
  // must not quietly re-price the stay at rack rate. Blank arrives as null and
  // puts it back on the category's own price.
  const storedBaseRate =
    bookingRow.base_price_override != null ? Number(bookingRow.base_price_override) : null;
  const newBaseRate =
    input.basePriceOverride !== undefined ? input.basePriceOverride : storedBaseRate;

  const { nights, totalPrice, discountAmount, grossTotal } = await priceStay(
    lodgeId,
    newRoomId,
    newCheckInDate,
    newCheckOutDate,
    switchableCharges,
    newBaseRate,
    requestedDiscount
  );

  if (round2(requestedDiscount) > discountAmount) {
    throw new ApiError(`The concession can’t be more than the stay total of ₹${grossTotal}.`, 400);
  }

  // An edit SETS the advance rather than adding to it, so what is typed is
  // weighed against the stay on its own — and against the re-priced total,
  // since the same save may have shortened the stay or taken a discount off it.
  if (input.advanceAmount != null) {
    assertAdvanceWithinTotal(input.advanceAmount, totalPrice);
  }

  const transaction = new sql.Transaction(pool);
  // Default isolation, not SERIALIZABLE. The lock hints on the overlap check
  // below give that one statement the range lock it needs; raising the level
  // for the whole transaction would extend range locking to the charge, guest
  // and vehicle rewrites too, which need no such guarantee and would only widen
  // the surface for deadlocks between concurrent edits.
  await transaction.begin();
  try {
    // Re-checked here, holding a lock, and first — before any row is written.
    // The pre-flight above was a courtesy; this is the one that decides, and it
    // closes the window in which two concurrent edits could move two stays into
    // the same room for the same nights.
    if (movingStay) {
      const conflict = await hasOverlap(
        () => new sql.Request(transaction),
        newRoomId,
        newCheckInDate,
        newCheckOutDate,
        bookingId,
        { lock: true }
      );
      if (conflict) {
        throw new ApiError('That room is already booked for part of this date range.', 409);
      }
    }

    await replaceBookingCharges(transaction, bookingId, switchableCharges);

    await new sql.Request(transaction)
      .input('bookingId', sql.BigInt, bookingId)
      .input('roomId', sql.BigInt, newRoomId)
      .input('checkInDate', sql.Date, newCheckInDate)
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
      // Same absent/blank rule as the advance below, and for the same reason:
      // '' has to mean "back to the category price", which is different from
      // not sending the field at all.
      .input('setBaseRate', sql.Bit, input.basePriceOverride !== undefined ? 1 : 0)
      .input('basePriceOverride', sql.Decimal(10, 2), input.basePriceOverride ?? null)
      .input('setAdvance', sql.Bit, input.advanceAmount !== undefined ? 1 : 0)
      .input('advanceAmount', sql.Decimal(10, 2), input.advanceAmount ?? null)
      .input('advancePaymentMethod', sql.NVarChar, input.advancePaymentMethod ?? null)
      .input('advanceReference', sql.NVarChar, input.advanceReference ?? null)
      // COALESCE, not a flag: an ID proof is only ever replaced, never
      // cleared — a stay that has one on file must not be editable back into
      // one that doesn't.
      .input('idProofType', sql.NVarChar, input.idProofType ?? null)
      .input('idProofNumber', sql.NVarChar, input.idProofNumber ?? null)
      .input('idProofDocument', sql.NVarChar, input.idProofDocument ?? null)
      .query(`
        UPDATE dbo.bookings
        SET room_id = @roomId, check_in_date = @checkInDate, check_out_date = @checkOutDate,
            num_guests = @numGuests,
            guest_name = @guestName, guest_phone = @guestPhone,
            total_price = @totalPrice, discount_amount = @discountAmount,
            nightly_breakdown = @nightlyBreakdown,
            base_price_override =
              CASE WHEN @setBaseRate = 1 THEN @basePriceOverride ELSE base_price_override END,
            advance_amount = CASE WHEN @setAdvance = 1 THEN @advanceAmount ELSE advance_amount END,
            advance_payment_method =
              CASE WHEN @setAdvance = 1 THEN @advancePaymentMethod ELSE advance_payment_method END,
            advance_reference =
              CASE WHEN @setAdvance = 1 THEN @advanceReference ELSE advance_reference END,
            id_proof_type = COALESCE(@idProofType, id_proof_type),
            id_proof_number = COALESCE(@idProofNumber, id_proof_number),
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

  // An edit SETS the advance rather than adding to it — it is a correction of
  // the record — so only the part that is new money gets a receipt. Raising one
  // for the whole figure would receipt the original deposit twice, and raising
  // none would leave a second instalment with no document at all now that
  // receipts are no longer issued by hand.
  //
  // A reduction raises nothing: money going back out is a void against the
  // receipt that brought it in, not a new receipt for a negative amount.
  if (input.advanceAmount != null) {
    const before = Number(bookingRow.advance_amount) || 0;
    const added = round2(Number(input.advanceAmount) - before);
    if (added > 0) {
      await autoIssueAdvanceReceipt(lodgeId, userId, bookingId, {
        advanceAmount: added,
        advancePaymentMethod: input.advancePaymentMethod,
        advanceReference: input.advanceReference,
      });
    }
  }

  return getBooking(lodgeId, bookingId);
}

// Cancelling settles the money as well as the room, and the settlement takes
// one of two shapes, decided by whether an advance is held:
//
//   - An advance held: the desk says how much goes back to the guest, and
//     whatever it holds on to is the cancellation charge — computed against
//     the advance as it stands inside the same statement, so the split can
//     never drift from the advance even if a receipt lands between the screen
//     and the click. The charge has no tender of its own: the money arrived
//     when the advance did.
//   - No advance: there is nothing to refund, but the desk may collect a
//     cancellation charge from the guest on the spot — money coming in, so it
//     carries its own tender. Capped at the stay's price: a fee larger than
//     the booking it is for is a typo, not a policy.
//
// The two shapes are mutually exclusive and the WHERE clause holds each to
// its side. Money already taken is never touched: the advance and its
// receipts stay as the paper trail, and the settlement columns say where the
// money went. No settlement figures at all (an old client) leaves the columns
// NULL — "not settled", not "kept nothing".
async function cancelBooking(
  lodgeId,
  bookingId,
  { reason = null, refundAmount = null, refundPaymentMethod = null, cancellationCharge = null, cancellationChargePaymentMethod = null } = {}
) {
  const pool = await getPool();
  const refund = refundAmount != null ? round2(Number(refundAmount)) : null;
  const charge = cancellationCharge != null ? round2(Number(cancellationCharge)) : null;
  if (refund != null && charge != null) {
    throw new ApiError('Settle either the advance or a collected charge — not both.', 400);
  }
  if (charge > 0 && !cancellationChargePaymentMethod) {
    throw new ApiError('Choose how the cancellation charge was collected.', 400);
  }
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .input('reason', sql.NVarChar(200), reason ?? null)
    .input('refund', sql.Decimal(10, 2), refund)
    // A tender only means anything against money that actually moved — a
    // zero refund keeps none and a zero charge collects none, whatever the
    // screen had selected.
    .input('refundMethod', sql.NVarChar(20), refund > 0 ? (refundPaymentMethod ?? null) : null)
    .input('charge', sql.Decimal(10, 2), charge)
    .input('chargeMethod', sql.NVarChar(20), charge > 0 ? (cancellationChargePaymentMethod ?? null) : null)
    .query(`
      UPDATE dbo.bookings
      SET status = 'CANCELLED',
          cancel_reason = @reason,
          cancelled_at = SYSDATETIMEOFFSET(),
          refund_amount = @refund,
          refund_payment_method = @refundMethod,
          cancellation_charge = CASE WHEN @charge IS NOT NULL THEN @charge
                                     WHEN @refund IS NULL THEN NULL
                                     ELSE ISNULL(advance_amount, 0) - @refund END,
          cancellation_charge_payment_method = @chargeMethod
      OUTPUT inserted.id
      WHERE id = @bookingId AND lodge_id = @lodgeId AND status = 'BOOKED'
        AND (@refund IS NULL OR @refund <= ISNULL(advance_amount, 0))
        AND (@charge IS NULL OR (ISNULL(advance_amount, 0) = 0 AND @charge <= total_price))
    `);
  if (result.recordset.length === 0) {
    // The guard refuses several different things; tell the desk which one it
    // hit rather than making it guess.
    const check = await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('bookingId', sql.BigInt, bookingId)
      .query(`SELECT advance_amount, total_price FROM dbo.bookings WHERE id = @bookingId AND lodge_id = @lodgeId AND status = 'BOOKED'`);
    const row = check.recordset[0];
    if (row) {
      if (charge != null && Number(row.advance_amount) > 0) {
        throw new ApiError('This booking holds an advance — settle it as a refund, keeping the charge from it.', 400);
      }
      if (charge != null && charge > Number(row.total_price)) {
        throw new ApiError('The cancellation charge can’t be more than the stay’s price.', 400);
      }
      throw new ApiError('The refund can’t be more than the advance held on this booking.', 400);
    }
    throw new ApiError('Booking not found or cannot be cancelled.', 409);
  }
  return getBooking(lodgeId, bookingId);
}

module.exports = {
  idProofExists,
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
