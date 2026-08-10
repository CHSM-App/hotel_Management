const crypto = require('crypto');
const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');

// Handed to the guest's phone once, at placement, so it can poll its own
// order's status without being able to read anyone else's. Same shape as the
// table QR token in tables.service.js: 18 random bytes as base64url.
function newPublicToken() {
  return crypto.randomBytes(18).toString('base64url');
}

// Same IST rule the booking service uses: every lodge on this system is in
// India, so an order placed at 1am belongs to that IST day, not to the UTC
// day the server happens to still be on.
function todayIsoIST() {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// The states an order can move to from where it is now. CANCELLED is reachable
// from every live state — a guest changes their mind, or the kitchen can't
// make it — but nothing leaves DELIVERED or CANCELLED. Kept as data rather
// than a chain of ifs so the kitchen screen can render exactly these buttons.
const NEXT_STATUSES = {
  PENDING: ['QUEUED', 'CANCELLED'],
  QUEUED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};

const STATUS_TIMESTAMP_COLUMN = {
  QUEUED: 'accepted_at',
  READY: 'ready_at',
  DELIVERED: 'delivered_at',
  CANCELLED: 'cancelled_at',
};

// Order numbers restart daily and are called across a kitchen, so they're
// allocated per lodge per day. MERGE ... WITH (HOLDLOCK) is the atomic upsert:
// the first order of the day inserts the counter at 2 and takes 1, every
// later one increments and takes the previous value. Never SELECT MAX()+1.
async function allocateOrderNumber(transaction, lodgeId, orderDate) {
  const result = await new sql.Request(transaction)
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('orderDate', sql.Date, orderDate)
    .query(`
      MERGE dbo.food_order_counters WITH (HOLDLOCK) AS t
      USING (SELECT @lodgeId AS lodge_id, @orderDate AS order_date) AS s
        ON t.lodge_id = s.lodge_id AND t.order_date = s.order_date
      WHEN MATCHED THEN
        UPDATE SET next_number = t.next_number + 1
      WHEN NOT MATCHED THEN
        INSERT (lodge_id, order_date, next_number) VALUES (s.lodge_id, s.order_date, 2)
      OUTPUT ISNULL(deleted.next_number, 1) AS order_number;
    `);
  return result.recordset[0].order_number;
}

// Prices come from the database, never from the request. The client sends
// item ids and quantities; anything it claims about price is ignored, so a
// tampered payload can't buy a thali for ₹1.
async function resolveOrderLines(pool, lodgeId, requestedItems) {
  const ids = [...new Set(requestedItems.map((i) => i.itemId))];

  const request = pool.request().input('lodgeId', sql.BigInt, lodgeId);
  ids.forEach((id, index) => request.input(`id${index}`, sql.BigInt, id));
  const idParams = ids.map((_, index) => `@id${index}`).join(', ');

  const result = await request.query(`
    SELECT id, name, price, is_available, is_active
    FROM dbo.menu_items
    WHERE lodge_id = @lodgeId AND id IN (${idParams})
  `);

  const byId = new Map(result.recordset.map((row) => [String(row.id), row]));

  const lines = [];
  for (const requested of requestedItems) {
    const row = byId.get(String(requested.itemId));
    if (!row || !row.is_active) {
      throw new ApiError('One of those items is no longer on the menu. Refresh and try again.', 409);
    }
    if (!row.is_available) {
      throw new ApiError(`“${row.name}” has just run out. Remove it and place the order again.`, 409);
    }

    const unitPrice = Number(row.price);
    lines.push({
      menuItemId: row.id,
      itemName: row.name,
      unitPrice,
      quantity: requested.quantity,
      lineTotal: round2(unitPrice * requested.quantity),
    });
  }

  return lines;
}

// The single write path for every order, wherever it came from — a room QR, a
// table QR, or reception typing it in. Callers have already established *who*
// is ordering (see placeRoomOrder / placeTableOrder in public.service.js);
// this is only concerned with turning resolved lines into a numbered order.
async function createOrder(lodgeId, { source, roomId, bookingId, tableId, guestName, guestPhone, note, items, status, createdBy }) {
  if (items.length === 0) {
    throw new ApiError('Add at least one item to the order.', 400);
  }

  const pool = await getPool();
  const lines = await resolveOrderLines(pool, lodgeId, items);
  const subtotal = round2(lines.reduce((sum, l) => sum + l.lineTotal, 0));
  const orderDate = todayIsoIST();

  const publicToken = newPublicToken();

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const orderNumber = await allocateOrderNumber(transaction, lodgeId, orderDate);

    const orderResult = await new sql.Request(transaction)
      .input('publicToken', sql.NVarChar, publicToken)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('orderDate', sql.Date, orderDate)
      .input('orderNumber', sql.Int, orderNumber)
      .input('source', sql.NVarChar, source)
      .input('roomId', sql.BigInt, roomId ?? null)
      .input('bookingId', sql.BigInt, bookingId ?? null)
      .input('tableId', sql.BigInt, tableId ?? null)
      .input('guestName', sql.NVarChar, guestName || null)
      .input('guestPhone', sql.NVarChar, guestPhone || null)
      .input('note', sql.NVarChar, note || null)
      .input('status', sql.NVarChar, status)
      .input('subtotal', sql.Decimal(10, 2), subtotal)
      .input('createdBy', sql.BigInt, createdBy ?? null)
      .query(`
        INSERT INTO dbo.food_orders
          (lodge_id, order_date, order_number, source, room_id, booking_id, table_id,
           guest_name, guest_phone, note, status, subtotal, accepted_at, created_by, public_token)
        OUTPUT inserted.id
        VALUES
          (@lodgeId, @orderDate, @orderNumber, @source, @roomId, @bookingId, @tableId,
           @guestName, @guestPhone, @note, @status, @subtotal,
           CASE WHEN @status = 'QUEUED' THEN SYSDATETIMEOFFSET() ELSE NULL END, @createdBy, @publicToken)
      `);

    const orderId = orderResult.recordset[0].id;

    for (const line of lines) {
      await new sql.Request(transaction)
        .input('orderId', sql.BigInt, orderId)
        .input('menuItemId', sql.BigInt, line.menuItemId)
        .input('itemName', sql.NVarChar, line.itemName)
        .input('unitPrice', sql.Decimal(10, 2), line.unitPrice)
        .input('quantity', sql.Int, line.quantity)
        .input('lineTotal', sql.Decimal(10, 2), line.lineTotal)
        .query(`
          INSERT INTO dbo.food_order_items
            (order_id, menu_item_id, item_name, unit_price, quantity, line_total)
          VALUES
            (@orderId, @menuItemId, @itemName, @unitPrice, @quantity, @lineTotal)
        `);
    }

    await transaction.commit();

    return { id: orderId, orderNumber, orderDate, status, subtotal, publicToken };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

function mapOrder(row, items) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    orderDate: typeof row.order_date === 'string' ? row.order_date.slice(0, 10) : row.order_date?.toISOString().slice(0, 10),
    source: row.source,
    roomNumber: row.room_number || null,
    tableLabel: row.table_label || null,
    bookingId: row.booking_id,
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    note: row.note,
    status: row.status,
    subtotal: Number(row.subtotal),
    placedAt: row.placed_at,
    acceptedAt: row.accepted_at,
    readyAt: row.ready_at,
    deliveredAt: row.delivered_at,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    nextStatuses: NEXT_STATUSES[row.status] || [],
    items,
  };
}

