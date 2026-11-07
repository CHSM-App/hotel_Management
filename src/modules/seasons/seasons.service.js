const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');

async function listSeasons(lodgeId) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT id, name, start_date, end_date, adjustment_percent, is_active, created_at
      FROM dbo.seasons
      WHERE lodge_id = @lodgeId
      ORDER BY start_date ASC
    `);

  return result.recordset.map((row) => ({
    id: row.id,
    name: row.name,
    startDate: row.start_date.toISOString().slice(0, 10),
    endDate: row.end_date.toISOString().slice(0, 10),
    adjustmentPercent: Number(row.adjustment_percent),
    isActive: !!row.is_active,
    createdAt: row.created_at,
  }));
}

async function createSeason(lodgeId, input) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, input.name)
    .input('startDate', sql.Date, input.startDate)
    .input('endDate', sql.Date, input.endDate)
    .input('adjustmentPercent', sql.Decimal(6, 2), input.adjustmentPercent)
    .query(`
      INSERT INTO dbo.seasons (lodge_id, name, start_date, end_date, adjustment_percent)
      OUTPUT inserted.id
      VALUES (@lodgeId, @name, @startDate, @endDate, @adjustmentPercent)
    `);

  return { id: result.recordset[0].id };
}

async function updateSeason(lodgeId, seasonId, input) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('seasonId', sql.BigInt, seasonId)
    .input('name', sql.NVarChar, input.name)
    .input('startDate', sql.Date, input.startDate)
    .input('endDate', sql.Date, input.endDate)
    .input('adjustmentPercent', sql.Decimal(6, 2), input.adjustmentPercent)
    .query(`
      UPDATE dbo.seasons
      SET name = @name, start_date = @startDate, end_date = @endDate, adjustment_percent = @adjustmentPercent
      OUTPUT inserted.id
      WHERE id = @seasonId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Season not found.', 404);
  }
  return { id: seasonId };
}

// Unlike rooms/categories/switchable charges, nothing references dbo.seasons
// by id — pricing looks seasons up live by date range, and a booking's
// nightly_breakdown snapshot stores the computed total, not which season
// applied — so a hard delete here is safe.
async function deleteSeason(lodgeId, seasonId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('seasonId', sql.BigInt, seasonId)
    .query('DELETE FROM dbo.seasons OUTPUT deleted.id WHERE id = @seasonId AND lodge_id = @lodgeId');
  if (result.recordset.length === 0) {
    throw new ApiError('Season not found.', 404);
  }
}

module.exports = { listSeasons, createSeason, updateSeason, deleteSeason };
