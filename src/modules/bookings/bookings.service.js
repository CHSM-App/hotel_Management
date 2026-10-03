const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const { parseBeds } = require('../rooms/rooms.service');
const { UPLOAD_DIR } = require('../../middleware/idProofUpload');
const pricingService = require('../pricing/pricing.service');
const notifications = require('../notifications/bookingConfirmation');
const cancellationNotice = require('../notifications/cancellationNotice');
const billingService = require('../billing/billing.service');
const { splitAcross } = require('../reports/reports.service');
const advanceReceiptsService = require('../billing/advanceReceipts.service');
const { logger } = require('../../config/logger');
const draftsService = require('./drafts.service');
const lateCheckout = require('./lateCheckout');
const { apportionDiscount, mergeRoomNights, rollUpStatus } = require('./bookingRooms');

function round2(n) {
  return Math.round(n * 100) / 100;
}

// The PIN a guest types to order food from their room's QR. Four digits is
// what fits on a check-in slip and gets typed correctly on a phone; it isn't a
// password, and it doesn't need to be — it's only accepted for the one room it
// was issued for, and only while that stay is checked in. randomInt is used
// rather than Math.random so a guest can't predict the next room's PIN.
// Requiring the first two or last two digits to repeat (4461, 1599) makes it
// easier for a guest to recall from memory. `taken` is the set of PINs
// already active elsewhere in the lodge, so two checked-in rooms never end up
// sharing a code.
function newFoodPin(taken = new Set()) {
  let pin;
  do {
    pin = String(crypto.randomInt(1000, 10000));
  } while ((pin[0] !== pin[1] && pin[2] !== pin[3]) || taken.has(pin));
  return pin;
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
  discountAmount = 0,
  bedId = null,
  bedIds = null
) {
  const quote = await pricingService.simulateRange(
    lodgeId,
    roomId,
    checkInDate,
    checkOutDate,
    chargeIds,
    basePriceOverride,
    bedId,
    bedIds
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

// ---------------------------------------------------------------------------
// Multi-room bookings (dbo.booking_rooms, migration 104)
//
// A booking holds one or more rooms, each with its own dates, price, extras and
// check-in/out. bookings.* is the roll-up of them (see syncBookingFromRooms),
// with bookings.room_id mirroring the first room so readers that only know one
// room keep working.
// ---------------------------------------------------------------------------

// Rooms as they arrive from a create: the `rooms` list, or the older flat
// roomId/bedIds/extras fields as a list of one. A date a room doesn't carry is
// the booking's own — which is what "same dates for all rooms" sends.
function normalizeRoomInputs(input) {
  const list =
    input.rooms && input.rooms.length > 0
      ? input.rooms
      : [
          {
            roomId: input.roomId,
            bedId: input.bedId,
            bedIds: input.bedIds,
            basePriceOverride: input.basePriceOverride,
            switchableCharges: input.switchableCharges,
          },
        ];
  const seen = new Set();
  return list.map((r) => {
    const roomId = Number(r.roomId);
    if (seen.has(roomId)) {
      throw new ApiError('A room can only be added to a booking once.', 400);
    }
    seen.add(roomId);
    const checkInDate = r.checkInDate ?? input.checkInDate;
    const checkOutDate = r.checkOutDate ?? input.checkOutDate;
    if (!checkInDate || !checkOutDate || checkOutDate <= checkInDate) {
      throw new ApiError('Check-out date must be after check-in date.', 400);
    }
    return {
      roomId,
      bedIds: Array.from(
        new Set((r.bedIds && r.bedIds.length > 0 ? r.bedIds : r.bedId != null ? [r.bedId] : []).map(Number))
      ),
      checkInDate,
      checkOutDate,
      basePriceOverride: r.basePriceOverride ?? null,
      switchableCharges: pricingService.normalizeSelections(r.switchableCharges ?? input.switchableCharges ?? []),
    };
  });
}

// Every room must be an active room of this lodge, and its beds must be beds of
// that room: a dormitory needs at least one, any other room can't have any.
// Returns room rows keyed by id.
async function loadAndCheckRooms(pool, lodgeId, rooms) {
  if (rooms.length === 0) return new Map();
  const roomIds = rooms.map((r) => r.roomId);
  if (roomIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new ApiError('Choose a valid room.', 400);
  }
  const roomResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    // Validated integers above, so the IN list can be built by interpolation.
    .query(`
      SELECT id, room_number, max_occupancy, is_dormitory FROM dbo.rooms
      WHERE lodge_id = @lodgeId AND is_active = 1 AND id IN (${roomIds.join(',')})
    `);
  const byId = new Map(roomResult.recordset.map((r) => [Number(r.id), r]));
  if (byId.size !== roomIds.length) {
    throw new ApiError('Choose a valid room.', 400);
  }

  for (const r of rooms) {
    const room = byId.get(r.roomId);
    if (room.is_dormitory && r.bedIds.length === 0) {
      throw new ApiError('Choose a bed.', 400);
    }
    if (r.bedIds.length > 0) {
      if (!room.is_dormitory) {
        throw new ApiError('This room isn’t set up as a dormitory.', 400);
      }
      const bedResult = await pool
        .request()
        .input('roomId', sql.BigInt, r.roomId)
        .query('SELECT id FROM dbo.dormitory_beds WHERE room_id = @roomId AND is_active = 1');
      const validIds = new Set(bedResult.recordset.map((b) => Number(b.id)));
      if (!r.bedIds.every((id) => validIds.has(id))) {
        throw new ApiError('Choose a valid bed.', 400);
      }
    }
  }
  return byId;
}

// Prices every room with the same code the simulator runs, then takes the
// booking's concession off across them in proportion. Clamped, like priceStay,
// because it also serves the live quote.
async function priceBooking(lodgeId, rooms, discountAmount = 0) {
  const quotes = [];
  for (const r of rooms) {
    quotes.push(
      await priceStay(
        lodgeId,
        r.roomId,
        r.checkInDate,
        r.checkOutDate,
        r.switchableCharges,
        r.basePriceOverride,
        0,
        r.bedIds[0] ?? null,
        r.bedIds
      )
    );
  }
  const grossTotal = round2(quotes.reduce((sum, q) => sum + q.grossTotal, 0));
  const requested = Number(discountAmount);
  const discount = round2(Math.min(Math.max(Number.isFinite(requested) ? requested : 0, 0), grossTotal));
  const shares = apportionDiscount(
    quotes.map((q) => q.grossTotal),
    discount
  );
  return {
    rooms: rooms.map((r, i) => ({
      ...r,
      nights: spreadConcession(quotes[i].nights, quotes[i].grossTotal, shares[i]),
      charges: quotes[i].charges,
      grossTotal: quotes[i].grossTotal,
      discountAmount: shares[i],
      totalPrice: round2(quotes[i].grossTotal - shares[i]),
    })),
    grossTotal,
    discountAmount: discount,
    totalPrice: round2(grossTotal - discount),
  };
}

// The live quote for a booking of several rooms: what each room costs, and the
// booking's total after the concession.
async function quoteBooking(lodgeId, { rooms, checkInDate, checkOutDate, discountAmount = 0 }) {
  const priced = await priceBooking(lodgeId, normalizeRoomInputs({ rooms, checkInDate, checkOutDate }), discountAmount);
  return {
    rooms: priced.rooms.map((r) => ({
      roomId: r.roomId,
      checkInDate: r.checkInDate,
      checkOutDate: r.checkOutDate,
      nights: r.nights,
      charges: r.charges,
      grossTotal: r.grossTotal,
      discountAmount: r.discountAmount,
      totalPrice: r.totalPrice,
    })),
    grossTotal: priced.grossTotal,
    discountAmount: priced.discountAmount,
    totalPrice: priced.totalPrice,
  };
}

async function writeRoomCharges(transaction, bookingRoomId, selections) {
  await new sql.Request(transaction)
    .input('bookingRoomId', sql.BigInt, bookingRoomId)
    .query('DELETE FROM dbo.booking_room_switchable_charges WHERE booking_room_id = @bookingRoomId');
  for (const selection of selections) {
    await new sql.Request(transaction)
      .input('bookingRoomId', sql.BigInt, bookingRoomId)
      .input('chargeId', sql.BigInt, selection.id)
      .input('quantity', sql.Int, selection.quantity)
      .input('agreedAmount', sql.Decimal(10, 2), selection.agreedAmount ?? null)
      .query(`
        INSERT INTO dbo.booking_room_switchable_charges (booking_room_id, charge_id, quantity, agreed_amount)
        VALUES (@bookingRoomId, @chargeId, @quantity, @agreedAmount)
      `);
  }
}

async function insertBookingRoom(transaction, bookingId, room) {
  const result = await new sql.Request(transaction)
    .input('bookingId', sql.BigInt, bookingId)
    .input('roomId', sql.BigInt, room.roomId)
    .input('checkInDate', sql.Date, room.checkInDate)
    .input('checkOutDate', sql.Date, room.checkOutDate)
    .input('basePriceOverride', sql.Decimal(10, 2), room.basePriceOverride ?? null)
    .input('totalPrice', sql.Decimal(10, 2), room.totalPrice)
    .input('discountAmount', sql.Decimal(10, 2), room.discountAmount)
    .input('nightlyBreakdown', sql.NVarChar(sql.MAX), JSON.stringify(room.nights))
    .query(`
      INSERT INTO dbo.booking_rooms
        (booking_id, room_id, check_in_date, check_out_date, base_price_override, total_price, discount_amount, nightly_breakdown)
      OUTPUT inserted.id
      VALUES (@bookingId, @roomId, @checkInDate, @checkOutDate, @basePriceOverride, @totalPrice, @discountAmount, @nightlyBreakdown)
    `);
  const bookingRoomId = result.recordset[0].id;
  await writeRoomCharges(transaction, bookingRoomId, room.switchableCharges);
  return bookingRoomId;
}

// bed_id holds the first bed the booking has, in any of its rooms, and
// booking_beds the rest — the layout 089 set up, kept as it was. Which room a
// bed is in is on the bed itself.
async function writeBookingBeds(transaction, lodgeId, bookingId, bedIds) {
  await new sql.Request(transaction)
    .input('bookingId', sql.BigInt, bookingId)
    .query('DELETE FROM dbo.booking_beds WHERE booking_id = @bookingId');
  await new sql.Request(transaction)
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .input('bedId', sql.BigInt, bedIds[0] ?? null)
    .query('UPDATE dbo.bookings SET bed_id = @bedId WHERE id = @bookingId AND lodge_id = @lodgeId');
  for (const extraBedId of bedIds.slice(1)) {
    await new sql.Request(transaction)
      .input('bookingId', sql.BigInt, bookingId)
      .input('bedId', sql.BigInt, extraBedId)
      .query('INSERT INTO dbo.booking_beds (booking_id, bed_id) VALUES (@bookingId, @bedId)');
  }
}

// The nights behind a room's price: its frozen snapshot, or an even split for
// a room that has none (a booking older than the snapshot column).
function roomNights(row) {
  if (row.nightly_breakdown) {
    try {
      return JSON.parse(row.nightly_breakdown);
    } catch {
      // Falls through to the even split.
    }
  }
  const dates = datesInRange(toIsoDate(row.check_in_date), toIsoDate(row.check_out_date));
  const even = dates.length > 0 ? round2(Number(row.total_price) / dates.length) : 0;
  return dates.map((date) => ({ date, total: even, lines: [] }));
}

// Recomputes the booking row from its rooms. Every write to booking_rooms ends
// here, in the same transaction, so bookings.* can never disagree with them:
// window = earliest check-in to latest check-out, price and concession = sums,
// status = rollUpStatus, and room_id = the first room still on the booking.
async function syncBookingFromRooms(transaction, bookingId) {
  const rows = (
    await new sql.Request(transaction)
      .input('bookingId', sql.BigInt, bookingId)
      .query(`
        SELECT br.id, br.room_id, r.room_number, br.check_in_date, br.check_out_date, br.status,
               br.actual_check_in_at, br.actual_check_out_at, br.base_price_override, br.total_price,
               br.discount_amount, br.nightly_breakdown, br.late_checkout_charge, br.late_checkout_minutes,
               br.food_pin
        FROM dbo.booking_rooms br
        JOIN dbo.rooms r ON r.id = br.room_id
        WHERE br.booking_id = @bookingId AND br.status <> 'CANCELLED'
        ORDER BY br.id
      `)
  ).recordset;
  if (rows.length === 0) return;

  const status = rollUpStatus(rows.map((r) => r.status));
  const allOut = status === 'CHECKED_OUT';
  const arrivals = rows.map((r) => r.actual_check_in_at).filter(Boolean);
  const departures = rows.map((r) => r.actual_check_out_at).filter(Boolean);
  const lateMinutes = rows.map((r) => r.late_checkout_minutes).filter((m) => m != null);
  const inHouse = rows.find((r) => r.status === 'CHECKED_IN');

  await new sql.Request(transaction)
    .input('bookingId', sql.BigInt, bookingId)
    .input('roomId', sql.BigInt, rows[0].room_id)
    .input('checkInDate', sql.Date, rows.map((r) => toIsoDate(r.check_in_date)).sort()[0])
    .input('checkOutDate', sql.Date, rows.map((r) => toIsoDate(r.check_out_date)).sort().reverse()[0])
    .input('status', sql.NVarChar, status)
    .input('totalPrice', sql.Decimal(10, 2), round2(rows.reduce((s, r) => s + Number(r.total_price), 0)))
    .input('discountAmount', sql.Decimal(10, 2), round2(rows.reduce((s, r) => s + Number(r.discount_amount ?? 0), 0)))
    .input(
      'nightlyBreakdown',
      sql.NVarChar(sql.MAX),
      JSON.stringify(mergeRoomNights(rows.map((r) => ({ roomNumber: r.room_number, nights: roomNights(r) }))))
    )
    .input('basePriceOverride', sql.Decimal(10, 2), rows[0].base_price_override ?? null)
    .input('lateCharge', sql.Decimal(10, 2), round2(rows.reduce((s, r) => s + Number(r.late_checkout_charge ?? 0), 0)))
    .input('lateMinutes', sql.Int, lateMinutes.length > 0 ? Math.max(...lateMinutes) : null)
    .input('checkedInAt', sql.DateTimeOffset, arrivals.length > 0 ? new Date(Math.min(...arrivals.map(Number))) : null)
    .input('checkedOutAt', sql.DateTimeOffset, allOut && departures.length > 0 ? new Date(Math.max(...departures.map(Number))) : null)
    // The legacy single PIN is the first room still in house. Clearing it once
    // nobody is in is what closes in-room ordering for the booking's PIN.
    .input('foodPin', sql.NVarChar, inHouse?.food_pin ?? null)
    .query(`
      UPDATE dbo.bookings
      SET room_id = @roomId, check_in_date = @checkInDate, check_out_date = @checkOutDate, status = @status,
          total_price = @totalPrice, discount_amount = @discountAmount, nightly_breakdown = @nightlyBreakdown,
          base_price_override = @basePriceOverride,
          late_checkout_charge = @lateCharge, late_checkout_minutes = @lateMinutes,
          actual_check_in_at = @checkedInAt, actual_check_out_at = @checkedOutAt,
          food_pin = @foodPin
      WHERE id = @bookingId
    `);

  // The legacy booking-level extras follow the first room, so the readers that
  // still look at booking_switchable_charges see that room's.
  await new sql.Request(transaction)
    .input('bookingId', sql.BigInt, bookingId)
    .input('bookingRoomId', sql.BigInt, rows[0].id)
    .query(`
      DELETE FROM dbo.booking_switchable_charges WHERE booking_id = @bookingId;
      INSERT INTO dbo.booking_switchable_charges (booking_id, charge_id, quantity, agreed_amount)
      SELECT @bookingId, charge_id, quantity, agreed_amount
      FROM dbo.booking_room_switchable_charges WHERE booking_room_id = @bookingRoomId;
    `);
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
// bedIds, when passed, narrows this from "is the room free" to "is any one
// of these beds free" — but a bed booking still has to lose to a whole-room
// buyout on the same room (bed_id IS NULL there), and a buyout (bedIds
// omitted) still has to lose to ANY booking already on the room, bed-level
// or not. That is the whole of the dormitory overlap rule, in the one AND
// clause below — not a second function, so the UPDLOCK/HOLDLOCK discipline
// above can never drift between the room case and the bed case.
//
// A multi-bed booking's other beds live in booking_beds, not in bed_id, so
// checking bed_id alone would miss them — the EXISTS clause covers both.
async function hasOverlap(
  makeRequest,
  roomId,
  checkInDate,
  checkOutDate,
  excludeBookingId,
  { lock = false, bedIds = null } = {}
) {
  const ids = (bedIds || []).filter((id) => id != null);
  const request = makeRequest()
    .input('roomId', sql.BigInt, roomId)
    .input('checkInDate', sql.Date, checkInDate)
    .input('checkOutDate', sql.Date, checkOutDate);
  let excludeClause = '';
  if (excludeBookingId) {
    request.input('excludeBookingId', sql.BigInt, excludeBookingId);
    excludeClause = 'AND br.booking_id <> @excludeBookingId';
  }
  // No bedIds at all means this call is asking about a whole-room booking
  // (a buyout), which loses to ANY booking already on the room — bed-level
  // or not — same as passing bedId=null always did. Bed ids are validated
  // integers from the service layer (never raw request input) by the time
  // they reach here, so building the IN-list by interpolation is safe — the
  // same trust boundary rooms.service.js's setBedCount already relies on for
  // the same shape of list.
  let bedClause = '1 = 1';
  if (ids.length > 0) {
    const idList = ids.map((id) => Number(id)).join(',');
    bedClause = `b.bed_id IS NULL OR b.bed_id IN (${idList}) OR EXISTS (
      SELECT 1 FROM dbo.booking_beds bb WHERE bb.booking_id = b.id AND bb.bed_id IN (${idList})
    )`;
  }
  // Fixed strings selected by a boolean/array shape, never interpolated
  // request input — as far as anything arriving from a request is
  // concerned, this query is a constant.
  const lockHint = lock ? 'WITH (UPDLOCK, HOLDLOCK)' : '';
  // Read off booking_rooms: each room of a booking has its own dates and its
  // own status, so a room that has checked out (or a booking's other rooms)
  // never blocks this one. The range lock lands on ix_booking_rooms_room_dates.
  const result = await request.query(`
    SELECT TOP 1 br.id FROM dbo.booking_rooms br ${lockHint}
    JOIN dbo.bookings b ON b.id = br.booking_id
    WHERE br.room_id = @roomId AND br.status IN ('BOOKED', 'CHECKED_IN')
      AND br.check_in_date < @checkOutDate AND br.check_out_date > @checkInDate
      ${excludeClause}
      AND (${bedClause})
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
      SELECT br.room_id, br.check_in_date, br.check_out_date
      FROM dbo.booking_rooms br
      JOIN dbo.rooms r ON r.id = br.room_id
      WHERE r.lodge_id = @lodgeId AND r.is_active = 1
        AND br.status IN ('BOOKED', 'CHECKED_IN')
        AND (@excludeBookingId IS NULL OR br.booking_id <> @excludeBookingId)
        AND br.check_in_date < @checkOutDate AND br.check_out_date > @checkInDate
      ORDER BY br.room_id, br.check_in_date ASC
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
             r.is_dormitory, r.dormitory_price, r.dormitory_gender, r.dormitory_is_ac,
             c.name AS category_name, c.base_price AS category_base_price
      FROM dbo.rooms r
      JOIN dbo.room_categories c ON c.id = r.category_id
      WHERE r.lodge_id = @lodgeId AND r.is_active = 1
        AND (
          -- An ordinary room, or a dormitory with a whole-room buyout
          -- already sold on it: the room only counts as available when
          -- nothing at all is booked for the range.
          NOT EXISTS (
            SELECT 1 FROM dbo.booking_rooms br
            WHERE br.room_id = r.id AND br.status IN ('BOOKED', 'CHECKED_IN')
              AND br.check_in_date < @checkOutDate AND br.check_out_date > @checkInDate
          )
          OR (
            -- A dormitory sells its beds one at a time, so it stays offered
            -- here as long as one bed is still free — a single bed taken
            -- must not make the whole 10-bed room disappear from the
            -- picker. Ruled out the moment any booking has bed_id IS NULL
            -- (a buyout, caught by the NOT EXISTS branch above) or every
            -- active bed already has a booking on it.
            r.is_dormitory = 1
            AND NOT EXISTS (
              SELECT 1 FROM dbo.booking_rooms br
              JOIN dbo.bookings b ON b.id = br.booking_id
              WHERE br.room_id = r.id AND br.status IN ('BOOKED', 'CHECKED_IN') AND b.bed_id IS NULL
                AND br.check_in_date < @checkOutDate AND br.check_out_date > @checkInDate
            )
            AND EXISTS (
              SELECT 1 FROM dbo.dormitory_beds db
              WHERE db.room_id = r.id AND db.is_active = 1
                AND NOT EXISTS (
                  SELECT 1 FROM dbo.booking_rooms br
                  JOIN dbo.bookings b ON b.id = br.booking_id
                  WHERE br.room_id = r.id AND br.status IN ('BOOKED', 'CHECKED_IN')
                    AND br.check_in_date < @checkOutDate AND br.check_out_date > @checkInDate
                    AND (
                      b.bed_id = db.id
                      OR EXISTS (SELECT 1 FROM dbo.booking_beds bb WHERE bb.booking_id = b.id AND bb.bed_id = db.id)
                    )
                )
            )
          )
        )
      ORDER BY r.room_number ASC
    `);

  const switchableCharges = await getActiveSwitchableCharges(pool, lodgeId);
  const conflicts = await listRoomConflicts(pool, lodgeId, checkInDate, checkOutDate);

  return {
    // A dormitory room now stays listed as long as it has a free bed, not
    // only when nothing at all is booked on it — the picker's job is "can I
    // sell something here", and for a dormitory that's true bed by bed.
    // isDormitory tells the frontend to open the bed picker instead of
    // quoting the room outright; listAvailableBeds gives the per-bed detail.
    rooms: roomsResult.recordset.map((row) => ({
      id: row.id,
      roomNumber: row.room_number,
      floor: row.floor,
      bedSize: row.bed_size,
      beds: parseBeds(row),
      bathroomType: row.bathroom_type,
      maxOccupancy: row.max_occupancy,
      description: row.description,
      isDormitory: !!row.is_dormitory,
      dormitoryGender: row.dormitory_gender,
      dormitoryIsAc: row.dormitory_is_ac,
      categoryName: row.category_name,
      // The rate this room actually sells at: its own dormitory_price when
      // it's a dormitory that has one, otherwise the category's — the same
      // fallback basePriceOf uses at booking time, kept in step so the
      // picker never quotes a rate the booking won't actually charge.
      categoryBasePrice: row.dormitory_price != null ? Number(row.dormitory_price) : Number(row.category_base_price),
      switchableCharges,
    })),
    conflicts,
  };
}

// Which beds in one dormitory room are free for a date range, plus whether
// the whole room is open for a buyout. A bed is unavailable if it is booked
// itself OR if a buyout (bed_id IS NULL) already covers the room for any
// overlapping night — the same rule hasOverlap enforces at write time, read
// back here so the picker never offers what the write would then reject.
async function listAvailableBeds(lodgeId, roomId, checkInDate, checkOutDate) {
  const pool = await getPool();

  const roomResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roomId', sql.BigInt, roomId)
    .query(`
      SELECT r.id, r.is_dormitory, r.dormitory_price, r.dormitory_gender, r.dormitory_is_ac,
             c.base_price AS category_base_price
      FROM dbo.rooms r
      JOIN dbo.room_categories c ON c.id = r.category_id
      WHERE r.id = @roomId AND r.lodge_id = @lodgeId AND r.is_active = 1
    `);
  const room = roomResult.recordset[0];
  if (!room) {
    throw new ApiError('Room not found.', 404);
  }
  if (!room.is_dormitory) {
    throw new ApiError('This room isn’t set up as a dormitory.', 400);
  }

  const bedsResult = await pool
    .request()
    .input('roomId', sql.BigInt, roomId)
    .input('checkInDate', sql.Date, checkInDate)
    .input('checkOutDate', sql.Date, checkOutDate)
    .query(`
      SELECT db.id, db.bed_label,
             CASE WHEN EXISTS (
               SELECT 1 FROM dbo.booking_rooms br
               JOIN dbo.bookings b ON b.id = br.booking_id
               WHERE br.room_id = @roomId AND br.status IN ('BOOKED', 'CHECKED_IN')
                 AND br.check_in_date < @checkOutDate AND br.check_out_date > @checkInDate
                 AND (
                   b.bed_id = db.id OR b.bed_id IS NULL
                   OR EXISTS (SELECT 1 FROM dbo.booking_beds bb WHERE bb.booking_id = b.id AND bb.bed_id = db.id)
                 )
             ) THEN 1 ELSE 0 END AS is_taken
      FROM dbo.dormitory_beds db
      WHERE db.room_id = @roomId AND db.is_active = 1
      -- Not bed_label: it's text, so "Bed 10" sorts right after "Bed 1" and
      -- before "Bed 2". Beds are created in order, so id order is bed order.
      ORDER BY db.id ASC
    `);

  const roomBuyoutResult = await pool
    .request()
    .input('roomId', sql.BigInt, roomId)
    .input('checkInDate', sql.Date, checkInDate)
    .input('checkOutDate', sql.Date, checkOutDate)
    .query(`
      SELECT TOP 1 id FROM dbo.booking_rooms
      WHERE room_id = @roomId AND status IN ('BOOKED', 'CHECKED_IN')
        AND check_in_date < @checkOutDate AND check_out_date > @checkInDate
    `);

  // One rate for every bed in the room — the room's own price if it has
  // one, else the category's, the same fallback pricing.service.js's
  // basePriceOf uses when it actually prices a stay.
  const pricePerNight =
    room.dormitory_price != null ? Number(room.dormitory_price) : Number(room.category_base_price);

  return {
    pricePerNight,
    gender: room.dormitory_gender,
    // Descriptive, already baked into pricePerNight — same as gender, not a
    // separate charge line and not something one bed-booker opts into.
    isAc: room.dormitory_is_ac,
    beds: bedsResult.recordset.map((row) => ({
      id: row.id,
      bedLabel: row.bed_label,
      isTaken: !!row.is_taken,
    })),
    // A buyout can be offered only when nothing at all — no bed, no earlier
    // buyout — already holds the room for this range.
    roomAvailableForBuyout: roomBuyoutResult.recordset.length === 0,
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
             r.is_dormitory, r.dormitory_price, r.dormitory_gender, r.dormitory_is_ac,
             c.name AS category_name, c.base_price AS category_base_price
      FROM dbo.rooms r
      JOIN dbo.room_categories c ON c.id = r.category_id
      WHERE r.lodge_id = @lodgeId AND r.is_active = 1
        AND (
          NOT EXISTS (
            SELECT 1 FROM dbo.booking_rooms br
            WHERE br.room_id = r.id AND br.booking_id <> @bookingId AND br.status IN ('BOOKED', 'CHECKED_IN')
              AND br.check_in_date < @checkOutDate AND br.check_out_date > @checkInDate
          )
          OR (
            -- Same bed-aware carve-out as listAvailableRooms: a dormitory
            -- with a free bed stays offered even while its other beds are
            -- booked. This booking's own row is excluded throughout, same
            -- as the room-level check above, so editing a bed booking
            -- doesn't see itself as the thing blocking the room.
            r.is_dormitory = 1
            AND NOT EXISTS (
              SELECT 1 FROM dbo.booking_rooms br
              JOIN dbo.bookings b ON b.id = br.booking_id
              WHERE br.room_id = r.id AND br.booking_id <> @bookingId AND br.status IN ('BOOKED', 'CHECKED_IN') AND b.bed_id IS NULL
                AND br.check_in_date < @checkOutDate AND br.check_out_date > @checkInDate
            )
            AND EXISTS (
              SELECT 1 FROM dbo.dormitory_beds db
              WHERE db.room_id = r.id AND db.is_active = 1
                AND NOT EXISTS (
                  SELECT 1 FROM dbo.booking_rooms br
                  JOIN dbo.bookings b ON b.id = br.booking_id
                  WHERE br.room_id = r.id AND br.booking_id <> @bookingId AND br.status IN ('BOOKED', 'CHECKED_IN')
                    AND br.check_in_date < @checkOutDate AND br.check_out_date > @checkInDate
                    AND (
                      b.bed_id = db.id
                      OR EXISTS (SELECT 1 FROM dbo.booking_beds bb WHERE bb.booking_id = b.id AND bb.bed_id = db.id)
                    )
                )
            )
          )
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
      isDormitory: !!row.is_dormitory,
      dormitoryGender: row.dormitory_gender,
      dormitoryIsAc: row.dormitory_is_ac,
      categoryName: row.category_name,
      categoryBasePrice: row.dormitory_price != null ? Number(row.dormitory_price) : Number(row.category_base_price),
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
           -- Every room the booking holds, in the order they were added; the
           -- register shows this where it used to show the one room number.
           (SELECT STRING_AGG(rr.room_number, ', ') WITHIN GROUP (ORDER BY br.id)
            FROM dbo.booking_rooms br JOIN dbo.rooms rr ON rr.id = br.room_id
            WHERE br.booking_id = b.id AND (br.status <> 'CANCELLED' OR b.status = 'CANCELLED')) AS room_numbers,
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
    ORDER BY b.created_at DESC, b.id DESC
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
    roomNumbers: row.room_numbers ?? row.room_number,
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
      SELECT r.id, r.room_number, r.floor, r.is_dormitory, r.dormitory_gender, r.dormitory_is_ac,
             c.name AS category_name,
             (SELECT COUNT(*) FROM dbo.dormitory_beds db WHERE db.room_id = r.id AND db.is_active = 1) AS bed_count
      FROM dbo.rooms r
      JOIN dbo.room_categories c ON c.id = r.category_id
      WHERE r.lodge_id = @lodgeId AND r.is_active = 1
      ORDER BY CASE WHEN c.tape_order IS NULL THEN 1 ELSE 0 END, c.tape_order ASC, c.id ASC,
               TRY_CAST(r.room_number AS INT) ASC, r.room_number ASC
    `);

  const bookingsResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('startDate', sql.Date, startDate)
    .input('endDate', sql.Date, endDate)
    .query(`
      -- One row per ROOM of a booking, not per booking: each room has its own
      -- dates and status, and the chart draws a strip per room. The id column
      -- is still the booking's, so every strip of one booking opens the same record.
      SELECT b.id, br.room_id, br.id AS booking_room_id, b.guest_name, b.guest_phone, b.id_proof_number,
             br.check_in_date, br.check_out_date, br.status, br.total_price,
             (SELECT COUNT(*) FROM dbo.booking_rooms x WHERE x.booking_id = b.id AND x.status <> 'CANCELLED') AS room_count,
             -- The beds this booking holds in THIS room (bed_id plus the
             -- booking_beds extras, which can sit in any of its rooms), id
             -- order. Same CHAR(31)-joined shape as the co-guest lists below.
             (SELECT STRING_AGG(CAST(v.bed_id AS NVARCHAR(20)), CHAR(31)) WITHIN GROUP (ORDER BY v.bed_id)
              FROM (SELECT b.bed_id AS bed_id WHERE b.bed_id IS NOT NULL
                    UNION SELECT bb.bed_id FROM dbo.booking_beds bb WHERE bb.booking_id = b.id) v
              JOIN dbo.dormitory_beds vdb ON vdb.id = v.bed_id
              WHERE vdb.room_id = br.room_id) AS bed_ids,
             (SELECT STRING_AGG(vdb.bed_label, CHAR(31)) WITHIN GROUP (ORDER BY v.bed_id)
              FROM (SELECT b.bed_id AS bed_id WHERE b.bed_id IS NOT NULL
                    UNION SELECT bb.bed_id FROM dbo.booking_beds bb WHERE bb.booking_id = b.id) v
              JOIN dbo.dormitory_beds vdb ON vdb.id = v.bed_id
              WHERE vdb.room_id = br.room_id) AS bed_labels,
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
      FROM dbo.booking_rooms br
      JOIN dbo.bookings b ON b.id = br.booking_id
      -- The issued bill, if the stay has been billed. OUTER APPLY rather than a
      -- join so an unbilled stay still draws — most of the chart is unbilled.
      OUTER APPLY (
        SELECT TOP 1 invoice_number FROM dbo.invoices
        WHERE booking_id = b.id AND status = 'ISSUED'
        ORDER BY created_at DESC
      ) i
      WHERE b.lodge_id = @lodgeId AND br.status IN ('BOOKED', 'CHECKED_IN', 'CHECKED_OUT')
        AND br.check_in_date < @endDate AND br.check_out_date > @startDate
      ORDER BY br.check_in_date ASC, br.id ASC
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
      SELECT b.id, br.room_id, b.guest_name, br.check_in_date, br.check_out_date,
             b.cancelled_at, b.refund_amount, b.cancellation_charge
      FROM dbo.booking_rooms br
      JOIN dbo.bookings b ON b.id = br.booking_id
      WHERE b.lodge_id = @lodgeId AND b.status = 'CANCELLED'
        AND br.check_in_date < @endDate AND br.check_out_date > @startDate
      ORDER BY br.check_in_date ASC, br.id ASC
    `);

  return {
    rooms: roomsResult.recordset.map((r) => ({
      id: r.id,
      roomNumber: r.room_number,
      floor: r.floor,
      categoryName: r.category_name,
      isDormitory: !!r.is_dormitory,
      dormitoryGender: r.dormitory_gender,
      dormitoryIsAc: r.dormitory_is_ac,
      // How many beds the chart has to fan a room's occupancy across — only
      // meaningful when isDormitory, 0 on every other room (the aggregate
      // subquery finds nothing for a room with no dormitory_beds rows).
      dormitoryBedCount: Number(r.bed_count),
    })),
    drafts,
    bookings: bookingsResult.recordset.map((b) => ({
      id: b.id,
      roomId: b.room_id,
      bookingRoomId: b.booking_room_id,
      // How many rooms the booking holds, so a strip can say it is one of
      // several without the chart fetching the booking.
      roomCount: Number(b.room_count),
      // Every bed this booking holds in this room, id order — [] on a
      // whole-room or non-dormitory booking. The chart uses this to count
      // occupied beds instead of counting booking rows, which undercounts a
      // multi-bed one.
      bedId: b.bed_ids ? Number(b.bed_ids.split('\u001f')[0]) : null,
      bedLabel: b.bed_labels ? b.bed_labels.split('\u001f')[0] : null,
      bedIds: b.bed_ids ? b.bed_ids.split('\u001f').map(Number) : [],
      bedLabels: b.bed_labels ? b.bed_labels.split('\u001f') : [],
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
    // Every room the booking holds — roomId/roomNumber/categoryName above are
    // the first of them, kept for the screens that only know one. Only
    // getBooking loads them; a booking mapped by a list endpoint has none.
    rooms: extra.rooms ?? [],
    roomCount: extra.rooms ? extra.rooms.length : 1,
    roomNumbers: extra.rooms ? extra.rooms.map((r) => r.roomNumber).join(', ') : row.room_number,
    // How many the room sleeps, so check-in can say something when the party
    // that turned up outgrows it. Advice, not a limit — the desk decides, and
    // NULL wherever the property never recorded one. Across all the booking's
    // rooms when it has several.
    roomMaxOccupancy: extra.rooms
      ? extra.rooms.reduce((sum, r) => sum + (r.maxOccupancy ?? 0), 0) || null
      : row.max_occupancy ?? null,
    isDormitory: !!row.is_dormitory,
    // The first (or only) bed this booking holds, on a dormitory room — NULL
    // on every other booking, and on a dormitory room deliberately how a
    // buyout reads: the whole room, no single bed. Kept for every screen
    // that only ever needed one; bedIds/bedLabels below are the full list.
    bedId: row.bed_id ?? null,
    bedLabel: row.bed_label ?? null,
    // Every bed this booking holds — [] on a whole-room or non-dormitory
    // booking, [bedId] for the common single-bed case, more for a multi-bed
    // one. extra.extraBeds is only populated by getBooking (the one caller
    // that queries booking_beds); every other mapBooking caller leaves it
    // out and gets back just [bedId], which is correct for them too.
    bedIds: [
      ...(row.bed_id != null ? [row.bed_id] : []),
      ...(extra.extraBeds || []).map((b) => b.id),
    ],
    bedLabels: [
      ...(row.bed_label != null ? [row.bed_label] : []),
      ...(extra.extraBeds || []).map((b) => b.bedLabel),
    ],
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
    // Food this stay has ordered (room service, plus table food added to the room bill).
    foodOrders: extra.foodOrders ?? [],
    serviceUsages: extra.serviceUsages ?? [],
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
    const key = `${row.guest_name} ${row.guest_phone}`;
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
      SELECT b.*, r.room_number, r.max_occupancy, r.is_dormitory, c.name AS category_name,
             l.serves_food, l.food_room_service, db.bed_label
      FROM dbo.bookings b
      JOIN dbo.rooms r ON r.id = b.room_id
      JOIN dbo.room_categories c ON c.id = r.category_id
      JOIN dbo.lodges l ON l.id = b.lodge_id
      LEFT JOIN dbo.dormitory_beds db ON db.id = b.bed_id
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
  // Every room label currently locked out in this lodge — a booking of several
  // rooms has a PIN, and so a lockout, per room, and it is a short list.
  const lockoutResult = takesRoomOrders
    ? await pool
        .request()
        .input('lodgeId', sql.BigInt, lodgeId)
        .query(`
          SELECT room_label, locked_until FROM dbo.food_pin_lockouts
          WHERE lodge_id = @lodgeId
            AND locked_until IS NOT NULL AND locked_until > SYSDATETIMEOFFSET()
        `)
    : { recordset: [] };
  const lockedUntilOf = (roomNumber) =>
    lockoutResult.recordset.find((l) => String(l.room_label) === String(roomNumber))?.locked_until ?? null;

  const availableSwitchableCharges = await getActiveSwitchableCharges(pool, lodgeId);

  // Every bed beyond bed_id, for a multi-bed booking — empty for every
  // other kind, same as the tape chart's own extra_bed_ids/labels.
  const extraBedsResult = await pool
    .request()
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT bb.bed_id, db.bed_label
      FROM dbo.booking_beds bb
      JOIN dbo.dormitory_beds db ON db.id = bb.bed_id
      WHERE bb.booking_id = @bookingId
      ORDER BY bb.id ASC
    `);

  // The rooms of the booking, each with its own dates, status, price, extras
  // and beds. A cancelled booking keeps showing the rooms it had.
  const bookingRoomsResult = await pool
    .request()
    .input('bookingId', sql.BigInt, bookingId)
    .input('includeCancelled', sql.Bit, row.status === 'CANCELLED' ? 1 : 0)
    .query(`
      SELECT br.id, br.room_id, r.room_number, r.max_occupancy, r.is_dormitory, c.name AS category_name,
             br.check_in_date, br.check_out_date, br.status, br.actual_check_in_at, br.actual_check_out_at,
             br.base_price_override, br.total_price, br.discount_amount, br.nightly_breakdown,
             br.late_checkout_charge, br.late_checkout_minutes, br.food_pin
      FROM dbo.booking_rooms br
      JOIN dbo.rooms r ON r.id = br.room_id
      JOIN dbo.room_categories c ON c.id = r.category_id
      WHERE br.booking_id = @bookingId AND (br.status <> 'CANCELLED' OR @includeCancelled = 1)
      ORDER BY br.id ASC
    `);
  const roomChargesResult = await pool
    .request()
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT brsc.booking_room_id, sc.id, sc.name, sc.charge_per_night, brsc.quantity, brsc.agreed_amount
      FROM dbo.booking_room_switchable_charges brsc
      JOIN dbo.booking_rooms br ON br.id = brsc.booking_room_id
      JOIN dbo.switchable_charges sc ON sc.id = brsc.charge_id
      WHERE br.booking_id = @bookingId
    `);
  const allBedsResult = await pool
    .request()
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT db.id, db.bed_label, db.room_id
      FROM (SELECT bed_id FROM dbo.bookings WHERE id = @bookingId AND bed_id IS NOT NULL
            UNION SELECT bed_id FROM dbo.booking_beds WHERE booking_id = @bookingId) v
      JOIN dbo.dormitory_beds db ON db.id = v.bed_id
      ORDER BY db.id ASC
    `);
  const rooms = bookingRoomsResult.recordset.map((br) => {
    const beds = allBedsResult.recordset.filter((b) => Number(b.room_id) === Number(br.room_id));
    return {
      bookingRoomId: br.id,
      roomId: br.room_id,
      roomNumber: br.room_number,
      categoryName: br.category_name,
      maxOccupancy: br.max_occupancy ?? null,
      isDormitory: !!br.is_dormitory,
      bedIds: beds.map((b) => b.id),
      bedLabels: beds.map((b) => b.bed_label),
      checkInDate: toIsoDate(br.check_in_date),
      checkOutDate: toIsoDate(br.check_out_date),
      status: br.status,
      actualCheckInAt: br.actual_check_in_at,
      actualCheckOutAt: br.actual_check_out_at,
      basePriceOverride: br.base_price_override != null ? Number(br.base_price_override) : null,
      totalPrice: Number(br.total_price),
      discountAmount: Number(br.discount_amount ?? 0),
      grossTotalPrice: round2(Number(br.total_price) + Number(br.discount_amount ?? 0)),
      roomCharges: billingService.roomChargeLines(br),
      nights: nightlyLines(br),
      lateCheckoutCharge: Number(br.late_checkout_charge ?? 0),
      lateCheckoutMinutes: br.late_checkout_minutes ?? null,
      foodPin: takesRoomOrders ? br.food_pin ?? null : null,
      foodOrderingLockedUntil: lockedUntilOf(br.room_number),
      switchableCharges: roomChargesResult.recordset
        .filter((c) => Number(c.booking_room_id) === Number(br.id))
        .map((c) => ({
          id: c.id,
          name: c.name,
          chargePerNight: Number(c.charge_per_night),
          agreedAmount: c.agreed_amount == null ? null : Number(c.agreed_amount),
          quantity: Number(c.quantity ?? 1),
        })),
    };
  });

  // Food this stay has ordered: room service, and table or takeaway food the desk
  // moved onto the room bill. Shown in the booking details so the desk can see
  // what is about to land on the bill. Cancelled orders are left out.
  const foodOrdersResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT o.id, o.order_number, o.source, o.status, o.subtotal, o.placed_at, o.on_room_bill, o.invoice_id,
             t.label AS table_label
      FROM dbo.food_orders o
      LEFT JOIN dbo.dining_tables t ON t.id = o.table_id
      WHERE o.lodge_id = @lodgeId AND o.booking_id = @bookingId AND o.status <> 'CANCELLED'
      ORDER BY o.placed_at ASC
    `);
  const foodItemsResult = foodOrdersResult.recordset.length
    ? await (() => {
        const req = pool.request();
        foodOrdersResult.recordset.forEach((o, i) => req.input(`fo${i}`, sql.BigInt, o.id));
        return req.query(`
          SELECT order_id, item_name, quantity, line_total
          FROM dbo.food_order_items
          WHERE order_id IN (${foodOrdersResult.recordset.map((_, i) => `@fo${i}`).join(', ')})
          ORDER BY id ASC
        `);
      })()
    : { recordset: [] };
  const foodOrders = foodOrdersResult.recordset.map((o) => ({
    id: o.id,
    orderNumber: o.order_number,
    // Room service ordered from the room, or food from a table / takeaway that
    // the desk added to this stay's bill.
    origin: o.source === 'ROOM' ? 'ROOM_SERVICE' : 'ADDED',
    placedFrom: o.source === 'TABLE' ? o.table_label : o.source === 'COUNTER' ? 'Takeaway' : null,
    status: o.status,
    subtotal: Number(o.subtotal),
    placedAt: o.placed_at,
    billed: o.invoice_id != null,
    // Only food the desk has deliberately added counts on the room bill.
    onRoomBill: !!o.on_room_bill,
    items: foodItemsResult.recordset
      .filter((i) => String(i.order_id) === String(o.id))
      .map((i) => ({ name: i.item_name, quantity: i.quantity, lineTotal: Number(i.line_total) })),
  }));

  // Other services (spa, laundry, ...) used on this stay, shown beside food so the
  // desk sees what is about to land on the room bill. Cancelled uses are left out.
  const serviceUsagesResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT id, service_name, unit_label, quantity, line_total, status, on_room_bill, invoice_id, started_at
      FROM dbo.service_usages
      WHERE lodge_id = @lodgeId AND booking_id = @bookingId AND status <> 'CANCELLED'
      ORDER BY started_at ASC
    `);
  const serviceUsages = serviceUsagesResult.recordset.map((u) => ({
    id: u.id,
    name: u.service_name,
    unitLabel: u.unit_label,
    quantity: Number(u.quantity),
    amount: Number(u.line_total),
    status: u.status,
    billed: u.invoice_id != null,
    onRoomBill: !!u.on_room_bill,
    startedAt: u.started_at,
  }));

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
    foodOrders,
    serviceUsages,
    availableSwitchableCharges,
    foodOrderingLockedUntil: lockedUntilOf(row.room_number),
    extraBeds: extraBedsResult.recordset.map((r) => ({ id: r.bed_id, bedLabel: r.bed_label })),
    rooms,
  });
}

