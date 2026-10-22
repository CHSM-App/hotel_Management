const crypto = require('crypto');

const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const { logger } = require('../../config/logger');

const RETENTION_DAYS = 30;

// No 0/O/1/I — the code is read aloud and quoted back over the phone.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeReferenceCode() {
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `ENQ-${out}`;
}

function mapEnquiry(row) {
  return {
    id: row.id,
    referenceCode: row.reference_code,
    kind: row.kind,
    name: row.name,
    phone: row.phone,
    checkInDate: row.check_in_date,
    checkOutDate: row.check_out_date,
    eventDate: row.event_date,
    eventType: row.event_type,
    roomTypeId: row.room_type_id,
    venueId: row.venue_id,
    guests: row.guests,
    addonIds: row.addon_ids ? JSON.parse(row.addon_ids) : [],
    summary: row.summary,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
    handledAt: row.handled_at,
  };
}

// Public: the guest's submit. Never trusts the client for the lodge — the slug
// is resolved by the caller (public.service.getLodgeBySlug) to a lodge id.
async function createPublicEnquiry(lodgeId, data) {
  // Honeypot filled: pretend success so a bot gets no signal, store nothing.
  if (data.website) return { referenceCode: makeReferenceCode() };

  const pool = await getPool();
  // A collision on a 32^6 code is vanishingly rare; retry covers it anyway.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const referenceCode = makeReferenceCode();
    try {
      await pool
        .request()
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('code', sql.NVarChar, referenceCode)
        .input('kind', sql.NVarChar, data.kind)
        .input('name', sql.NVarChar, data.name)
        .input('phone', sql.NVarChar, data.phone)
        .input('checkIn', sql.Date, data.checkInDate)
        .input('checkOut', sql.Date, data.checkOutDate)
        .input('eventDate', sql.Date, data.eventDate)
        .input('eventType', sql.NVarChar, data.eventType)
        .input('roomTypeId', sql.BigInt, data.roomTypeId)
        .input('venueId', sql.BigInt, data.venueId)
        .input('guests', sql.Int, data.guests)
        .input('addonIds', sql.NVarChar, data.addonIds.length ? JSON.stringify(data.addonIds) : null)
        .input('summary', sql.NVarChar, data.summary)
        .input('notes', sql.NVarChar, data.notes)
        .query(`
          INSERT INTO dbo.lodge_enquiries
            (lodge_id, reference_code, kind, name, phone, check_in_date, check_out_date,
             event_date, event_type, room_type_id, venue_id, guests, addon_ids, summary, notes)
          VALUES
            (@lodgeId, @code, @kind, @name, @phone, @checkIn, @checkOut,
             @eventDate, @eventType, @roomTypeId, @venueId, @guests, @addonIds, @summary, @notes)
        `);
      return { referenceCode };
    } catch (err) {
      // 2601/2627: unique violation on reference_code — try a fresh code.
      if ((err.number === 2601 || err.number === 2627) && attempt < 2) continue;
      throw err;
    }
  }
  throw new ApiError('Could not save your enquiry. Please try again.', 500);
}

async function listEnquiries(lodgeId, { status } = {}) {
  const pool = await getPool();
  const request = pool.request().input('lodgeId', sql.BigInt, lodgeId);
  let filter = '';
  if (status && ['NEW', 'CONTACTED', 'CONVERTED', 'CLOSED'].includes(status)) {
    request.input('status', sql.NVarChar, status);
    filter = 'AND status = @status';
  }
  const result = await request.query(`
    SELECT * FROM dbo.lodge_enquiries
    WHERE lodge_id = @lodgeId ${filter}
    ORDER BY created_at DESC
  `);
  return { enquiries: result.recordset.map(mapEnquiry) };
}

// What the alert hook polls: the NEW ones only, newest first, capped — the bell
// needs a count and a few names, not the whole inbox.
async function summarize(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT TOP 20 id, reference_code, kind, name, created_at
      FROM dbo.lodge_enquiries
      WHERE lodge_id = @lodgeId AND status = 'NEW'
      ORDER BY created_at DESC
    `);
  return {
    newCount: result.recordset.length,
    items: result.recordset.map((r) => ({
      id: r.id,
      referenceCode: r.reference_code,
      kind: r.kind,
      name: r.name,
      createdAt: r.created_at,
    })),
  };
}

async function updateStatus(lodgeId, userId, id, status) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('id', sql.BigInt, id)
    .input('status', sql.NVarChar, status)
    .input('userId', sql.BigInt, userId ?? null)
    .query(`
      UPDATE dbo.lodge_enquiries
      SET status = @status,
          handled_by = CASE WHEN @status = 'NEW' THEN NULL ELSE @userId END,
          handled_at = CASE WHEN @status = 'NEW' THEN NULL ELSE SYSDATETIMEOFFSET() END
      OUTPUT inserted.*
      WHERE id = @id AND lodge_id = @lodgeId
    `);
  const row = result.recordset[0];
  if (!row) throw new ApiError('Enquiry not found.', 404);
  return { enquiry: mapEnquiry(row) };
}

async function purgeOldEnquiries() {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('days', sql.Int, RETENTION_DAYS)
    .query('DELETE FROM dbo.lodge_enquiries WHERE created_at < DATEADD(DAY, -@days, SYSDATETIMEOFFSET())');
  if (result.rowsAffected[0]) logger.info({ removed: result.rowsAffected[0] }, 'Purged old enquiries');
}

module.exports = { createPublicEnquiry, listEnquiries, summarize, updateStatus, purgeOldEnquiries };
