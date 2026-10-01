const crypto = require('crypto');
const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const inventoryService = require('../inventory/inventory.service');

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
  READY: ['DELIVERED'],
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

// A captain changing an order until it is billed. Dishes the kitchen has
// already ticked off are food that exists (and whose ingredients are already
// deducted), so they are kept as they are; everything not yet cooked is
// replaced with exactly what was sent. Adding a dish to an order that was
// already READY or DELIVERED sends it back to PREPARING so the kitchen sees it.
// `createdBy` limits a captain to orders they rang in.
async function replaceOrderItems(lodgeId, orderId, items, { note, createdBy = null } = {}) {
  const pool = await getPool();
  const lines = items.length ? await resolveOrderLines(pool, lodgeId, items) : [];

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const found = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('orderId', sql.BigInt, orderId)
      .query(`
        SELECT status, invoice_id, created_by FROM dbo.food_orders WITH (UPDLOCK)
        WHERE id = @orderId AND lodge_id = @lodgeId
      `);
    const order = found.recordset[0];
    if (!order || (createdBy && String(order.created_by) !== String(createdBy))) {
      throw new ApiError('Order not found.', 404);
    }
    if (order.invoice_id != null) {
      throw new ApiError('This order has already been billed and can’t be changed.', 409);
    }
    if (order.status === 'CANCELLED') {
      throw new ApiError('This order was cancelled and can’t be changed.', 409);
    }

    const cooked = await new sql.Request(transaction)
      .input('orderId', sql.BigInt, orderId)
      .query('SELECT COUNT(*) AS n FROM dbo.food_order_items WHERE order_id = @orderId AND ready_at IS NOT NULL');
    if (lines.length === 0 && cooked.recordset[0].n === 0) {
      throw new ApiError('Add at least one item to the order.', 400);
    }

    await new sql.Request(transaction)
      .input('orderId', sql.BigInt, orderId)
      .query('DELETE FROM dbo.food_order_items WHERE order_id = @orderId AND ready_at IS NULL');

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

    const reopen = lines.length > 0 && ['READY', 'DELIVERED'].includes(order.status);
    await new sql.Request(transaction)
      .input('orderId', sql.BigInt, orderId)
      .input('note', sql.NVarChar, note ?? null)
      .query(`
        UPDATE dbo.food_orders
        SET subtotal = (SELECT COALESCE(SUM(line_total), 0) FROM dbo.food_order_items WHERE order_id = @orderId),
            note = COALESCE(@note, note)
            ${reopen ? ", status = 'PREPARING', ready_at = NULL, delivered_at = NULL, ready_to_bill_at = NULL" : ''}
        WHERE id = @orderId
      `);

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  return getOrder(lodgeId, orderId);
}

// The line's id travels with it because the kitchen screen ticks lines off
// one at a time — it needs something to name the line it just cooked.
function mapOrderItem(row) {
  return {
    id: row.id,
    menuItemId: row.menu_item_id,
    portionId: row.menu_item_portion_id ?? null,
    name: row.item_name,
    unitPrice: Number(row.unit_price),
    quantity: row.quantity,
    lineTotal: Number(row.line_total),
    readyAt: row.ready_at ?? null,
    deliveredAt: row.delivered_at ?? null,
    // Menu section the dish belongs to, so a ticket can be read by course.
    category: row.category_name ?? null,
    categorySort: row.category_sort ?? 0,
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
    // Once an invoice carries the order its lines are money — no more edits.
    billed: row.invoice_id != null,
    invoiceId: row.invoice_id ?? null,
    invoiceNumber: row.inv_number ?? null,
    readyToBill: row.ready_to_bill_at != null,
    // A guest's own QR order has nobody behind it until someone accepts it;
    // staff-entered orders carry their author from the start.
    tableId: row.table_id ?? null,
    roomId: row.room_id ?? null,
    // Paid or part-paid once a bill carries it; null while it is unbilled.
    payment:
      row.invoice_id == null
        ? null
        : {
            status: Number(row.inv_paid) >= Number(row.inv_total) ? 'PAID' : Number(row.inv_paid) > 0 ? 'PART' : 'UNPAID',
            method: row.inv_method || null,
          },
    guestOrder: row.created_by == null,
    handledBy: row.handler_name || null,
    nextStatuses: NEXT_STATUSES[row.status] || [],
    items,
  };
}