async function createBooking(lodgeId, userId, input) {
  const pool = await getPool();

  const rooms = normalizeRoomInputs(input);
  const roomRows = await loadAndCheckRooms(pool, lodgeId, rooms);

  // Extras are per room. One list of everything asked for is enough to check
  // the lodge still offers each.
  await assertChargesAvailable(
    pool,
    lodgeId,
    rooms.flatMap((r) => r.switchableCharges)
  );

  // A party can't outgrow the rooms it booked by more than the desk allows, but
  // the desk decides that; this only refuses the plainly impossible.
  const takenMessage = (room) =>
    room.bedIds.length > 0
      ? 'That bed is already booked for part of that date range.'
      : `Room ${roomRows.get(room.roomId).room_number} is already booked for part of that date range.`;

  // Pre-flight, deliberately unlocked: it rejects the common case before the
  // pricing work below without holding a lock across it. The check that decides
  // the outcome is the one inside the transaction.
  for (const room of rooms) {
    if (
      await hasOverlap(() => pool.request(), room.roomId, room.checkInDate, room.checkOutDate, undefined, {
        bedIds: room.bedIds,
      })
    ) {
      throw new ApiError(takenMessage(room), 409);
    }
  }

  const requestedDiscount = input.discountAmount ?? 0;

  const priced = await priceBooking(lodgeId, rooms, requestedDiscount);
  const { totalPrice, discountAmount, grossTotal } = priced;

  // priceBooking clamps for the sake of the live quote; a save is a decision, so
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
    for (const room of rooms) {
      const conflict = await hasOverlap(
        () => new sql.Request(transaction),
        room.roomId,
        room.checkInDate,
        room.checkOutDate,
        undefined,
        { lock: true, bedIds: room.bedIds }
      );
      if (conflict) {
        throw new ApiError(takenMessage(room), 409);
      }
    }

    // The booking row is written with the roll-up of its rooms already; the
    // sync below re-derives it from the rows so the two can't drift.
    const first = priced.rooms[0];
    const insertResult = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('roomId', sql.BigInt, first.roomId)
      .input('guestName', sql.NVarChar, input.guestName)
      .input('guestPhone', sql.NVarChar, input.guestPhone)
      .input('numGuests', sql.Int, input.numGuests)
      .input('idProofType', sql.NVarChar, input.idProofType ?? null)
      .input('idProofNumber', sql.NVarChar, input.idProofNumber ?? null)
      .input('idProofDocument', sql.NVarChar, input.idProofDocument ?? null)
      .input('checkInDate', sql.Date, first.checkInDate)
      .input('checkOutDate', sql.Date, first.checkOutDate)
      .input('totalPrice', sql.Decimal(10, 2), totalPrice)
      .input('discountAmount', sql.Decimal(10, 2), discountAmount)
      .input('nightlyBreakdown', sql.NVarChar(sql.MAX), JSON.stringify(first.nights))
      .input('createdBy', sql.BigInt, userId ?? null)
      .input('advanceAmount', sql.Decimal(10, 2), input.advanceAmount ?? null)
      .input('advancePaymentMethod', sql.NVarChar, input.advancePaymentMethod ?? null)
      .input('advanceReference', sql.NVarChar, input.advanceReference ?? null)
      .input('basePriceOverride', sql.Decimal(10, 2), first.basePriceOverride ?? null)
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

    for (const room of priced.rooms) {
      await insertBookingRoom(transaction, bookingId, room);
    }
    await writeBookingBeds(
      transaction,
      lodgeId,
      bookingId,
      rooms.flatMap((r) => r.bedIds)
    );
    await syncBookingFromRooms(transaction, bookingId);

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

// Checks in every room of the booking whose date has come, or just `roomId`
// when the desk is bringing rooms in one at a time. A room dated for later stays
// BOOKED, so a party arriving in stages checks in stage by stage.
async function checkIn(lodgeId, bookingId, input, userId = null, { roomId = null } = {}) {
  const pool = await getPool();

  const bookingResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT b.num_guests, b.id_proof_type, b.total_price, b.advance_amount,
             l.serves_food, l.food_room_service
      FROM dbo.bookings b
      JOIN dbo.lodges l ON l.id = b.lodge_id
      WHERE b.id = @bookingId AND b.lodge_id = @lodgeId AND b.status IN ('BOOKED', 'CHECKED_IN')
    `);
  const bookingRow = bookingResult.recordset[0];
  if (!bookingRow) {
    throw new ApiError('Booking not found or not ready for check-in.', 409);
  }

  const waitingResult = await pool
    .request()
    .input('bookingId', sql.BigInt, bookingId)
    .input('roomId', sql.BigInt, roomId)
    .query(`
      SELECT br.id, br.room_id, br.check_in_date, r.room_number
      FROM dbo.booking_rooms br
      JOIN dbo.rooms r ON r.id = br.room_id
      WHERE br.booking_id = @bookingId AND br.status = 'BOOKED'
        AND (@roomId IS NULL OR br.room_id = @roomId)
      ORDER BY br.id
    `);
  if (waitingResult.recordset.length === 0) {
    throw new ApiError('Booking not found or not ready for check-in.', 409);
  }

  // A pre-reservation holds the room for a future date — it can't be
  // checked in early, only from its reserved date onward. A walk-in is
  // always booked for today, so this never blocks the common case. Each room
  // has its own date, so only the rooms whose day has come are taken in.
  const today = todayIsoIST();
  const arriving = waitingResult.recordset.filter((r) => toIsoDate(r.check_in_date) <= today);
  if (arriving.length === 0) {
    throw new ApiError('This booking is for a future date — check-in opens on the reserved date.', 409);
  }

  // Every bed the booking holds, with the room it is in.
  const ownBedsResult = await pool
    .request()
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT db.id, db.room_id
      FROM (SELECT bed_id FROM dbo.booking_beds WHERE booking_id = @bookingId
            UNION SELECT bed_id FROM dbo.bookings WHERE id = @bookingId AND bed_id IS NOT NULL) v
      JOIN dbo.dormitory_beds db ON db.id = v.bed_id
    `);

  // The date ranges not overlapping was already enforced when this booking was
  // made — but that only promises the room by the *reserved* checkout date.
  // A guest who overstays leaves the room physically occupied past that date,
  // so the next party can't actually walk in yet even though their own
  // reservation is valid. This is the same case a hotel desk calls "room not
  // vacated" — check-in has to wait for the previous occupant's real checkout,
  // not just their booked one.
  // A dormitory's beds turn over one at a time, so another guest still
  // checked in on a *different* bed doesn't block this one — only someone
  // still in this booking's own bed(s), or a whole-room buyout, does. Same
  // bed-vs-room rule hasOverlap uses for the date clash check.
  for (const room of arriving) {
    const ownBedIds = ownBedsResult.recordset
      .filter((b) => Number(b.room_id) === Number(room.room_id))
      .map((b) => Number(b.id));
    const bedClause =
      ownBedIds.length > 0
        ? `b.bed_id IS NULL OR b.bed_id IN (${ownBedIds.join(',')}) OR EXISTS (
             SELECT 1 FROM dbo.booking_beds bb WHERE bb.booking_id = b.id AND bb.bed_id IN (${ownBedIds.join(',')})
           )`
        : '1 = 1';
    const stillOccupiedResult = await pool
      .request()
      .input('roomId', sql.BigInt, room.room_id)
      .input('bookingId', sql.BigInt, bookingId)
      .query(`
        SELECT TOP 1 br.id FROM dbo.booking_rooms br
        JOIN dbo.bookings b ON b.id = br.booking_id
        WHERE br.room_id = @roomId AND br.booking_id <> @bookingId AND br.status = 'CHECKED_IN'
          AND (${bedClause})
      `);
    if (stillOccupiedResult.recordset.length > 0) {
      throw new ApiError(
        `Room ${room.room_number}’s current guest hasn’t checked out yet — check them out before checking in the next booking.`,
        409
      );
    }
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

  // Every PIN currently live in this lodge, so the new ones can't collide with
  // a room that's still checked in.
  const takenPins = takesRoomOrders
    ? new Set(
        (
          await pool
            .request()
            .input('lodgeId', sql.BigInt, lodgeId)
            .query(`
              SELECT br.food_pin FROM dbo.booking_rooms br
              JOIN dbo.bookings b ON b.id = br.booking_id
              WHERE b.lodge_id = @lodgeId AND br.food_pin IS NOT NULL
            `)
        ).recordset.map((r) => r.food_pin)
      )
    : null;

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
      .query(`
        UPDATE dbo.bookings
        SET num_guests = @numGuests,
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
        WHERE id = @bookingId AND lodge_id = @lodgeId AND status IN ('BOOKED', 'CHECKED_IN')
      `);
    if (result.recordset.length === 0) {
      throw new ApiError('Booking not found or not ready for check-in.', 409);
    }

    for (const room of arriving) {
      // A PIN only where a guest could actually use one. A rooms-only property
      // has no kitchen and no QR to scan, so a PIN there is a number reception
      // reads out for nothing — and one more secret sitting in the database.
      const pin = takesRoomOrders ? newFoodPin(takenPins) : null;
      if (pin) takenPins.add(pin);
      const roomResult = await new sql.Request(transaction)
        .input('id', sql.BigInt, room.id)
        .input('foodPin', sql.NVarChar, pin)
        .query(`
          UPDATE dbo.booking_rooms
          SET status = 'CHECKED_IN', actual_check_in_at = SYSDATETIMEOFFSET(), food_pin = @foodPin
          OUTPUT inserted.id
          WHERE id = @id AND status = 'BOOKED'
        `);
      if (roomResult.recordset.length === 0) {
        throw new ApiError('Booking not found or not ready for check-in.', 409);
      }
    }
    await syncBookingFromRooms(transaction, bookingId);

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
//
// Per room, because each room has its own dates and its own arrival. Without a
// roomId it answers for the room the booking is most "live" in: the first one
// checked in, else the first one.
async function getLateCheckout(lodgeId, bookingId, at = new Date(), roomId = null) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .input('roomId', sql.BigInt, roomId)
    .query(`
      SELECT TOP 1 br.id AS booking_room_id, br.room_id, r.room_number,
             br.check_in_date, br.check_out_date, br.actual_check_in_at, br.status,
             br.total_price, br.nightly_breakdown, br.late_checkout_charge,
             l.checkin_mode, l.check_out_time, l.check_in_time, l.late_grace_minutes,
             l.late_half_day_percent, l.late_full_day_after_minutes, l.late_full_day_percent
      FROM dbo.booking_rooms br
      JOIN dbo.bookings b ON b.id = br.booking_id
      JOIN dbo.rooms r ON r.id = br.room_id
      JOIN dbo.lodges l ON l.id = b.lodge_id
      WHERE br.booking_id = @bookingId AND b.lodge_id = @lodgeId AND br.status <> 'CANCELLED'
        AND (@roomId IS NULL OR br.room_id = @roomId)
      ORDER BY CASE WHEN br.status = 'CHECKED_IN' THEN 0 ELSE 1 END, br.id
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
    // Which room this answer is for.
    roomId: row.room_id,
    roomNumber: row.room_number,
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
    appliedCharge: Number(row.late_checkout_charge ?? 0),
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

// Checks out one room (roomId) or every room still in. lateCharge is whatever
// reception decided, including 0 for "waived" — it is never recomputed from the
// policy here. The policy only ever produced a suggestion, and overriding it is
// the entire point of asking. Checking several rooms out in one go books a
// single figure against the first of them; the desk that wants one per room
// checks them out one at a time.
//
// The booking becomes CHECKED_OUT — and billable — only when its last room
// leaves; syncBookingFromRooms derives that.
async function checkOut(lodgeId, bookingId, { lateCharge = 0, roomId = null } = {}) {
  const pool = await getPool();

  const inHouseResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .input('roomId', sql.BigInt, roomId)
    .query(`
      SELECT br.id, br.room_id
      FROM dbo.booking_rooms br
      JOIN dbo.bookings b ON b.id = br.booking_id
      WHERE br.booking_id = @bookingId AND b.lodge_id = @lodgeId AND br.status = 'CHECKED_IN'
        AND (@roomId IS NULL OR br.room_id = @roomId)
      ORDER BY br.id
    `);
  if (inHouseResult.recordset.length === 0) {
    throw new ApiError('Booking not found or not checked in.', 409);
  }

  // Read before write so the minutes are recorded against the same moment the
  // charge was agreed for, rather than a later one — and before the transaction
  // opens, so these reads on the pool can't wait on rows it has locked.
  const at = new Date();
  const lateByRoom = [];
  for (const room of inHouseResult.recordset) {
    lateByRoom.push(await getLateCheckout(lodgeId, bookingId, at, room.room_id));
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    let first = true;
    for (const [index, room] of inHouseResult.recordset.entries()) {
      const late = lateByRoom[index];
      const result = await new sql.Request(transaction)
        .input('id', sql.BigInt, room.id)
        .input('lateCharge', sql.Decimal(10, 2), first ? round2(Number(lateCharge) || 0) : 0)
        .input('lateMinutes', sql.Int, late.minutesLate)
        .query(`
          UPDATE dbo.booking_rooms
          SET status = 'CHECKED_OUT', actual_check_out_at = SYSDATETIMEOFFSET(),
              late_checkout_charge = @lateCharge,
              late_checkout_minutes = @lateMinutes,
              -- Clearing the PIN is what closes in-room ordering. The QR on the
              -- wall stays valid for the *room*; it just stops accepting orders
              -- until the next guest checks in and gets their own PIN.
              food_pin = NULL
          OUTPUT inserted.id
          WHERE id = @id AND status = 'CHECKED_IN'
        `);
      if (result.recordset.length === 0) {
        throw new ApiError('Booking not found or not checked in.', 409);
      }
      first = false;
    }
    await syncBookingFromRooms(transaction, bookingId);
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
  return getBooking(lodgeId, bookingId);
}

/// A booking stays editable for its whole life, not just at creation — a
// guest might extend their stay, ask to switch rooms, add someone to the
// party, or the front desk just mistyped a phone number. The only hard
// stop is an issued invoice: once a bill is cut the stay is frozen,
// matching billing's own "already invoiced" guard on issueInvoice. A room that
// has checked out can no longer be moved, re-dated or re-bedded — there is no
// "stay" left in it — but its extras can still be corrected. The check-in date
// is narrower still: only a room that hasn't been checked in yet can be moved,
// because once a guest is in the room the day they arrived is a recorded fact
// rather than a plan. Re-dating a reservation is an ordinary desk correction;
// re-dating a stay already under way is a cancel-and-rebook.
//
// The rooms are sent as a list (`rooms`) and reconciled against what the booking
// holds: a room already on the booking is updated (matched by bookingRoomId, else
// by roomId), a room not on it is added, and a room left out is removed. Fields a
// room doesn't carry keep their current value. The older flat roomId / bedIds /
// switchableCharges / dates are still accepted and act on the first room (dates on
// all of them), so a client that only knows one room keeps working.
async function updateBooking(lodgeId, bookingId, input, userId = null) {
  const pool = await getPool();

  const bookingResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT status, num_guests, guest_name, guest_phone, discount_amount, advance_amount
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

  // What the booking holds today: its rooms, the beds in each and each room's extras.
  const currentRooms = (
    await pool
      .request()
      .input('bookingId', sql.BigInt, bookingId)
      .query(`
        SELECT br.id, br.room_id, r.room_number, br.check_in_date, br.check_out_date, br.status,
               br.base_price_override
        FROM dbo.booking_rooms br
        JOIN dbo.rooms r ON r.id = br.room_id
        WHERE br.booking_id = @bookingId AND br.status <> 'CANCELLED'
        ORDER BY br.id
      `)
  ).recordset;
  if (currentRooms.length === 0) {
    throw new ApiError('Booking not found.', 404);
  }
  const currentBeds = (
    await pool
      .request()
      .input('bookingId', sql.BigInt, bookingId)
      .query(`
        SELECT db.id, db.room_id
        FROM (SELECT bed_id FROM dbo.booking_beds WHERE booking_id = @bookingId
              UNION SELECT bed_id FROM dbo.bookings WHERE id = @bookingId AND bed_id IS NOT NULL) v
        JOIN dbo.dormitory_beds db ON db.id = v.bed_id
        ORDER BY db.id
      `)
  ).recordset;
  const currentCharges = (
    await pool
      .request()
      .input('bookingId', sql.BigInt, bookingId)
      .query(`
        SELECT x.booking_room_id, x.charge_id, x.quantity, x.agreed_amount
        FROM dbo.booking_room_switchable_charges x
        JOIN dbo.booking_rooms br ON br.id = x.booking_room_id
        WHERE br.booking_id = @bookingId
      `)
  ).recordset;
  for (const room of currentRooms) {
    room.beds = currentBeds.filter((b) => Number(b.room_id) === Number(room.room_id)).map((b) => Number(b.id));
    room.charges = currentCharges
      .filter((c) => Number(c.booking_room_id) === Number(room.id))
      .map((c) => ({
        id: Number(c.charge_id),
        quantity: Number(c.quantity),
        // Carried forward so an edit that does not touch the extras cannot
        // silently reprice them to the lodge's current rate.
        agreedAmount: c.agreed_amount == null ? undefined : Number(c.agreed_amount),
      }));
  }
  const byBookingRoomId = new Map(currentRooms.map((r) => [Number(r.id), r]));
  const byRoomId = new Map(currentRooms.map((r) => [Number(r.room_id), r]));

  const bedsGiven = input.bedIds !== undefined || input.bedId !== undefined;
  const flatBeds = (r) =>
    Array.from(new Set((r.bedIds && r.bedIds.length > 0 ? r.bedIds : r.bedId != null ? [r.bedId] : []).map(Number)));

  let requested;
  if (input.rooms && input.rooms.length > 0) {
    requested = input.rooms;
  } else {
    requested = currentRooms.map((r) => ({ bookingRoomId: Number(r.id), roomId: Number(r.room_id) }));
    const primary = requested[0];
    if (input.roomId != null) primary.roomId = input.roomId;
    if (bedsGiven) primary.bedIds = flatBeds(input);
    if (input.basePriceOverride !== undefined) primary.basePriceOverride = input.basePriceOverride;
    if (input.switchableCharges != null) primary.switchableCharges = input.switchableCharges;
    for (const r of requested) {
      if (input.checkInDate != null) r.checkInDate = input.checkInDate;
      if (input.checkOutDate != null) r.checkOutDate = input.checkOutDate;
    }
  }

  const defaultCheckIn = input.checkInDate ?? toIsoDate(currentRooms[0].check_in_date);
  const defaultCheckOut = input.checkOutDate ?? toIsoDate(currentRooms[0].check_out_date);

  const seenRoomIds = new Set();
  const matched = new Set();
  const resolved = requested.map((d) => {
    const match =
      d.bookingRoomId != null ? byBookingRoomId.get(Number(d.bookingRoomId)) : byRoomId.get(Number(d.roomId));
    if (d.bookingRoomId != null && !match) {
      throw new ApiError('One of those rooms isn’t on this booking.', 400);
    }
    if (match) {
      if (matched.has(Number(match.id))) {
        throw new ApiError('A room can only be added to a booking once.', 400);
      }
      matched.add(Number(match.id));
    }
    const roomId = Number(d.roomId ?? match?.room_id);
    if (seenRoomIds.has(roomId)) {
      throw new ApiError('A room can only be added to a booking once.', 400);
    }
    seenRoomIds.add(roomId);

    const checkInDate = d.checkInDate ?? (match ? toIsoDate(match.check_in_date) : defaultCheckIn);
    const checkOutDate = d.checkOutDate ?? (match ? toIsoDate(match.check_out_date) : defaultCheckOut);
    if (checkOutDate <= checkInDate) {
      throw new ApiError('Check-out date must be after check-in date.', 400);
    }

    const sameRoom = match && Number(match.room_id) === roomId;
    const bedIds =
      d.bedIds !== undefined || d.bedId !== undefined ? flatBeds(d) : sameRoom ? match.beds : [];
    const bedsChanged =
      !match || !sameRoom || bedIds.length !== match.beds.length || bedIds.some((id) => !match.beds.includes(id));
    const moved =
      !match ||
      !sameRoom ||
      checkInDate !== toIsoDate(match.check_in_date) ||
      checkOutDate !== toIsoDate(match.check_out_date) ||
      bedsChanged;

    if (match && moved && match.status === 'CHECKED_OUT') {
      throw new ApiError(
        `Room ${match.room_number} is already checked out — only extras can still be edited.`,
        409
      );
    }
    // A guest standing in the room arrived on a particular day, and that day is
    // now part of the record — the folio, the register and any receipt already
    // raised all read from it. Sending the same date back is not a change, so a
    // form that posts every field it shows keeps working on a checked-in stay.
    if (match && checkInDate !== toIsoDate(match.check_in_date) && match.status !== 'BOOKED') {
      throw new ApiError(
        'The guest has already checked in — the check-in date can’t be changed. Cancel and rebook instead.',
        409
      );
    }

    return {
      bookingRoomId: match ? Number(match.id) : null,
      roomId,
      checkInDate,
      checkOutDate,
      bedIds,
      moved,
      // Absent leaves the agreed rate as it is — a save that only moves the
      // dates must not quietly re-price the stay at rack rate. Blank arrives as
      // null and puts it back on the category's own price.
      basePriceOverride:
        d.basePriceOverride !== undefined
          ? d.basePriceOverride
          : match?.base_price_override != null
            ? Number(match.base_price_override)
            : null,
      switchableCharges:
        d.switchableCharges != null
          ? pricingService.normalizeSelections(d.switchableCharges)
          : match
            ? match.charges
            : [],
      extrasGiven: d.switchableCharges != null,
    };
  });

  const removed = currentRooms.filter((r) => !matched.has(Number(r.id)));
  for (const room of removed) {
    if (room.status !== 'BOOKED') {
      throw new ApiError(
        `Room ${room.room_number} has already checked in — check it out rather than removing it.`,
        409
      );
    }
  }
  if (resolved.length === 0) {
    throw new ApiError('A booking needs at least one room.', 400);
  }

  // Only what is new or moving has to be a valid room with valid beds — a room
  // left as it was (a dormitory booked before beds were required, say) is not
  // made to pick one just because something else was edited.
  const roomRows = await loadAndCheckRooms(
    pool,
    lodgeId,
    resolved.filter((r) => r.moved)
  );
  await assertChargesAvailable(
    pool,
    lodgeId,
    resolved.filter((r) => r.extrasGiven).flatMap((r) => r.switchableCharges)
  );

  const takenMessage = (room) =>
    room.bedIds.length > 0
      ? 'That bed is already booked for part of this date range.'
      : `Room ${roomRows.get(room.roomId).room_number} is already booked for part of this date range.`;

  // Whether this edit can free or take a night. An edit that only corrects a
  // phone number moves no dates and needs no availability check at all.
  //
  // Pre-flight only — see the matching note in createBooking. The binding check
  // is inside the transaction below, because everything between here and there
  // (guest list, charges, pricing) is several round trips during which another
  // clerk can take the room.
  for (const room of resolved.filter((r) => r.moved)) {
    if (
      await hasOverlap(() => pool.request(), room.roomId, room.checkInDate, room.checkOutDate, bookingId, {
        bedIds: room.bedIds,
      })
    ) {
      throw new ApiError(takenMessage(room), 409);
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

  // Omitted means "keep the concession that was agreed" — an edit that only
  // moves the checkout date must not quietly charge the guest full price
  // again. An explicit 0 is how reception takes a concession back.
  const requestedDiscount =
    input.discountAmount === undefined
      ? Number(bookingRow.discount_amount ?? 0)
      : input.discountAmount;

  const priced = await priceBooking(lodgeId, resolved, requestedDiscount);
  const { totalPrice, discountAmount, grossTotal } = priced;

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
    for (const room of resolved.filter((r) => r.moved)) {
      const conflict = await hasOverlap(
        () => new sql.Request(transaction),
        room.roomId,
        room.checkInDate,
        room.checkOutDate,
        bookingId,
        { lock: true, bedIds: room.bedIds }
      );
      if (conflict) {
        throw new ApiError(takenMessage(room), 409);
      }
    }

    // Rooms taken off the booking go first, so a room swapped for another in
    // the same edit never trips the one-row-per-room rule.
    for (const room of removed) {
      await new sql.Request(transaction)
        .input('id', sql.BigInt, room.id)
        .query(`
          DELETE FROM dbo.booking_room_switchable_charges WHERE booking_room_id = @id;
          DELETE FROM dbo.booking_rooms WHERE id = @id;
        `);
    }

    for (const room of priced.rooms) {
      if (room.bookingRoomId == null) {
        await insertBookingRoom(transaction, bookingId, room);
        continue;
      }
      await new sql.Request(transaction)
        .input('id', sql.BigInt, room.bookingRoomId)
        .input('roomId', sql.BigInt, room.roomId)
        .input('checkInDate', sql.Date, room.checkInDate)
        .input('checkOutDate', sql.Date, room.checkOutDate)
        .input('basePriceOverride', sql.Decimal(10, 2), room.basePriceOverride ?? null)
        .input('totalPrice', sql.Decimal(10, 2), room.totalPrice)
        .input('discountAmount', sql.Decimal(10, 2), room.discountAmount)
        .input('nightlyBreakdown', sql.NVarChar(sql.MAX), JSON.stringify(room.nights))
        .query(`
          UPDATE dbo.booking_rooms
          SET room_id = @roomId, check_in_date = @checkInDate, check_out_date = @checkOutDate,
              base_price_override = @basePriceOverride, total_price = @totalPrice,
              discount_amount = @discountAmount, nightly_breakdown = @nightlyBreakdown
          WHERE id = @id
        `);
      await writeRoomCharges(transaction, room.bookingRoomId, room.switchableCharges);
    }

    // Full replace, not a diff — the same "delete then re-insert" shape
    // writeBookingBeds has always used, and safe here for the same reason:
    // booking_beds has no foreign row (like an uploaded ID proof) that would
    // be orphaned by deleting it.
    await writeBookingBeds(
      transaction,
      lodgeId,
      bookingId,
      resolved.flatMap((r) => r.bedIds)
    );

    await new sql.Request(transaction)
      .input('bookingId', sql.BigInt, bookingId)
      .input('numGuests', sql.Int, newNumGuests)
      .input('guestName', sql.NVarChar, newGuestName)
      .input('guestPhone', sql.NVarChar, newGuestPhone)
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
      .input('idProofNumber', sql.NVarChar, input.idProofNumber ?? null)
      .input('idProofDocument', sql.NVarChar, input.idProofDocument ?? null)
      .query(`
        UPDATE dbo.bookings
        SET num_guests = @numGuests,
            guest_name = @guestName, guest_phone = @guestPhone,
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

    await syncBookingFromRooms(transaction, bookingId);

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
    // One batch, one transaction: the booking and every room it holds go
    // together, or a cancelled booking would keep its rooms blocked.
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;
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
        AND (@charge IS NULL OR (ISNULL(advance_amount, 0) = 0 AND @charge <= total_price));
      UPDATE dbo.booking_rooms SET status = 'CANCELLED'
      WHERE booking_id = @bookingId AND EXISTS (
        SELECT 1 FROM dbo.bookings WHERE id = @bookingId AND lodge_id = @lodgeId AND status = 'CANCELLED');
      COMMIT TRANSACTION;
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
  const booking = await getBooking(lodgeId, bookingId);
  // Awaited, unlike the booking confirmation: the desk asked to cancel and
  // wants to know whether the guest was told, so the result rides back on
  // the same response instead of only reaching the log. Still never throws —
  // notifyBookingCancelled catches everything itself — so a WhatsApp outage
  // cannot turn into an error for a cancellation that has already committed.
  const whatsapp = await cancellationNotice.notifyBookingCancelled(lodgeId, booking);
  return { ...booking, whatsapp };
}

module.exports = {
  idProofExists,
  priceStay,
  quoteBooking,
  listAvailableRooms,
  listAvailableRoomsForBooking,
  listAvailableBeds,
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
