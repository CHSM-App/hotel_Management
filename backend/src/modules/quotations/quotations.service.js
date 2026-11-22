const crypto = require('crypto');

const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const pricingService = require('../pricing/pricing.service');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_NIGHTS = 365;
const LIST_CAP = 500;

function makeReferenceCode() {
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `QTN-${out}`;
}

function todayIsoIST() {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

const isoDay = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

// A quotation is good until its earliest check-in date arrives: on that date
// itself it is already Expired. Worked out on every read, so nothing has to
// run at midnight and a missed sweep can never leave a stale price "active".
function quotationState(status, checkInDate, today = todayIsoIST()) {
  if (status === 'BOOKED') return 'BOOKED';
  return isoDay(checkInDate) <= today ? 'EXPIRED' : 'ACTIVE';
}

function mapRow(row, { withPayload = false } = {}) {
  const out = {
    id: row.id,
    referenceCode: row.reference_code,
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    checkInDate: isoDay(row.check_in_date),
    lastCheckOutDate: isoDay(row.last_check_out_date),
    total: Number(row.total),
    roomSummary: row.room_summary,
    status: quotationState(row.status, row.check_in_date),
    bookedBookingId: row.booked_booking_id,
    createdAt: row.created_at,
  };
  if (withPayload) out.rooms = JSON.parse(row.payload);
  return out;
}

function nightsBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

async function createQuotation(lodgeId, userId, { guestName, guestPhone, rooms }) {
  const today = todayIsoIST();
  const pool = await getPool();
  const payload = [];

  for (const r of rooms) {
    if (r.toDate <= r.fromDate) throw new ApiError('The to date must be after the from date.', 400);
    if (nightsBetween(r.fromDate, r.toDate) > MAX_NIGHTS) {
      throw new ApiError(`Quote up to ${MAX_NIGHTS} nights at a time.`, 400);
    }
    // A saved quotation holds until check-in, so one for today or earlier
    // would be Expired the moment it was kept.
    if (r.fromDate <= today) {
      throw new ApiError('Choose a check-in date after today to save a quotation.', 400);
    }
    const result = await pricingService.simulateRange(
      lodgeId,
      r.roomId,
      r.fromDate,
      r.toDate,
      pricingService.parseChargeSelections(r.chargeIds)
    );
    const cat = await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('roomId', sql.BigInt, r.roomId)
      .query(`
        SELECT c.name
        FROM dbo.rooms rm JOIN dbo.room_categories c ON c.id = rm.category_id
        WHERE rm.id = @roomId AND rm.lodge_id = @lodgeId
      `);
    payload.push({
      roomId: r.roomId,
      roomNumber: result.roomNumber,
      categoryName: cat.recordset[0]?.name ?? '',
      fromDate: r.fromDate,
      toDate: r.toDate,
      chargeIds: r.chargeIds || '',
      result,
    });
  }

  const total = Math.round(payload.reduce((sum, p) => sum + p.result.total, 0) * 100) / 100;
  const checkIn = payload.map((p) => p.fromDate).sort()[0];
  const lastOut = payload.map((p) => p.toDate).sort().at(-1);
  const summary = payload.map((p) => `Room ${p.roomNumber}${p.categoryName ? ` · ${p.categoryName}` : ''}`).join(', ').slice(0, 300);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const referenceCode = makeReferenceCode();
    try {
      const inserted = await pool
        .request()
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('code', sql.NVarChar, referenceCode)
        .input('name', sql.NVarChar, guestName)
        .input('phone', sql.NVarChar, guestPhone ?? null)
        .input('checkIn', sql.Date, checkIn)
        .input('lastOut', sql.Date, lastOut)
        .input('total', sql.Decimal(12, 2), total)
        .input('summary', sql.NVarChar, summary)
        .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
        .input('userId', sql.BigInt, userId ?? null)
        .query(`
          INSERT INTO dbo.lodge_quotations
            (lodge_id, reference_code, guest_name, guest_phone, check_in_date, last_check_out_date,
             total, room_summary, payload, created_by)
          OUTPUT INSERTED.*
          VALUES (@lodgeId, @code, @name, @phone, @checkIn, @lastOut, @total, @summary, @payload, @userId)
        `);
      return mapRow(inserted.recordset[0], { withPayload: true });
    } catch (err) {
      if ((err.number === 2601 || err.number === 2627) && attempt < 2) continue;
      throw err;
    }
  }
  throw new ApiError('Could not save the quotation. Please try again.', 500);
}

async function listQuotations(lodgeId, { state, q } = {}) {
  const pool = await getPool();
  const request = pool.request().input('lodgeId', sql.BigInt, lodgeId);
  let search = '';
  const term = (q || '').trim();
  if (term) {
    request.input('q', sql.NVarChar, `%${term}%`);
    search = 'AND (guest_name LIKE @q OR guest_phone LIKE @q OR reference_code LIKE @q OR room_summary LIKE @q)';
  }
  const result = await request.query(`
    SELECT TOP (${LIST_CAP}) id, lodge_id, reference_code, guest_name, guest_phone, check_in_date,
           last_check_out_date, total, room_summary, status, booked_booking_id, created_at
    FROM dbo.lodge_quotations
    WHERE lodge_id = @lodgeId AND deleted_at IS NULL ${search}
    ORDER BY created_at DESC
  `);
  const wanted = String(state || 'all').toUpperCase();
  const quotations = result.recordset
    .map((r) => mapRow(r))
    .filter((qt) => wanted === 'ALL' || qt.status === wanted);
  return { quotations };
}

async function loadRow(lodgeId, id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('id', sql.BigInt, id)
    .query('SELECT * FROM dbo.lodge_quotations WHERE id = @id AND lodge_id = @lodgeId AND deleted_at IS NULL');
  const row = result.recordset[0];
  if (!row) throw new ApiError('Quotation not found.', 404);
  return row;
}

async function getQuotation(lodgeId, id) {
  return mapRow(await loadRow(lodgeId, id), { withPayload: true });
}

async function updateQuotation(lodgeId, id, { guestName, guestPhone, status, bookingId }) {
  const row = await loadRow(lodgeId, id);
  const pool = await getPool();
  const request = pool.request().input('id', sql.BigInt, id).input('lodgeId', sql.BigInt, lodgeId);
  const sets = [];
  if (guestName !== undefined) {
    request.input('name', sql.NVarChar, guestName);
    sets.push('guest_name = @name');
  }
  if (guestPhone !== undefined) {
    request.input('phone', sql.NVarChar, guestPhone);
    sets.push('guest_phone = @phone');
  }
  if (status === 'BOOKED') {
    request.input('bookingId', sql.BigInt, bookingId ?? null);
    sets.push("status = 'BOOKED'", 'booked_booking_id = @bookingId');
  }
  if (sets.length === 0) return mapRow(row, { withPayload: true });
  const result = await request.query(
    `UPDATE dbo.lodge_quotations SET ${sets.join(', ')} OUTPUT INSERTED.* WHERE id = @id AND lodge_id = @lodgeId`
  );
  return mapRow(result.recordset[0], { withPayload: true });
}

async function deleteQuotation(lodgeId, id) {
  await loadRow(lodgeId, id);
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('lodgeId', sql.BigInt, lodgeId)
    .query('UPDATE dbo.lodge_quotations SET deleted_at = SYSDATETIMEOFFSET() WHERE id = @id AND lodge_id = @lodgeId');
  return { ok: true };
}

module.exports = {
  createQuotation,
  listQuotations,
  getQuotation,
  updateQuotation,
  deleteQuotation,
  quotationState,
};