async function listOrders(lodgeId, { status, date, from, to, live, awaitingBill = false, createdBy } = {}) {
  const pool = await getPool();

  const request = pool.request().input('lodgeId', sql.BigInt, lodgeId);
  const filters = ['o.lodge_id = @lodgeId'];

  // The kitchen queue is "everything still in play", regardless of date — an
  // order placed at 11:45pm and delivered at 12:05am must not vanish off the
  // screen mid-service when the IST date rolls over.
  if (live) {
    // For someone who bills, an order stays in the queue after delivery until
    // it has been billed. A room order on a stay rides the stay bill, so it is
    // not held here.
    filters.push(
      awaitingBill
        ? "(o.status IN ('PENDING', 'QUEUED', 'PREPARING', 'READY') OR (o.status = 'DELIVERED' AND o.invoice_id IS NULL AND NOT (o.source = 'ROOM' AND o.booking_id IS NOT NULL)))"
        : "o.status IN ('PENDING', 'QUEUED', 'PREPARING', 'READY')"
    );
  } else {
    // A period (from..to, inclusive) or a single day; today when neither is given.
    if (from && to) {
      request.input('fromDate', sql.Date, from).input('toDate', sql.Date, to);
      // An order also belongs to the period its bill was issued in, so one placed
      // earlier but billed today still shows in today's History.
      filters.push(
        "(o.order_date BETWEEN @fromDate AND @toDate OR EXISTS (SELECT 1 FROM dbo.invoices bi WHERE bi.id = o.invoice_id AND CAST(SWITCHOFFSET(bi.created_at, '+05:30') AS date) BETWEEN @fromDate AND @toDate))"
      );
    } else {
      request.input('orderDate', sql.Date, date || todayIsoIST());
      filters.push(
        "(o.order_date = @orderDate OR EXISTS (SELECT 1 FROM dbo.invoices bi WHERE bi.id = o.invoice_id AND CAST(SWITCHOFFSET(bi.created_at, '+05:30') AS date) = @orderDate))"
      );
    }
    if (status) {
      request.input('status', sql.NVarChar, status);
      filters.push('o.status = @status');
    }
  }

  // A captain sees only what they themselves rang in, not the whole day's
  // trade — this is what lets orders.take read history at all without also
  // handing them the kitchen's full day.
  if (createdBy) {
    request.input('createdBy', sql.BigInt, createdBy);
    filters.push('o.created_by = @createdBy');
  }

  const ordersResult = await request.query(`
    SELECT o.id, o.order_number, o.order_date, o.source, o.booking_id,
           COALESCE(o.guest_name, bk.guest_name) AS guest_name, COALESCE(o.guest_phone, bk.guest_phone) AS guest_phone,
           o.note, o.status, o.subtotal, o.placed_at, o.accepted_at, o.ready_at, o.delivered_at,
           o.cancelled_at, o.cancel_reason, o.invoice_id, o.ready_to_bill_at, o.created_by, uh.name AS handler_name,
           o.table_id, o.room_id,
           (SELECT total_amount FROM dbo.invoices WHERE id = o.invoice_id) AS inv_total,
           (SELECT invoice_number FROM dbo.invoices WHERE id = o.invoice_id) AS inv_number,
           (SELECT COALESCE(SUM(amount), 0) FROM dbo.payment_lines WHERE invoice_id = o.invoice_id) AS inv_paid,
           (SELECT TOP 1 method FROM dbo.payment_lines WHERE invoice_id = o.invoice_id ORDER BY amount DESC) AS inv_method,
           r.room_number, t.label AS table_label
    FROM dbo.food_orders o
    LEFT JOIN dbo.rooms r ON r.id = o.room_id
    LEFT JOIN dbo.dining_tables t ON t.id = o.table_id
    LEFT JOIN dbo.users uh ON uh.id = COALESCE(o.accepted_by, o.created_by)
    LEFT JOIN dbo.bookings bk ON bk.id = o.booking_id
    WHERE ${filters.join(' AND ')}
    -- The kitchen queue works oldest-first; the history reads newest-first.
    ORDER BY o.placed_at ${live ? 'ASC' : 'DESC'}
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
    SELECT fi.id, fi.order_id, fi.menu_item_id, fi.menu_item_portion_id, fi.item_name, fi.unit_price, fi.quantity, fi.line_total, fi.ready_at, fi.delivered_at,
           (SELECT c.name FROM dbo.menu_items mi JOIN dbo.menu_categories c ON c.id = mi.category_id WHERE mi.id = fi.menu_item_id) AS category_name,
           (SELECT c.sort_order FROM dbo.menu_items mi JOIN dbo.menu_categories c ON c.id = mi.category_id WHERE mi.id = fi.menu_item_id) AS category_sort
    FROM dbo.food_order_items fi
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
      SELECT o.id, o.order_number, o.order_date, o.source, o.booking_id,
           COALESCE(o.guest_name, bk.guest_name) AS guest_name, COALESCE(o.guest_phone, bk.guest_phone) AS guest_phone,
             o.note, o.status, o.subtotal, o.placed_at, o.accepted_at, o.ready_at, o.delivered_at,
             o.cancelled_at, o.cancel_reason, o.invoice_id, o.ready_to_bill_at, o.created_by, uh.name AS handler_name,
           o.table_id, o.room_id,
           (SELECT total_amount FROM dbo.invoices WHERE id = o.invoice_id) AS inv_total,
           (SELECT invoice_number FROM dbo.invoices WHERE id = o.invoice_id) AS inv_number,
           (SELECT COALESCE(SUM(amount), 0) FROM dbo.payment_lines WHERE invoice_id = o.invoice_id) AS inv_paid,
           (SELECT TOP 1 method FROM dbo.payment_lines WHERE invoice_id = o.invoice_id ORDER BY amount DESC) AS inv_method,
             r.room_number, t.label AS table_label
      FROM dbo.food_orders o
      LEFT JOIN dbo.rooms r ON r.id = o.room_id
      LEFT JOIN dbo.dining_tables t ON t.id = o.table_id
      LEFT JOIN dbo.users uh ON uh.id = COALESCE(o.accepted_by, o.created_by)
      LEFT JOIN dbo.bookings bk ON bk.id = o.booking_id
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
      SELECT fi.id, fi.menu_item_id, fi.menu_item_portion_id, fi.item_name, fi.unit_price, fi.quantity, fi.line_total, fi.ready_at, fi.delivered_at,
             (SELECT c.name FROM dbo.menu_items mi JOIN dbo.menu_categories c ON c.id = mi.category_id WHERE mi.id = fi.menu_item_id) AS category_name,
           (SELECT c.sort_order FROM dbo.menu_items mi JOIN dbo.menu_categories c ON c.id = mi.category_id WHERE mi.id = fi.menu_item_id) AS category_sort
      FROM dbo.food_order_items fi WHERE fi.order_id = @orderId ORDER BY fi.id ASC
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

async function setItemReady(lodgeId, orderId, itemId, ready, { userId = null } = {}) {
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

  // The tick and the stock it eats share a transaction. A crash between them
  // would otherwise leave the kitchen screen and the store cupboard telling
  // different stories, with nothing to say which one was right.
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    // order_id is in the WHERE as well as the id, so a line id from another
    // lodge's order can't be reached by pairing it with an order of your own.
    //
    // ready_at is also matched on its *previous* value, which is what makes
    // this safe to deduct from: the row only moves on a real change of state,
    // so a double-tap — or the second tablet a poll behind — updates nothing
    // and consumes nothing. That guard is the whole idempotency story.
    const result = await new sql.Request(transaction)
      .input('orderId', sql.BigInt, orderId)
      .input('itemId', sql.BigInt, itemId)
      .query(`
        UPDATE dbo.food_order_items
        SET ready_at = ${ready ? 'SYSDATETIMEOFFSET()' : 'NULL'}
        OUTPUT inserted.id
        WHERE id = @itemId AND order_id = @orderId AND ready_at IS ${ready ? 'NULL' : 'NOT NULL'}
      `);

    if (result.recordset.length === 0) {
      // Nothing moved: either the line isn't on this order at all, or it was
      // already where it was being asked to go. Only the first is an error.
      const exists = await new sql.Request(transaction)
        .input('orderId', sql.BigInt, orderId)
        .input('itemId', sql.BigInt, itemId)
        .query('SELECT id FROM dbo.food_order_items WHERE id = @itemId AND order_id = @orderId');
      if (exists.recordset.length === 0) {
        throw new ApiError('That item is not on this order.', 404);
      }
    } else {
      await inventoryService.applyOrderItemStock(transaction, lodgeId, {
        orderId,
        orderItemId: itemId,
        reverse: !ready,
        userId,
      });
    }

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  return getOrder(lodgeId, orderId);
}

// The captain carrying one dish out. Only a dish the kitchen has ticked ready
// can go, and once the last dish of a READY order is handed over the order
// itself becomes DELIVERED — the same state "deliver everything" reaches.
async function setItemDelivered(lodgeId, orderId, itemId, { createdBy = null } = {}) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const orderResult = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('orderId', sql.BigInt, orderId)
      .query('SELECT status, created_by FROM dbo.food_orders WITH (UPDLOCK) WHERE id = @orderId AND lodge_id = @lodgeId');
    const order = orderResult.recordset[0];
    if (!order || (createdBy && String(order.created_by) !== String(createdBy))) {
      throw new ApiError('Order not found.', 404);
    }
    if (!['PREPARING', 'READY'].includes(order.status)) {
      throw new ApiError(`This order is already ${order.status.toLowerCase()} — its dishes can’t be delivered now.`, 409);
    }

    const item = (
      await new sql.Request(transaction)
        .input('orderId', sql.BigInt, orderId)
        .input('itemId', sql.BigInt, itemId)
        .query('SELECT ready_at, delivered_at FROM dbo.food_order_items WHERE id = @itemId AND order_id = @orderId')
    ).recordset[0];
    if (!item) throw new ApiError('That item is not on this order.', 404);
    if (!item.ready_at) throw new ApiError('The kitchen has not marked this dish ready yet.', 409);

    if (!item.delivered_at) {
      await new sql.Request(transaction)
        .input('itemId', sql.BigInt, itemId)
        .query('UPDATE dbo.food_order_items SET delivered_at = SYSDATETIMEOFFSET() WHERE id = @itemId');
    }

    if (order.status === 'READY') {
      await new sql.Request(transaction)
        .input('orderId', sql.BigInt, orderId)
        .query(`
          UPDATE dbo.food_orders
          SET status = 'DELIVERED', delivered_at = SYSDATETIMEOFFSET()
          WHERE id = @orderId AND status = 'READY'
            AND NOT EXISTS (SELECT 1 FROM dbo.food_order_items WHERE order_id = @orderId AND delivered_at IS NULL)
        `);
    }

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  return getOrder(lodgeId, orderId);
}

// Partial cancel: drops the chosen dishes off a live, unbilled order. Only
// dishes the kitchen has not finished can go. If that leaves nothing on the
// ticket the order itself is cancelled.
async function cancelOrderItems(lodgeId, orderId, itemIds, { cancelReason, createdBy = null, returning = false } = {}) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const found = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('orderId', sql.BigInt, orderId)
      .query('SELECT status, invoice_id, created_by FROM dbo.food_orders WITH (UPDLOCK) WHERE id = @orderId AND lodge_id = @lodgeId');
    const order = found.recordset[0];
    if (!order || (createdBy && String(order.created_by) !== String(createdBy))) {
      throw new ApiError('Order not found.', 404);
    }
    if (order.invoice_id != null) {
      throw new ApiError('This order has already been billed and can’t be changed.', 409);
    }
    // A returned dish is a correction to food already out (READY or DELIVERED);
    // an ordinary cancel is only for what has not been cooked.
    const allowed = returning ? ['PREPARING', 'READY', 'DELIVERED'] : ['PENDING', 'QUEUED', 'PREPARING'];
    if (!allowed.includes(order.status)) {
      throw new ApiError(`This order is already ${order.status.toLowerCase()} — its dishes can’t be cancelled.`, 409);
    }

    const items = (
      await new sql.Request(transaction)
        .input('orderId', sql.BigInt, orderId)
        .query('SELECT id, ready_at FROM dbo.food_order_items WHERE order_id = @orderId')
    ).recordset;
    const byId = new Map(items.map((i) => [String(i.id), i]));
    for (const id of itemIds) {
      const item = byId.get(String(id));
      if (!item) throw new ApiError('That item is not on this order.', 404);
      if (item.ready_at && !returning) throw new ApiError('A dish that is already ready can’t be cancelled.', 409);
      if (!item.ready_at && returning) throw new ApiError('Only a dish that has come out can be returned.', 409);
    }

    const del = new sql.Request(transaction).input('orderId', sql.BigInt, orderId);
    itemIds.forEach((id, i) => del.input(`i${i}`, sql.BigInt, id));
    await del.query(`DELETE FROM dbo.food_order_items WHERE order_id = @orderId AND id IN (${itemIds.map((_, i) => `@i${i}`).join(', ')})`);

    const empty = items.length === itemIds.length;
    await new sql.Request(transaction)
      .input('orderId', sql.BigInt, orderId)
      .input('reason', sql.NVarChar, cancelReason || null)
      .query(`
        UPDATE dbo.food_orders
        SET subtotal = (SELECT COALESCE(SUM(line_total), 0) FROM dbo.food_order_items WHERE order_id = @orderId)
            ${empty ? ', status = \'CANCELLED\', cancelled_at = SYSDATETIMEOFFSET(), cancel_reason = @reason' : ''}
        WHERE id = @orderId
      `);

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
  return getOrder(lodgeId, orderId);
}

// The captain says a fully delivered order is done and the guest is ready to
// pay: it leaves their queue and shows up in Billing's "Food to bill".
async function markReadyToBill(lodgeId, orderId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('orderId', sql.BigInt, orderId)
    .query(`
      UPDATE dbo.food_orders SET ready_to_bill_at = COALESCE(ready_to_bill_at, SYSDATETIMEOFFSET())
      WHERE id = @orderId AND lodge_id = @lodgeId AND status = 'DELIVERED' AND invoice_id IS NULL
    `);
  if (result.rowsAffected[0] === 0) {
    throw new ApiError('Only a fully delivered, unbilled order can be marked ready to bill.', 409);
  }
  return getOrder(lodgeId, orderId);
}

// Running tabs: what each table and room has ordered and not yet been billed
// for, so a captain can see "T6 · 3 orders · ₹1,240 · 1 still cooking" at a
// glance. Counter orders are one-off and left out. A room with a guest checked
// in rides on the stay bill, so it is shown but not marked billable here.
async function listRunningTabs(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT o.source, o.table_id, o.room_id,
             CASE WHEN o.source = 'ROOM' THEN o.booking_id END AS booking_id,
             MAX(t.label) AS table_label, MAX(r.room_number) AS room_number,
             COUNT(*) AS order_count, SUM(o.subtotal) AS total,
             SUM(CASE WHEN o.status IN ('PENDING') THEN 1 ELSE 0 END) AS pending_count,
             SUM(CASE WHEN o.status IN ('QUEUED', 'PREPARING', 'READY') THEN 1 ELSE 0 END) AS live_count,
             MAX(o.placed_at) AS last_at
      FROM dbo.food_orders o
      LEFT JOIN dbo.dining_tables t ON t.id = o.table_id
      LEFT JOIN dbo.rooms r ON r.id = o.room_id
      WHERE o.lodge_id = @lodgeId AND o.invoice_id IS NULL AND o.status <> 'CANCELLED'
        AND o.source IN ('TABLE', 'ROOM')
      GROUP BY o.source, o.table_id, o.room_id, CASE WHEN o.source = 'ROOM' THEN o.booking_id END
      ORDER BY MAX(o.placed_at) DESC
    `);
  return result.recordset.map((row) => {
    const isTable = row.source === 'TABLE';
    return {
      tab: isTable ? `table-${row.table_id}` : row.booking_id != null ? `room-booking-${row.booking_id}` : `room-${row.room_id}`,
      label: isTable ? row.table_label : `Room ${row.room_number}`,
      source: row.source,
      // Table food is billed as its own tab; a stay's room food rides on the stay bill.
      billable: isTable,
      orderCount: row.order_count,
      total: Number(row.total),
      pendingCount: row.pending_count,
      liveCount: row.live_count,
      lastAt: row.last_at,
    };
  });
}

