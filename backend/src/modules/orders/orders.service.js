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
// item ids, portion ids and quantities; anything it claims about price is
// ignored, so a tampered payload can't buy a thali for ₹1. A portion id is
// checked to belong to the item it was sent with, which is what stops the
// half-plate price of one dish being claimed for another.
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

  const portionRequest = pool.request().input('lodgeId', sql.BigInt, lodgeId);
  ids.forEach((id, index) => portionRequest.input(`pid${index}`, sql.BigInt, id));
  const portionResult = await portionRequest.query(`
    SELECT id, item_id, label, price, is_available
    FROM dbo.menu_item_portions
    WHERE lodge_id = @lodgeId
      AND item_id IN (${ids.map((_, index) => `@pid${index}`).join(', ')})
  `);

  const portionById = new Map(portionResult.recordset.map((row) => [String(row.id), row]));

  // Having any size row at all is what makes a dish size-only — there is no
  // flag to keep in step with the rows themselves.
  const itemsWithPortions = new Set(portionResult.recordset.map((row) => String(row.item_id)));

  const lines = [];
  for (const requested of requestedItems) {
    const row = byId.get(String(requested.itemId));
    if (!row || !row.is_active) {
      throw new ApiError('One of those items is no longer on the menu. Refresh and try again.', 409);
    }
    if (!row.is_available) {
      throw new ApiError(`“${row.name}” has just run out. Remove it and place the order again.`, 409);
    }

    // A dish that offers sizes has no price of its own to fall back on, so a
    // missing choice is refused rather than guessed at.
    if (!itemsWithPortions.has(String(row.id))) {
      const unitPrice = Number(row.price);
      lines.push({
        menuItemId: row.id,
        menuItemPortionId: null,
        itemName: row.name,
        portionLabel: null,
        unitPrice,
        quantity: requested.quantity,
        lineTotal: round2(unitPrice * requested.quantity),
      });
      continue;
    }

    if (!requested.portionId) {
      throw new ApiError(`Choose a size for “${row.name}”.`, 400);
    }

    const portion = portionById.get(String(requested.portionId));
    if (!portion || String(portion.item_id) !== String(row.id)) {
      throw new ApiError('One of those sizes is no longer on the menu. Refresh and try again.', 409);
    }
    if (!portion.is_available) {
      throw new ApiError(
        `“${row.name} (${portion.label})” has just run out. Remove it and place the order again.`,
        409
      );
    }

    const unitPrice = Number(portion.price);
    lines.push({
      menuItemId: row.id,
      menuItemPortionId: portion.id,
      // Composed here so the kitchen ticket, the bill and the reports all read
      // the size without any of them knowing portions exist.
      itemName: `${row.name} (${portion.label})`,
      portionLabel: portion.label,
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
        .input('menuItemPortionId', sql.BigInt, line.menuItemPortionId ?? null)
        .input('itemName', sql.NVarChar, line.itemName)
        .input('portionLabel', sql.NVarChar, line.portionLabel ?? null)
        .input('unitPrice', sql.Decimal(10, 2), line.unitPrice)
        .input('quantity', sql.Int, line.quantity)
        .input('lineTotal', sql.Decimal(10, 2), line.lineTotal)
        .query(`
          INSERT INTO dbo.food_order_items
            (order_id, menu_item_id, menu_item_portion_id, item_name, portion_label,
             unit_price, quantity, line_total)
          VALUES
            (@orderId, @menuItemId, @menuItemPortionId, @itemName, @portionLabel,
             @unitPrice, @quantity, @lineTotal)
        `);
    }

    await transaction.commit();

    return { id: orderId, orderNumber, orderDate, status, subtotal, publicToken };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

// The line's id travels with it because the kitchen screen ticks lines off
// one at a time — it needs something to name the line it just cooked.
function mapOrderItem(row) {
  return {
    id: row.id,
    name: row.item_name,
    unitPrice: Number(row.unit_price),
    quantity: row.quantity,
    lineTotal: Number(row.line_total),
    readyAt: row.ready_at ?? null,
  };
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
    SELECT id, order_id, item_name, unit_price, quantity, line_total, ready_at
    FROM dbo.food_order_items
    WHERE order_id IN (${orderIdParams})
    ORDER BY id ASC
  `);

  const itemsByOrder = new Map();
  for (const row of itemsResult.recordset) {
    const list = itemsByOrder.get(String(row.order_id)) || [];
    list.push(mapOrderItem(row));
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
      SELECT id, item_name, unit_price, quantity, line_total, ready_at
      FROM dbo.food_order_items WHERE order_id = @orderId ORDER BY id ASC
    `);

  return mapOrder(row, itemsResult.recordset.map(mapOrderItem));
}

// Ticking a dish off as it comes out of the kitchen. Only once cooking has
// actually started: nothing on a ticket still waiting to be accepted, or still
// sitting in the queue untouched, can be ready, and an order already called
// ready has nothing left to tick. The status check is here rather than on the
// screen for the usual reason — two tablets, and the second one is a poll
// behind.
const ITEM_TICKABLE_STATUSES = ['PREPARING'];

async function setItemReady(lodgeId, orderId, itemId, ready) {
  const pool = await getPool();

  const orderResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('orderId', sql.BigInt, orderId)
    .query('SELECT status FROM dbo.food_orders WHERE id = @orderId AND lodge_id = @lodgeId');
  const order = orderResult.recordset[0];
  if (!order) {
    throw new ApiError('Order not found.', 404);
  }
  if (!ITEM_TICKABLE_STATUSES.includes(order.status)) {
    throw new ApiError(
      order.status === 'PENDING' || order.status === 'QUEUED'
        ? 'Start cooking this order before ticking dishes off it.'
        : `This order is already ${order.status.toLowerCase()} — its items can’t be ticked off now.`,
      409
    );
  }

  // order_id is in the WHERE as well as the id, so a line id from another
  // lodge's order can't be reached by pairing it with an order of your own.
  const result = await pool
    .request()
    .input('orderId', sql.BigInt, orderId)
    .input('itemId', sql.BigInt, itemId)
    .query(`
      UPDATE dbo.food_order_items
      SET ready_at = ${ready ? 'SYSDATETIMEOFFSET()' : 'NULL'}
      OUTPUT inserted.id
      WHERE id = @itemId AND order_id = @orderId
    `);

  if (result.recordset.length === 0) {
    throw new ApiError('That item is not on this order.', 404);
  }

  return getOrder(lodgeId, orderId);
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

  // Calling the whole order ready settles every line, so a ticket that was
  // moved on without each dish being ticked doesn't sit there reading as half
  // cooked for the rest of its life.
  if (nextStatus === 'READY') {
    await pool
      .request()
      .input('orderId', sql.BigInt, orderId)
      .query(`
        UPDATE dbo.food_order_items
        SET ready_at = SYSDATETIMEOFFSET()
        WHERE order_id = @orderId AND ready_at IS NULL
      `);
  }

  return getOrder(lodgeId, orderId);
}

module.exports = {
  NEXT_STATUSES,
  todayIsoIST,
  // Exported for its own sake: it is the only place a price is decided, and it
  // is worth being able to exercise without writing an order to do it.
  resolveOrderLines,
  createOrder,
  listOrders,
  getOrder,
  updateStatus,
  setItemReady,
};
