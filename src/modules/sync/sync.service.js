const { getPool, sql } = require('../../config/connection');
const bookingsService = require('../bookings/bookings.service');
const { getCheckoutPolicy } = require('../rooms/checkoutPolicy.service');

// What a device needs in its pocket to keep the desk running with no network:
// the rooms and what they cost, the seasons and GST slabs that price a stay and
// its bill, the property's check-out policy, and the room chart for the coming
// weeks.
//
// One call rather than the dozen the web front desk makes, and readable by any
// role that may take bookings. The existing endpoints for these (/rooms,
// /seasons, /categories) need the rooms-admin permission, and there is no
// endpoint for GST slabs at all — a desk with only `bookings.manage` could not
// have downloaded what it needs to quote a price. Read-only; nothing here is
// written.

const IST_OFFSET_MINUTES = 330;

function istDate(daysFromToday = 0) {
  const shifted = new Date(Date.now() + IST_OFFSET_MINUTES * 60000 + daysFromToday * 86400000);
  return shifted.toISOString().slice(0, 10);
}

function isoDate(value) {
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function shapeSeasons(rows) {
  return rows.map((row) => ({
    name: row.name,
    percent: Number(row.adjustment_percent),
    startDate: isoDate(row.start_date),
    endDate: isoDate(row.end_date),
    isActive: true,
  }));
}

function shapeSlabs(rows) {
  return rows.map((row) => ({
    supplyType: row.supply_type,
    maxAmount: row.max_amount == null ? null : Number(row.max_amount),
    ratePercent: Number(row.rate_percent),
    sacCode: row.sac_code ?? null,
    // Only meaningful for FOOD: 18% inside specified premises, 5% outside. Null
    // means the row applies either way.
    appliesToSpecified: row.applies_to_specified == null ? null : !!row.applies_to_specified,
  }));
}

async function getBootstrap(lodgeId) {
  const pool = await getPool();

  // Every active room with its rate and the extras it can take. Asked about a
  // date nothing is booked on, so none is filtered out for being occupied —
  // availability is worked out on the device from the chart below.
  const { rooms } = await bookingsService.listAvailableRooms(lodgeId, '2999-01-01', '2999-01-02');

  const seasonRows = (
    await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('today', sql.Date, istDate(0))
      .query(`
        SELECT name, adjustment_percent, start_date, end_date
        FROM dbo.seasons
        WHERE lodge_id = @lodgeId AND is_active = 1 AND end_date >= @today
        ORDER BY start_date ASC
      `)
  ).recordset;

  const slabRows = (
    await pool.request().query(`
      SELECT supply_type, max_amount, rate_percent, sac_code, applies_to_specified
      FROM dbo.gst_slabs
      WHERE is_active = 1
      ORDER BY supply_type, CASE WHEN max_amount IS NULL THEN 1 ELSE 0 END, max_amount ASC
    `)
  ).recordset;

  const lodgeRow = (
    await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .query('SELECT is_gst_registered, is_specified_premises, gstin FROM dbo.lodges WHERE id = @lodgeId')
  ).recordset[0];

  const policy = await getCheckoutPolicy(lodgeId);
  const windowFrom = istDate(-7);
  const windowTo = istDate(90);
  const tapeChart = await bookingsService.getTapeChart(lodgeId, windowFrom, windowTo);

  return {
    serverTime: new Date().toISOString(),
    today: istDate(0),
    window: { from: windowFrom, to: windowTo },
    lodge: {
      isGstRegistered: !!lodgeRow?.is_gst_registered,
      isSpecifiedPremises: !!lodgeRow?.is_specified_premises,
      gstin: lodgeRow?.gstin ?? null,
      ...policy,
    },
    rooms,
    seasons: shapeSeasons(seasonRows),
    gstSlabs: shapeSlabs(slabRows),
    tapeChart,
  };
}

module.exports = { getBootstrap, shapeSeasons, shapeSlabs, istDate };
