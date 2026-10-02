const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');

const round2 = (n) => Math.round(n * 100) / 100;

function mapService(row) {
  return {
    id: row.id,
    name: row.name,
    unitLabel: row.unit_label,
    price: Number(row.price),
    gstRatePercent: Number(row.gst_rate_percent),
    isActive: !!row.is_active,
    isLaundry: !!row.is_laundry,
  };
}

async function listServices(lodgeId, { includeInactive = false } = {}) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT id, name, unit_label, price, gst_rate_percent, is_active, is_laundry
      FROM dbo.lodge_services
      WHERE lodge_id = @lodgeId ${includeInactive ? '' : 'AND is_active = 1'}
      ORDER BY name
    `);
  return result.recordset.map(mapService);
}

async function createService(lodgeId, input) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, input.name)
    .input('unit', sql.NVarChar, input.unitLabel)
    .input('price', sql.Decimal(10, 2), input.price)
    .input('gst', sql.Decimal(5, 2), input.gstRatePercent)
    .input('isLaundry', sql.Bit, input.isLaundry ? 1 : 0)
    .query(`
      INSERT INTO dbo.lodge_services (lodge_id, name, unit_label, price, gst_rate_percent, is_laundry)
      OUTPUT inserted.id, inserted.name, inserted.unit_label, inserted.price, inserted.gst_rate_percent,
             inserted.is_active, inserted.is_laundry
      VALUES (@lodgeId, @name, @unit, @price, @gst, @isLaundry)
    `);
  return mapService(result.recordset[0]);
}

// Only the catalogue changes: uses already recorded keep the price and GST
// they were snapshotted with.
async function updateService(lodgeId, id, input) {
  const pool = await getPool();
  const request = pool.request().input('lodgeId', sql.BigInt, lodgeId).input('id', sql.BigInt, id);
  const sets = [];
  const add = (col, name, type, value) => {
    if (value === undefined) return;
    request.input(name, type, value);
    sets.push(`${col} = @${name}`);
  };
  add('name', 'name', sql.NVarChar, input.name);
  add('unit_label', 'unit', sql.NVarChar, input.unitLabel);
  add('price', 'price', sql.Decimal(10, 2), input.price);
  add('gst_rate_percent', 'gst', sql.Decimal(5, 2), input.gstRatePercent);
  add('is_active', 'active', sql.Bit, input.isActive);
  add('is_laundry', 'isLaundry', sql.Bit, input.isLaundry === undefined ? undefined : input.isLaundry ? 1 : 0);
  if (sets.length === 0) throw new ApiError('Nothing to update.', 400);
  const result = await request.query(`
    UPDATE dbo.lodge_services SET ${sets.join(', ')}
    OUTPUT inserted.id, inserted.name, inserted.unit_label, inserted.price, inserted.gst_rate_percent,
           inserted.is_active, inserted.is_laundry
    WHERE id = @id AND lodge_id = @lodgeId
  `);
  if (result.recordset.length === 0) throw new ApiError('Service not found.', 404);
  return mapService(result.recordset[0]);
}

const USAGE_SELECT = `
  SELECT u.id, u.service_id, u.service_name, u.unit_label, u.unit_price, u.gst_rate_percent, u.quantity,
         u.line_total, u.room_id, u.booking_id, u.guest_name, u.guest_phone, u.note, u.status,
         u.on_room_bill, u.invoice_id, u.started_at, u.completed_at, r.room_number
  FROM dbo.service_usages u
  LEFT JOIN dbo.rooms r ON r.id = u.room_id
