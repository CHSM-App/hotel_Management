const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');

// When a stay is due to end, and what the property charges for running past it.
// Lives on the lodge because it is one rule for the whole property, alongside
// checkin_mode — which decides how the deadline is worked out in the first
// place and is set once at registration.

function toClockTime(value) {
  if (value == null) return '11:00';
  if (typeof value === 'string') return value.slice(0, 5);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
}

function mapPolicy(row) {
  return {
    // Read-only here — it is chosen when the property is registered, and
    // changing it mid-life would restate what every open stay is owed.
    checkinMode: row.checkin_mode,
    checkOutTime: toClockTime(row.check_out_time),
    lateGraceMinutes: row.late_grace_minutes,
    lateHalfDayPercent: Number(row.late_half_day_percent),
    lateFullDayAfterMinutes: row.late_full_day_after_minutes,
    lateFullDayPercent: Number(row.late_full_day_percent),
  };
}

async function getCheckoutPolicy(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT checkin_mode, check_out_time, late_grace_minutes,
             late_half_day_percent, late_full_day_after_minutes, late_full_day_percent
      FROM dbo.lodges WHERE id = @lodgeId
    `);
  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('Property not found.', 404);
  }
  return mapPolicy(row);
}

async function updateCheckoutPolicy(lodgeId, input) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    // Sent as HH:MM and stored as TIME; seconds are appended rather than asked
    // for, because no lodge checks out at twenty past eleven and four seconds.
    .input('checkOutTime', sql.NVarChar, `${input.checkOutTime}:00`)
    .input('lateGraceMinutes', sql.Int, input.lateGraceMinutes)
    .input('lateHalfDayPercent', sql.Decimal(5, 2), input.lateHalfDayPercent)
    .input('lateFullDayAfterMinutes', sql.Int, input.lateFullDayAfterMinutes)
    .input('lateFullDayPercent', sql.Decimal(5, 2), input.lateFullDayPercent)
    .query(`
      UPDATE dbo.lodges
      SET check_out_time = CAST(@checkOutTime AS TIME(0)),
          late_grace_minutes = @lateGraceMinutes,
          late_half_day_percent = @lateHalfDayPercent,
          late_full_day_after_minutes = @lateFullDayAfterMinutes,
          late_full_day_percent = @lateFullDayPercent
      OUTPUT inserted.checkin_mode, inserted.check_out_time, inserted.late_grace_minutes,
             inserted.late_half_day_percent, inserted.late_full_day_after_minutes,
             inserted.late_full_day_percent
      WHERE id = @lodgeId
    `);
  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('Property not found.', 404);
  }
  return mapPolicy(row);
}

module.exports = { getCheckoutPolicy, updateCheckoutPolicy };