async function listOrders(lodgeId, { status, date, live } = {}) {
  const pool = await getPool();

  const request = pool.request().input('lodgeId', sql.BigInt, lodgeId);
  const filters = ['o.lodge_id = @lodgeId'];

  // The kitchen queue is "everything still in play", regardless of date — an
  // order placed at 11:45pm and delivered at 12:05am must not vanish off the
  // screen mid-service when the IST date rolls over.
  if (live) {
    filters.push("o.status IN ('PENDING', 'QUEUED', 'PREPARING', 'READY')");
  } else {
    request.input('orderDate', sql.Date, date || todayIsoIST());
    filters.push('o.order_date = @orderDate');
    if (status) {
      request.input('status', sql.NVarChar, status);
      filters.push('o.status = @status');
    }
  }

  const ordersResult = await request.query(`
    SELECT o.id, o.order_number, o.order_date, o.source, o.booking_id, o.guest_name, o.guest_phone,
           o.note, o.status, o.subtotal, o.placed_at, o.accepted_at, o.ready_at, o.delivered_at,
           o.cancelled_at, o.cancel_reason,
           r.room_number, t.label AS table_label
    FROM dbo.food_orders o
    LEFT JOIN dbo.rooms r ON r.id = o.room_id
    LEFT JOIN dbo.dining_tables t ON t.id = o.table_id
    WHERE ${filters.join(' AND ')}
    ORDER BY o.placed_at ASC
  `);

  if (ordersResult.recordset.length === 0) {
    return [];
  }

  // Scoped to the orders actually being returned. Joining on lodge_id alone
  // would pull every line the lodge has ever sold to render one shift's queue.
  const orderIds = ordersResult.recordset.map((row) => row.id);
  const itemsRequest = pool.request();
  orderIds.forEach((id, index) => itemsRequest.input(`o${index}`, sql.BigInt, id));
  const orderIdParams = orderIds.map((_, index) => `@o${index}`).join(', ');

  const itemsResult = await itemsRequest.query(`
    SELECT order_id, item_name, unit_price, quantity, line_total
    FROM dbo.food_order_items
    WHERE order_id IN (${orderIdParams})
    ORDER BY id ASC
  `);

  const itemsByOrder = new Map();
  for (const row of itemsResult.recordset) {
    const list = itemsByOrder.get(String(row.order_id)) || [];
    list.push({
      name: row.item_name,
      unitPrice: Number(row.unit_price),
      quantity: row.quantity,
      lineTotal: Number(row.line_total),
    });
    itemsByOrder.set(String(row.order_id), list);
  }

  return ordersResult.recordset.map((row) => mapOrder(row, itemsByOrder.get(String(row.id)) || []));
}

