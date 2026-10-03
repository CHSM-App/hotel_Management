const crypto = require('crypto');
const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');

// The token goes in a QR that gets printed once and stuck to a table, so it
// has to survive being scanned by anything and never be guessable by counting.
// base64url from 18 random bytes gives 24 URL-safe chars with no ambiguity
// about case or padding.
function newQrToken() {
  return crypto.randomBytes(18).toString('base64url');
}

function mapTable(row) {
  return {
    id: row.id,
    label: row.label,
    seats: row.seats,
    qrToken: row.qr_token,
    isActive: !!row.is_active,
  };
}

async function listTables(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT id, label, seats, qr_token, is_active
      FROM dbo.dining_tables
      WHERE lodge_id = @lodgeId
      ORDER BY LEN(label) ASC, label ASC
    `);
  return result.recordset.map(mapTable);
}

async function createTable(lodgeId, input) {
  const pool = await getPool();

  const existing = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('label', sql.NVarChar, input.label)
    .query('SELECT id FROM dbo.dining_tables WHERE lodge_id = @lodgeId AND label = @label');
  if (existing.recordset.length > 0) {
    throw new ApiError('A table with that name already exists.', 409, 'tableLabel');
  }

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('label', sql.NVarChar, input.label)
    .input('seats', sql.Int, input.seats ?? null)
    .input('qrToken', sql.NVarChar, newQrToken())
    .query(`
      INSERT INTO dbo.dining_tables (lodge_id, label, seats, qr_token)
      OUTPUT inserted.id
      VALUES (@lodgeId, @label, @seats, @qrToken)
    `);

  return { id: result.recordset[0].id };
}

async function bulkCreateTables(lodgeId, input) {
  if (input.rangeEnd < input.rangeStart) {
    throw new ApiError('The end number must be the same or higher than the start.', 400, 'tableTo');
  }
  if (input.rangeEnd - input.rangeStart + 1 > 100) {
    throw new ApiError('That range would create more than 100 tables — add them in smaller batches.', 400, 'tableTo');
  }

  const pool = await getPool();
  const labels = [];
  for (let n = input.rangeStart; n <= input.rangeEnd; n += 1) {
    labels.push(`${input.prefix}${n}`);
  }

  const existingResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query('SELECT label FROM dbo.dining_tables WHERE lodge_id = @lodgeId');
  const taken = new Set(existingResult.recordset.map((r) => r.label));
  const toCreate = labels.filter((l) => !taken.has(l));

  if (toCreate.length === 0) {
    throw new ApiError('Every table in that range already exists.', 409, 'tableFrom');
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const label of toCreate) {
      await new sql.Request(transaction)
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('label', sql.NVarChar, label)
        .input('seats', sql.Int, input.seats ?? null)
        .input('qrToken', sql.NVarChar, newQrToken())
        .query(`
          INSERT INTO dbo.dining_tables (lodge_id, label, seats, qr_token)
          VALUES (@lodgeId, @label, @seats, @qrToken)
        `);
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  return { created: toCreate.length, skipped: labels.length - toCreate.length };
}

async function updateTable(lodgeId, tableId, input) {
  const pool = await getPool();

  const conflict = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('tableId', sql.BigInt, tableId)
    .input('label', sql.NVarChar, input.label)
    .query('SELECT id FROM dbo.dining_tables WHERE lodge_id = @lodgeId AND label = @label AND id <> @tableId');
  if (conflict.recordset.length > 0) {
    throw new ApiError('A table with that name already exists.', 409, 'tableLabel');
  }

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('tableId', sql.BigInt, tableId)
    .input('label', sql.NVarChar, input.label)
    .input('seats', sql.Int, input.seats ?? null)
    .query(`
      UPDATE dbo.dining_tables SET label = @label, seats = @seats
      OUTPUT inserted.id
      WHERE id = @tableId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Table not found.', 404);
  }

  return { id: tableId };
}

async function setTableActive(lodgeId, tableId, isActive) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('tableId', sql.BigInt, tableId)
    .input('isActive', sql.Bit, isActive)
    .query(`
      UPDATE dbo.dining_tables SET is_active = @isActive
      OUTPUT inserted.id
      WHERE id = @tableId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Table not found.', 404);
  }
  return { id: tableId };
}

// Issues a fresh token, which silently kills every printed copy of the old QR.
// Deliberately a separate action from editing the label: the owner needs to be
// able to rename "T4" without invalidating the sticker already on it.
async function regenerateQrToken(lodgeId, tableId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('tableId', sql.BigInt, tableId)
    .input('qrToken', sql.NVarChar, newQrToken())
    .query(`
      UPDATE dbo.dining_tables SET qr_token = @qrToken
      OUTPUT inserted.qr_token
      WHERE id = @tableId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Table not found.', 404);
  }
  return { id: tableId, qrToken: result.recordset[0].qr_token };
}

// Blocked once any order references the table, so the order history keeps
// pointing at a real row — deactivating is the way out at that point.
async function deleteTable(lodgeId, tableId) {
  const pool = await getPool();

  const existing = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('tableId', sql.BigInt, tableId)
    .query('SELECT id FROM dbo.dining_tables WHERE id = @tableId AND lodge_id = @lodgeId');
  if (existing.recordset.length === 0) {
    throw new ApiError('Table not found.', 404);
  }

  const ordersResult = await pool
    .request()
    .input('tableId', sql.BigInt, tableId)
    .query('SELECT TOP 1 id FROM dbo.food_orders WHERE table_id = @tableId');
  if (ordersResult.recordset.length > 0) {
    throw new ApiError('This table has orders against it and can’t be deleted — deactivate it instead.', 409);
  }

  await pool
    .request()
    .input('tableId', sql.BigInt, tableId)
    .query('DELETE FROM dbo.dining_tables WHERE id = @tableId');
}

module.exports = {
  listTables,
  createTable,
  bulkCreateTables,
  updateTable,
  setTableActive,
  regenerateQrToken,
  deleteTable,
};