`;

function mapUsage(row) {
  return {
    id: row.id,
    serviceId: row.service_id,
    serviceName: row.service_name,
    unitLabel: row.unit_label,
    unitPrice: Number(row.unit_price),
    gstRatePercent: Number(row.gst_rate_percent),
    quantity: Number(row.quantity),
    lineTotal: Number(row.line_total),
    roomId: row.room_id,
    roomNumber: row.room_number ?? null,
    bookingId: row.booking_id,
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    note: row.note,
    status: row.status,
    onRoomBill: !!row.on_room_bill,
    billed: row.invoice_id != null,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

// status: 'active' (in use), 'unbilled' (completed, not yet on a bill) or
// 'all' (the last 200). Unbilled includes uses already put on a room bill so
// the desk can see where they went.
async function listUsages(lodgeId, status = 'all') {
  const pool = await getPool();
  const where =
    status === 'active'
      ? "u.status = 'IN_USE'"
      : status === 'unbilled'
        ? "u.status = 'COMPLETED' AND u.invoice_id IS NULL"
        : // What Billing's "Services to bill" lists: ready, and not riding on a
          // stay's open room bill (see SERVICE_NOT_ON_STAY_BILL in billing.service).
          status === 'tobill'
          ? `u.status = 'COMPLETED' AND u.invoice_id IS NULL AND (u.on_room_bill = 0 OR EXISTS (
               SELECT 1 FROM dbo.invoices bi WHERE bi.booking_id = u.booking_id AND bi.status = 'ISSUED'))`
          : '1 = 1';
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`SELECT TOP 200 * FROM (${USAGE_SELECT} WHERE u.lodge_id = @lodgeId AND ${where}) x ORDER BY started_at DESC`);
  return result.recordset.map(mapUsage);
}

async function startUsage(lodgeId, userId, input) {
  const pool = await getPool();
  const svc = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('id', sql.BigInt, input.serviceId)
    .query('SELECT * FROM dbo.lodge_services WHERE id = @id AND lodge_id = @lodgeId AND is_active = 1');
  const service = svc.recordset[0];
  if (!service) throw new ApiError('That service is not available.', 404);

  let roomId = null;
  let guestName = input.guestName || null;
  let guestPhone = input.guestPhone || null;
  if (input.bookingId) {
    const stay = await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('id', sql.BigInt, input.bookingId)
      .query("SELECT room_id, guest_name, guest_phone FROM dbo.bookings WHERE id = @id AND lodge_id = @lodgeId AND status = 'CHECKED_IN'");
    if (stay.recordset.length === 0) throw new ApiError('That guest is not checked in.', 409);
    roomId = stay.recordset[0].room_id;
    guestName = guestName || stay.recordset[0].guest_name;
    guestPhone = guestPhone || stay.recordset[0].guest_phone;
  }

  const lineTotal = round2(Number(service.price) * input.quantity);
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('serviceId', sql.BigInt, service.id)
    .input('name', sql.NVarChar, service.name)
    .input('unit', sql.NVarChar, service.unit_label)
    .input('price', sql.Decimal(10, 2), service.price)
    .input('gst', sql.Decimal(5, 2), service.gst_rate_percent)
    .input('qty', sql.Decimal(8, 2), input.quantity)
    .input('total', sql.Decimal(10, 2), lineTotal)
    .input('roomId', sql.BigInt, roomId)
    .input('bookingId', sql.BigInt, input.bookingId ?? null)
    .input('guestName', sql.NVarChar, guestName)
    .input('guestPhone', sql.NVarChar, guestPhone)
    .input('note', sql.NVarChar, input.note || null)
    .input('userId', sql.BigInt, userId ?? null)
    .query(`
      INSERT INTO dbo.service_usages
        (lodge_id, service_id, service_name, unit_label, unit_price, gst_rate_percent, quantity, line_total,
         room_id, booking_id, guest_name, guest_phone, note, created_by)
      OUTPUT inserted.id
      VALUES (@lodgeId, @serviceId, @name, @unit, @price, @gst, @qty, @total,
              @roomId, @bookingId, @guestName, @guestPhone, @note, @userId)
    `);
  return getUsage(lodgeId, result.recordset[0].id);
}

async function getUsage(lodgeId, id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('id', sql.BigInt, id)
    .query(`${USAGE_SELECT} WHERE u.lodge_id = @lodgeId AND u.id = @id`);
  if (result.recordset.length === 0) throw new ApiError('Service use not found.', 404);
  return mapUsage(result.recordset[0]);
}

// IN_USE -> COMPLETED, which is what makes it "ready to bill".
async function completeUsage(lodgeId, id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('id', sql.BigInt, id)
    .query("UPDATE dbo.service_usages SET status = 'COMPLETED', completed_at = SYSDATETIMEOFFSET() WHERE id = @id AND lodge_id = @lodgeId AND status = 'IN_USE'");
  if (result.rowsAffected[0] === 0) throw new ApiError('This service is not in use.', 409);
  return getUsage(lodgeId, id);
}

// Allowed until a bill carries it; a billed use is corrected by voiding the bill.
async function cancelUsage(lodgeId, id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('id', sql.BigInt, id)
    .query("UPDATE dbo.service_usages SET status = 'CANCELLED' WHERE id = @id AND lodge_id = @lodgeId AND status IN ('IN_USE', 'COMPLETED') AND invoice_id IS NULL");
  if (result.rowsAffected[0] === 0) throw new ApiError('This service cannot be cancelled.', 409);
  return getUsage(lodgeId, id);
}

module.exports = { listServices, createService, updateService, listUsages, startUsage, completeUsage, cancelUsage };
