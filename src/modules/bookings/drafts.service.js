const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');

function toIsoDate(d) {
  if (d == null) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

// The chart and the drafts list read these columns; everything else about a
// draft lives in the payload and only matters once it is reopened.
//
// Lifted out of the payload rather than trusted from the client as separate
// fields, so the row can never disagree with the form it came from — a draft
// whose chart tile said room 3 while its payload said room 7 would be a bug
// nobody could see until they opened it.
function indexedFrom(payload) {
  const roomId = Number(payload.roomId);
  const primary = payload.adults?.[0];
  return {
    roomId: Number.isInteger(roomId) && roomId > 0 ? roomId : null,
    checkInDate: payload.checkInDate || null,
    checkOutDate: payload.checkOutDate || null,
    guestName: primary?.name?.trim() ? primary.name.trim().slice(0, 200) : null,
  };
}

function mapDraft(row) {
  return {
    id: row.id,
    roomId: row.room_id,
    roomNumber: row.room_number ?? null,
    categoryName: row.category_name ?? null,
    guestName: row.guest_name,
    checkInDate: toIsoDate(row.check_in_date),
    checkOutDate: toIsoDate(row.check_out_date),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByName: row.created_by_name ?? null,
    // Parsed here so every caller gets an object; a row that somehow holds
    // unparseable JSON comes back as an empty form rather than throwing and
    // taking the whole list down with it.
    form: safeParse(row.payload),
  };
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const DRAFT_COLUMNS = `
  d.id, d.room_id, d.check_in_date, d.check_out_date, d.guest_name, d.payload,
  d.created_at, d.updated_at,
  r.room_number, c.name AS category_name, u.name AS created_by_name
`;

const DRAFT_JOINS = `
  FROM dbo.booking_drafts d
  LEFT JOIN dbo.rooms r ON r.id = d.room_id
  LEFT JOIN dbo.room_categories c ON c.id = r.category_id
  LEFT JOIN dbo.users u ON u.id = d.created_by
`;

async function listDrafts(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT ${DRAFT_COLUMNS} ${DRAFT_JOINS}
      WHERE d.lodge_id = @lodgeId
      ORDER BY d.updated_at DESC
    `);
  return result.recordset.map(mapDraft);
}

async function getDraft(lodgeId, draftId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('draftId', sql.BigInt, draftId)
    .query(`SELECT ${DRAFT_COLUMNS} ${DRAFT_JOINS} WHERE d.id = @draftId AND d.lodge_id = @lodgeId`);
  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('Draft not found.', 404);
  }
  return mapDraft(row);
}

// The room is checked to belong to this lodge, but never checked for being
// free: a draft reserves nothing, and refusing to park one because someone
// else is looking at the same room would defeat the point of parking it.
async function assertRoom(pool, lodgeId, roomId) {
  if (roomId == null) return;
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roomId', sql.BigInt, roomId)
    .query('SELECT id FROM dbo.rooms WHERE id = @roomId AND lodge_id = @lodgeId');
  if (result.recordset.length === 0) {
    throw new ApiError('Choose a valid room.', 400);
  }
}

async function createDraft(lodgeId, userId, payload) {
  const pool = await getPool();
  const indexed = indexedFrom(payload);
  await assertRoom(pool, lodgeId, indexed.roomId);

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roomId', sql.BigInt, indexed.roomId)
    .input('checkInDate', sql.Date, indexed.checkInDate)
    .input('checkOutDate', sql.Date, indexed.checkOutDate)
    .input('guestName', sql.NVarChar, indexed.guestName)
    .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
    .input('createdBy', sql.BigInt, userId ?? null)
    .query(`
      INSERT INTO dbo.booking_drafts
        (lodge_id, room_id, check_in_date, check_out_date, guest_name, payload, created_by)
      OUTPUT inserted.id
      VALUES (@lodgeId, @roomId, @checkInDate, @checkOutDate, @guestName, @payload, @createdBy)
    `);

  return getDraft(lodgeId, result.recordset[0].id);
}

async function updateDraft(lodgeId, draftId, payload) {
  const pool = await getPool();
  const indexed = indexedFrom(payload);
  await assertRoom(pool, lodgeId, indexed.roomId);

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('draftId', sql.BigInt, draftId)
    .input('roomId', sql.BigInt, indexed.roomId)
    .input('checkInDate', sql.Date, indexed.checkInDate)
    .input('checkOutDate', sql.Date, indexed.checkOutDate)
    .input('guestName', sql.NVarChar, indexed.guestName)
    .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
    .query(`
      UPDATE dbo.booking_drafts
      SET room_id = @roomId, check_in_date = @checkInDate, check_out_date = @checkOutDate,
          guest_name = @guestName, payload = @payload, updated_at = SYSDATETIMEOFFSET()
      OUTPUT inserted.id
      WHERE id = @draftId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Draft not found.', 404);
  }
  return getDraft(lodgeId, draftId);
}

// Deleting a draft destroys nothing that was ever agreed with a guest, which
// is why it is a plain DELETE and not the soft cancel a real booking gets.
async function deleteDraft(lodgeId, draftId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('draftId', sql.BigInt, draftId)
    .query('DELETE FROM dbo.booking_drafts OUTPUT deleted.id WHERE id = @draftId AND lodge_id = @lodgeId');
  if (result.recordset.length === 0) {
    throw new ApiError('Draft not found.', 404);
  }
}

// Drafts touching the nights on screen, for the tape chart. Same overlap
// convention as bookings — start before the window ends, end after it starts.
// Only drafts with a room and both dates can be drawn.
async function listDraftsForRange(pool, lodgeId, startDate, endDate) {
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('startDate', sql.Date, startDate)
    .input('endDate', sql.Date, endDate)
    .query(`
      SELECT id, room_id, guest_name, check_in_date, check_out_date, updated_at
      FROM dbo.booking_drafts
      WHERE lodge_id = @lodgeId AND room_id IS NOT NULL
        AND check_in_date IS NOT NULL AND check_out_date IS NOT NULL
        AND check_in_date < @endDate AND check_out_date > @startDate
      ORDER BY check_in_date ASC
    `);

  return result.recordset.map((d) => ({
    id: d.id,
    roomId: d.room_id,
    guestName: d.guest_name,
    checkInDate: toIsoDate(d.check_in_date),
    checkOutDate: toIsoDate(d.check_out_date),
    updatedAt: d.updated_at,
  }));
}

module.exports = {
  listDrafts,
  getDraft,
  createDraft,
  updateDraft,
  deleteDraft,
  listDraftsForRange,
};