// Every move through the queue lands here. The transition table is enforced
// server-side rather than trusted from the button that was clicked: two people
// on two screens will tap the same order, and the second tap has to fail
// cleanly instead of dragging a delivered order back to preparing.
//
// `fromStatuses` narrows the transition table further for callers who may move
// an order on only from where they are allowed to touch it. A guest cancelling
// from their phone may do so while their order is still waiting; the kitchen
// may cancel a dish it has already started. Both are "→ CANCELLED", and only
// this tells them apart.
async function updateStatus(lodgeId, orderId, nextStatus, { cancelReason, userId = null, fromStatuses = null, createdBy = null } = {}) {
  const pool = await getPool();

  const currentResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('orderId', sql.BigInt, orderId)
    .query('SELECT status, created_by FROM dbo.food_orders WHERE id = @orderId AND lodge_id = @lodgeId');
  const current = currentResult.recordset[0];
  // `createdBy` confines a captain to orders they rang in.
  if (!current || (createdBy && String(current.created_by) !== String(createdBy))) {
    throw new ApiError('Order not found.', 404);
  }

  if (fromStatuses && !fromStatuses.includes(current.status)) {
    throw new ApiError(
      `This order is already ${current.status.toLowerCase()} — it can’t be moved from here.`,
      409
    );
  }

  const allowed = NEXT_STATUSES[current.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw new ApiError(
      `This order is already ${current.status.toLowerCase()} — it can’t be moved to ${nextStatus.toLowerCase()}.`,
      409
    );
  }

  // Food that has already come out of the kitchen can't be un-cooked, so the
  // order can only be cancelled dish by dish (see cancelOrderItems).
  if (nextStatus === 'CANCELLED') {
    const cooked = await pool
      .request()
      .input('orderId', sql.BigInt, orderId)
      .query('SELECT COUNT(*) AS n FROM dbo.food_order_items WHERE order_id = @orderId AND ready_at IS NOT NULL');
    if (cooked.recordset[0].n > 0) {
      throw new ApiError('Some dishes are already ready, so the whole order can’t be cancelled. Cancel the other dishes instead.', 409);
    }
  }

  const timestampColumn = STATUS_TIMESTAMP_COLUMN[nextStatus];
  let timestampSet = timestampColumn ? `, ${timestampColumn} = SYSDATETIMEOFFSET()` : '';
  // Accepting a pending order makes the accepter its owner.
  if (nextStatus === 'QUEUED' && current.status === 'PENDING') timestampSet += ', accepted_by = @acceptedBy';

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('orderId', sql.BigInt, orderId)
      .input('nextStatus', sql.NVarChar, nextStatus)
      .input('currentStatus', sql.NVarChar, current.status)
      .input('acceptedBy', sql.BigInt, userId)
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
    //
    // Those lines are cooked food that nobody ticked, so they eat their
    // ingredients here. Lines already ticked off are excluded by the same
    // `ready_at IS NULL` filter that settles them, which is what stops a dish
    // being deducted once on its tick and again on the order.
    // Delivering the whole order hands over every dish not already handed over.
    if (nextStatus === 'DELIVERED') {
      await new sql.Request(transaction)
        .input('orderId', sql.BigInt, orderId)
        .query('UPDATE dbo.food_order_items SET delivered_at = SYSDATETIMEOFFSET() WHERE order_id = @orderId AND delivered_at IS NULL');
    }

    if (nextStatus === 'READY') {
      const settled = await new sql.Request(transaction)
        .input('orderId', sql.BigInt, orderId)
        .query(`
          UPDATE dbo.food_order_items
          SET ready_at = SYSDATETIMEOFFSET()
          OUTPUT inserted.id
          WHERE order_id = @orderId AND ready_at IS NULL
        `);

      for (const row of settled.recordset) {
        await inventoryService.applyOrderItemStock(transaction, lodgeId, {
          orderId,
          orderItemId: row.id,
          userId,
        });
      }
    }

    // Cancelling deliberately gives nothing back. Whatever was ticked off had
    // already been cooked, and the onion in it is gone whether or not the guest
    // ever took the plate. Anything genuinely unused goes back through a
    // recount, which is the only person who can actually see the pan.

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
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
  replaceOrderItems,
  listOrders,
  getOrder,
  updateStatus,
  setItemReady,
  setItemDelivered,
  cancelOrderItems,
  listRunningTabs,
  markReadyToBill,
};