async function getOrder(lodgeId, orderId) {
  const pool = await getPool();

  const orderResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('orderId', sql.BigInt, orderId)
    .query(`
      SELECT o.id, o.order_number, o.order_date, o.source, o.booking_id, o.guest_name, o.guest_phone,
             o.note, o.status, o.subtotal, o.placed_at, o.accepted_at, o.ready_at, o.delivered_at,
             o.cancelled_at, o.cancel_reason,
             r.room_number, t.label AS table_label
      FROM dbo.food_orders o
      LEFT JOIN dbo.rooms r ON r.id = o.room_id
      LEFT JOIN dbo.dining_tables t ON t.id = o.table_id
      WHERE o.id = @orderId AND o.lodge_id = @lodgeId
    `);

  const row = orderResult.recordset[0];
  if (!row) {
    throw new ApiError('Order not found.', 404);
  }

  const itemsResult = await pool
    .request()
    .input('orderId', sql.BigInt, orderId)
    .query(`
      SELECT item_name, unit_price, quantity, line_total
      FROM dbo.food_order_items WHERE order_id = @orderId ORDER BY id ASC
    `);

  return mapOrder(
    row,
    itemsResult.recordset.map((i) => ({
      name: i.item_name,
      unitPrice: Number(i.unit_price),
      quantity: i.quantity,
      lineTotal: Number(i.line_total),
    }))
  );
}

// Every move through the queue lands here. The transition table is enforced
// server-side rather than trusted from the button that was clicked: two people
// on two screens will tap the same order, and the second tap has to fail
// cleanly instead of dragging a delivered order back to preparing.
async function updateStatus(lodgeId, orderId, nextStatus, { cancelReason } = {}) {
  const pool = await getPool();

  const currentResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('orderId', sql.BigInt, orderId)
    .query('SELECT status FROM dbo.food_orders WHERE id = @orderId AND lodge_id = @lodgeId');
  const current = currentResult.recordset[0];
  if (!current) {
    throw new ApiError('Order not found.', 404);
  }

  const allowed = NEXT_STATUSES[current.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw new ApiError(
      `This order is already ${current.status.toLowerCase()} — it can’t be moved to ${nextStatus.toLowerCase()}.`,
      409
    );
  }

  const timestampColumn = STATUS_TIMESTAMP_COLUMN[nextStatus];
  const timestampSet = timestampColumn ? `, ${timestampColumn} = SYSDATETIMEOFFSET()` : '';

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('orderId', sql.BigInt, orderId)
    .input('nextStatus', sql.NVarChar, nextStatus)
    .input('currentStatus', sql.NVarChar, current.status)
    .input('cancelReason', sql.NVarChar, nextStatus === 'CANCELLED' ? cancelReason || null : null)
    .query(`
      UPDATE dbo.food_orders
      SET status = @nextStatus, cancel_reason = COALESCE(@cancelReason, cancel_reason)${timestampSet}
      OUTPUT inserted.id
      WHERE id = @orderId AND lodge_id = @lodgeId AND status = @currentStatus
    `);

  // Lost the race against another screen between the read and the write.
  if (result.recordset.length === 0) {
    throw new ApiError('Someone else just updated this order. Refresh to see where it is.', 409);
  }

  return getOrder(lodgeId, orderId);
}

module.exports = {
  NEXT_STATUSES,
  todayIsoIST,
  createOrder,
  listOrders,
  getOrder,
  updateStatus,
};
