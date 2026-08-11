const crypto = require('crypto');
const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const pricingService = require('../pricing/pricing.service');
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

async function priceStay(lodgeId, roomId, checkInDate, checkOutDate, chargeIds = []) {
  const nights = datesInRange(checkInDate, checkOutDate);
  const nightly = [];
  const chargeTotals = new Map();
  let totalPrice = 0;
  for (const date of nights) {
    const result = await pricingService.simulate(lodgeId, roomId, date, chargeIds);
    nightly.push({ date, total: result.total });
    for (const line of result.lines) {
      chargeTotals.set(line.label, round2((chargeTotals.get(line.label) || 0) + line.amount));
    }
    totalPrice += result.total;
  }
  const charges = Array.from(chargeTotals, ([label, amount]) => ({ label, amount }));
  return { nights: nightly, charges, totalPrice: round2(totalPrice) };
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
      SELECT id, name, charge_per_night
      FROM dbo.switchable_charges
      WHERE lodge_id = @lodgeId AND is_active = 1
      ORDER BY name ASC
    `);

  return chargesResult.recordset.map((row) => ({
    id: row.id,
    name: row.name,
    chargePerNight: Number(row.charge_per_night),
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

  return roomsResult.recordset.map((row) => ({
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
  }));
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
    })),
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
      WHERE lodge_id = @lodgeId AND status IN ('BOOKED', 'CHECKED_IN')
        AND check_in_date < @endDate AND check_out_date > @startDate
      ORDER BY check_in_date ASC
    `);

  return {
    rooms: roomsResult.recordset.map((r) => ({
      id: r.id,
      roomNumber: r.room_number,
      floor: r.floor,
      categoryName: r.category_name,
    })),
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

function mapBooking(row, charges = [], guests = [], vehicles = [], extra = {}) {
  return {
    id: row.id,
    roomId: row.room_id,
    roomNumber: row.room_number,
    categoryName: row.category_name,
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    numGuests: row.num_guests,
    idProofType: row.id_proof_type,
    hasIdProofDocument: !!row.id_proof_document,
    checkInDate: toIsoDate(row.check_in_date),
    checkOutDate: toIsoDate(row.check_out_date),
    totalPrice: Number(row.total_price),
    status: row.status,
    actualCheckInAt: row.actual_check_in_at,
    actualCheckOutAt: row.actual_check_out_at,
    advanceAmount: row.advance_amount != null ? Number(row.advance_amount) : null,
    advancePaymentMethod: row.advance_payment_method,
    switchableCharges: charges.map((c) => ({
      id: c.id,
      name: c.name,
      chargePerNight: Number(c.charge_per_night),
    })),
    guests: guests.map((g) => ({
      id: g.id,
      name: g.guest_name,
      phone: g.guest_phone,
      idProofType: g.id_proof_type,
      hasIdProofDocument: !!g.id_proof_document,
    })),
    vehicleNumbers: vehicles.map((v) => v.vehicle_number),
    // Reception reads this out to the guest at check-in — it is the only way a
    // guest ever learns their PIN, so the booking screen has to show it. NULL
    // once they check out, which is what closes in-room ordering (see checkOut).
    foodPin: row.food_pin ?? null,
    foodOrderingLockedUntil: extra.foodOrderingLockedUntil ?? null,
    // A booking stays editable (extras, for now) right up until its bill is
    // issued — that's the point a guest's stay turns into a fixed, printed
    // number. Voiding an invoice drops this back to false, reopening editing.
    hasIssuedInvoice: !!extra.hasIssuedInvoice,
    availableSwitchableCharges: extra.availableSwitchableCharges || [],
  };
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
      SELECT b.*, r.room_number, c.name AS category_name
      FROM dbo.bookings b
      JOIN dbo.rooms r ON r.id = b.room_id
      JOIN dbo.room_categories c ON c.id = r.category_id
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
      SELECT sc.id, sc.name, sc.charge_per_night
      FROM dbo.booking_switchable_charges bsc
      JOIN dbo.switchable_charges sc ON sc.id = bsc.charge_id
      WHERE bsc.booking_id = @bookingId
    `);

  const guestsResult = await pool
    .request()
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT id, guest_name, guest_phone, id_proof_type, id_proof_document
      FROM dbo.booking_guests
      WHERE booking_id = @bookingId
      ORDER BY id ASC
    `);

  const vehiclesResult = await pool
    .request()
    .input('bookingId', sql.BigInt, bookingId)
    .query('SELECT vehicle_number FROM dbo.booking_vehicles WHERE booking_id = @bookingId ORDER BY id ASC');

  const invoiceResult = await pool
    .request()
    .input('bookingId', sql.BigInt, bookingId)
    .query("SELECT TOP 1 id FROM dbo.invoices WHERE booking_id = @bookingId AND status = 'ISSUED'");

  // Whether this room has locked itself out of food ordering by failing the
  // PIN too many times. Reception is who the guest complains to, so it belongs
  // on the booking they're already looking at. Keyed on the room number
  // because that's what the guest typed — see dbo.food_pin_lockouts.
  const lockoutResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roomLabel', sql.NVarChar, row.room_number)
    .query(`
      SELECT locked_until FROM dbo.food_pin_lockouts
      WHERE lodge_id = @lodgeId AND room_label = @roomLabel
        AND locked_until IS NOT NULL AND locked_until > SYSDATETIMEOFFSET()
    `);

  const availableSwitchableCharges = await getActiveSwitchableCharges(pool, lodgeId);

  return mapBooking(row, chargesResult.recordset, guestsResult.recordset, vehiclesResult.recordset, {
    hasIssuedInvoice: invoiceResult.recordset.length > 0,
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

  if (input.switchableChargeIds.length > 0) {
    const capableResult = await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .query('SELECT id FROM dbo.switchable_charges WHERE lodge_id = @lodgeId AND is_active = 1');
    const capableIds = new Set(capableResult.recordset.map((r) => Number(r.id)));
    if (!input.switchableChargeIds.every((id) => capableIds.has(id))) {
      throw new ApiError('One or more extras are not available.', 400);
    }
  }

  if (await hasOverlap(() => pool.request(), input.roomId, input.checkInDate, input.checkOutDate)) {
    throw new ApiError('This room is already booked for part of that date range.', 409);
  }

  const { nights, totalPrice } = await priceStay(
    lodgeId,
    input.roomId,
    input.checkInDate,
    input.checkOutDate,
    input.switchableChargeIds
  );

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
      .input('nightlyBreakdown', sql.NVarChar(sql.MAX), JSON.stringify(nights))
      .input('createdBy', sql.BigInt, userId ?? null)
      .input('advanceAmount', sql.Decimal(10, 2), input.advanceAmount ?? null)
      .input('advancePaymentMethod', sql.NVarChar, input.advancePaymentMethod ?? null)
      .query(`
        INSERT INTO dbo.bookings
          (lodge_id, room_id, guest_name, guest_phone, num_guests, id_proof_type, id_proof_document,
           check_in_date, check_out_date, total_price, nightly_breakdown, created_by,
           advance_amount, advance_payment_method)
        OUTPUT inserted.id
        VALUES
          (@lodgeId, @roomId, @guestName, @guestPhone, @numGuests, @idProofType, @idProofDocument,
           @checkInDate, @checkOutDate, @totalPrice, @nightlyBreakdown, @createdBy,
           @advanceAmount, @advancePaymentMethod)
      `);

    const bookingId = insertResult.recordset[0].id;

    for (const chargeId of input.switchableChargeIds) {
      await new sql.Request(transaction)
        .input('bookingId', sql.BigInt, bookingId)
        .input('chargeId', sql.BigInt, chargeId)
        .query('INSERT INTO dbo.booking_switchable_charges (booking_id, charge_id) VALUES (@bookingId, @chargeId)');
    }

    await insertGuestsAndVehicles(transaction, bookingId, input.guests, input.vehicleNumbers);

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
async function insertGuestsAndVehicles(transaction, bookingId, guests, vehicleNumbers) {
  for (const guest of guests) {
    await new sql.Request(transaction)
      .input('bookingId', sql.BigInt, bookingId)
      .input('guestName', sql.NVarChar, guest.name)
      .input('guestPhone', sql.NVarChar, guest.phone)
      .input('idProofType', sql.NVarChar, guest.idProofType)
      .input('idProofDocument', sql.NVarChar, guest.idProofDocument)
      .query(`
        INSERT INTO dbo.booking_guests (booking_id, guest_name, guest_phone, id_proof_type, id_proof_document)
        VALUES (@bookingId, @guestName, @guestPhone, @idProofType, @idProofDocument)
      `);
  }

  for (const vehicleNumber of vehicleNumbers) {
    await new sql.Request(transaction)
      .input('bookingId', sql.BigInt, bookingId)
      .input('vehicleNumber', sql.NVarChar, vehicleNumber)
      .query('INSERT INTO dbo.booking_vehicles (booking_id, vehicle_number) VALUES (@bookingId, @vehicleNumber)');
  }
}

async function checkIn(lodgeId, bookingId, input) {
  const pool = await getPool();

  const bookingResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT num_guests, id_proof_type, check_in_date FROM dbo.bookings
      WHERE id = @bookingId AND lodge_id = @lodgeId AND status = 'BOOKED'
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

  if (input.guests.length > 0) {
    const existingGuestsResult = await pool
      .request()
      .input('bookingId', sql.BigInt, bookingId)
      .query('SELECT COUNT(*) AS count FROM dbo.booking_guests WHERE booking_id = @bookingId');
    const existingCount = existingGuestsResult.recordset[0].count;
    if (existingCount + input.guests.length + 1 > bookingRow.num_guests) {
      throw new ApiError('Guest details can’t exceed the number of guests.', 400);
    }
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('bookingId', sql.BigInt, bookingId)
      .input('advanceAmount', sql.Decimal(10, 2), input.advanceAmount ?? null)
      .input('advancePaymentMethod', sql.NVarChar, input.advancePaymentMethod ?? null)
      .input('idProofType', sql.NVarChar, input.idProofType ?? null)
      .input('idProofDocument', sql.NVarChar, input.idProofDocument ?? null)
      .input('foodPin', sql.NVarChar, newFoodPin())
      .query(`
        UPDATE dbo.bookings
        SET status = 'CHECKED_IN', actual_check_in_at = SYSDATETIMEOFFSET(),
            food_pin = @foodPin,
            advance_amount = CASE
              WHEN @advanceAmount IS NULL THEN advance_amount
              ELSE ISNULL(advance_amount, 0) + @advanceAmount
            END,
            advance_payment_method = COALESCE(@advancePaymentMethod, advance_payment_method),
            id_proof_type = COALESCE(@idProofType, id_proof_type),
            id_proof_document = COALESCE(@idProofDocument, id_proof_document)
        OUTPUT inserted.id
        WHERE id = @bookingId AND lodge_id = @lodgeId AND status = 'BOOKED'
      `);
    if (result.recordset.length === 0) {
      throw new ApiError('Booking not found or not ready for check-in.', 409);
    }

    await insertGuestsAndVehicles(transaction, bookingId, input.guests, input.vehicleNumbers);

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
      SELECT room_id, check_in_date, check_out_date, status, num_guests, guest_name, guest_phone
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

  let newNumGuests = bookingRow.num_guests;
  if (input.numGuests != null) {
    const guestsCountResult = await pool
      .request()
      .input('bookingId', sql.BigInt, bookingId)
      .query('SELECT COUNT(*) AS count FROM dbo.booking_guests WHERE booking_id = @bookingId');
    if (input.numGuests < guestsCountResult.recordset[0].count + 1) {
      throw new ApiError('Guest count can’t be less than the guests already on file.', 400);
    }
    newNumGuests = input.numGuests;
  }

  const newGuestName = input.guestName != null ? input.guestName : bookingRow.guest_name;
  const newGuestPhone = input.guestPhone != null ? input.guestPhone : bookingRow.guest_phone;

  let switchableChargeIds = input.switchableChargeIds;
  if (switchableChargeIds == null) {
    const currentChargesResult = await pool
      .request()
      .input('bookingId', sql.BigInt, bookingId)
      .query('SELECT charge_id FROM dbo.booking_switchable_charges WHERE booking_id = @bookingId');
    switchableChargeIds = currentChargesResult.recordset.map((r) => r.charge_id);
  } else if (switchableChargeIds.length > 0) {
    const capableResult = await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .query('SELECT id FROM dbo.switchable_charges WHERE lodge_id = @lodgeId AND is_active = 1');
    const capableIds = new Set(capableResult.recordset.map((r) => Number(r.id)));
    if (!switchableChargeIds.every((id) => capableIds.has(id))) {
      throw new ApiError('One or more extras are not available.', 400);
    }
  }

  const { nights, totalPrice } = await priceStay(lodgeId, newRoomId, checkInDate, newCheckOutDate, switchableChargeIds);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction)
      .input('bookingId', sql.BigInt, bookingId)
      .query('DELETE FROM dbo.booking_switchable_charges WHERE booking_id = @bookingId');

    for (const chargeId of switchableChargeIds) {
      await new sql.Request(transaction)
        .input('bookingId', sql.BigInt, bookingId)
        .input('chargeId', sql.BigInt, chargeId)
        .query('INSERT INTO dbo.booking_switchable_charges (booking_id, charge_id) VALUES (@bookingId, @chargeId)');
    }

    await new sql.Request(transaction)
      .input('bookingId', sql.BigInt, bookingId)
      .input('roomId', sql.BigInt, newRoomId)
      .input('checkOutDate', sql.Date, newCheckOutDate)
      .input('numGuests', sql.Int, newNumGuests)
      .input('guestName', sql.NVarChar, newGuestName)
      .input('guestPhone', sql.NVarChar, newGuestPhone)
      .input('totalPrice', sql.Decimal(10, 2), totalPrice)
      .input('nightlyBreakdown', sql.NVarChar(sql.MAX), JSON.stringify(nights))
      .query(`
        UPDATE dbo.bookings
        SET room_id = @roomId, check_out_date = @checkOutDate, num_guests = @numGuests,
            guest_name = @guestName, guest_phone = @guestPhone,
            total_price = @totalPrice, nightly_breakdown = @nightlyBreakdown
        WHERE id = @bookingId
      `);

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
