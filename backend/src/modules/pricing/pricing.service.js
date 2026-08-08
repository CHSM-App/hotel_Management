const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function simulate(lodgeId, roomId, dateStr, chargeIds = []) {
  const pool = await getPool();

  const roomResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roomId', sql.BigInt, roomId)
    .query(`
      SELECT r.id, r.room_number,
             c.name AS category_name, c.base_price AS category_base_price
      FROM dbo.rooms r
      JOIN dbo.room_categories c ON c.id = r.category_id
      WHERE r.id = @roomId AND r.lodge_id = @lodgeId
    `);

  const room = roomResult.recordset[0];
  if (!room) {
    throw new ApiError('Room not found.', 404);
  }

  const lines = [];
  lines.push({ label: `${room.category_name} — base price`, amount: Number(room.category_base_price) });
  let subtotal = Number(room.category_base_price);

  const seasonsResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('date', sql.Date, dateStr)
    .query(`
      SELECT name, adjustment_percent
      FROM dbo.seasons
      WHERE lodge_id = @lodgeId AND is_active = 1 AND @date BETWEEN start_date AND end_date
      ORDER BY start_date ASC
    `);

  for (const row of seasonsResult.recordset) {
    const percent = Number(row.adjustment_percent);
    const amount = round2(subtotal * (percent / 100));
    lines.push({ label: `${row.name} (${percent > 0 ? '+' : ''}${percent}%)`, amount });
    subtotal += amount;
  }

  // Switchable charges (AC, extra bed) are added after the season
  // adjustment, flat — a ₹500 AC charge stays ₹500 during a +25% festival,
  // it never compounds with the season percentage.
  if (chargeIds.length > 0) {
    const chargesResult = await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .query(`
        SELECT id, name, charge_per_night
        FROM dbo.switchable_charges
        WHERE lodge_id = @lodgeId AND is_active = 1
      `);

    const requestedIds = new Set(chargeIds.map(Number));
    for (const row of chargesResult.recordset) {
      if (!requestedIds.has(Number(row.id))) continue;
      const amount = Number(row.charge_per_night);
      lines.push({ label: `${row.name} (switched on)`, amount });
      subtotal += amount;
    }
  }

  return {
    roomNumber: room.room_number,
    date: dateStr,
    lines,
    total: round2(subtotal),
  };
}

module.exports = { simulate };
