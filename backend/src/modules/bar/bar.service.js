const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const ordersService = require('../orders/orders.service');
const billing = require('../billing/billing.service');
const { cleanTag, customerKey } = require('../orders/customerTag');

// Bar module. Everything lives in bar_* tables so no restaurant report can pick
// a bar sale up. Stock is a single number per product, in ml; bottles are
// derived (floor(ml / bottle_ml) + loose ml) so there is nothing to drift.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const todayIST = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

function stockView(stockMl, bottleMl) {
  const sign = stockMl < 0 ? -1 : 1;
  const abs = Math.abs(stockMl);
  return {
    stockMl,
    bottles: sign * Math.floor(abs / bottleMl),
    looseMl: sign * (abs % bottleMl),
  };
}

async function begin() {
  const tx = new sql.Transaction(await getPool());
  await tx.begin();
  return tx;
}

// ---------------------------------------------------------------- settings

async function getSettings(lodgeId) {
  const r = await (await getPool())
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query('SELECT bar_tax_percent, bar_default_low_stock_ml FROM dbo.lodges WHERE id = @lodgeId');
  const row = r.recordset[0];
  return { taxPercent: Number(row.bar_tax_percent), defaultLowStockMl: row.bar_default_low_stock_ml };
}

async function updateSettings(lodgeId, input) {
  const cur = await getSettings(lodgeId);
  const taxPercent = input.taxPercent ?? cur.taxPercent;
  const low = input.defaultLowStockMl !== undefined ? input.defaultLowStockMl : cur.defaultLowStockMl;
  await (await getPool())
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('t', sql.Decimal(5, 2), taxPercent)
    .input('low', sql.Int, low)
    .query('UPDATE dbo.lodges SET bar_tax_percent = @t, bar_default_low_stock_ml = @low WHERE id = @lodgeId');
  return { taxPercent, defaultLowStockMl: low };
}

// -------------------------------------------------------------------- menu

async function listCategories(lodgeId) {
  const r = await (await getPool())
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query('SELECT id, name, sort_order, is_active FROM dbo.bar_categories WHERE lodge_id = @lodgeId ORDER BY sort_order, name');
  return r.recordset.map((c) => ({ id: c.id, name: c.name, sortOrder: c.sort_order, isActive: !!c.is_active }));
}

async function saveCategory(lodgeId, categoryId, input) {
  const pool = await getPool();
  try {
    if (categoryId == null) {
      const r = await pool
        .request()
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('n', sql.NVarChar, input.name)
        .input('s', sql.Int, input.sortOrder ?? 0)
        .query('INSERT INTO dbo.bar_categories (lodge_id, name, sort_order) OUTPUT inserted.id VALUES (@lodgeId, @n, @s)');
      return { id: r.recordset[0].id };
    }
    const r = await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('id', sql.BigInt, categoryId)
      .input('n', sql.NVarChar, input.name)
      .input('s', sql.Int, input.sortOrder ?? 0)
      .input('a', sql.Bit, input.isActive ?? true)
      .query('UPDATE dbo.bar_categories SET name=@n, sort_order=@s, is_active=@a WHERE id=@id AND lodge_id=@lodgeId');
    if (!r.rowsAffected[0]) throw new ApiError('Category not found.', 404);
    return { id: categoryId };
  } catch (err) {
    if (err.number === 2627 || err.number === 2601) throw new ApiError('A category with this name already exists.', 409, 'name');
    throw err;
  }
}

// Deleting a category keeps its products: they move to "No category".
async function deleteCategory(lodgeId, categoryId) {
  const tx = await begin();
  try {
    await new sql.Request(tx).input('lodgeId', sql.BigInt, lodgeId).input('id', sql.BigInt, categoryId)
      .query('UPDATE dbo.bar_products SET category_id = NULL WHERE category_id = @id AND lodge_id = @lodgeId');
    const r = await new sql.Request(tx).input('lodgeId', sql.BigInt, lodgeId).input('id', sql.BigInt, categoryId)
      .query('DELETE FROM dbo.bar_categories WHERE id = @id AND lodge_id = @lodgeId');
    if (!r.rowsAffected[0]) throw new ApiError('Category not found.', 404);
    await tx.commit();
    return { ok: true };
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

// Menu = categories + products (with stock) + their selling sizes.
async function getMenu(lodgeId) {
  const pool = await getPool();
  const settings = await getSettings(lodgeId);
  const [cats, prods, sizes] = await Promise.all([
    listCategories(lodgeId),
    pool.request().input('lodgeId', sql.BigInt, lodgeId).query(
      `SELECT id, category_id, name, brand, bottle_ml, stock_ml, low_stock_ml, is_active
       FROM dbo.bar_products WHERE lodge_id = @lodgeId ORDER BY name`
    ),
    pool.request().input('lodgeId', sql.BigInt, lodgeId).query(
      `SELECT id, product_id, size_label, ml_per_unit, price, is_available, is_active
       FROM dbo.bar_menu_items WHERE lodge_id = @lodgeId ORDER BY ml_per_unit`
    ),
  ]);
  const products = prods.recordset.map((p) => {
    const limit = p.low_stock_ml ?? settings.defaultLowStockMl;
    return {
      id: p.id,
      categoryId: p.category_id,
      name: p.name,
      brand: p.brand,
      bottleMl: p.bottle_ml,
      ...stockView(p.stock_ml, p.bottle_ml),
      lowStockMl: p.low_stock_ml,
      effectiveLowStockMl: limit,
      isLow: limit != null && p.stock_ml <= limit,
      isActive: !!p.is_active,
      sizes: sizes.recordset
        .filter((s) => s.product_id === p.id)
        .map((s) => ({
          id: s.id,
          label: s.size_label,
          ml: s.ml_per_unit,
          price: Number(s.price),
          isAvailable: !!s.is_available,
          isActive: !!s.is_active,
        })),
    };
  });
  return { categories: cats, products, settings };
}

async function moveStock(tx, lodgeId, productId, changeMl, reason, { orderId = null, note = null, userId = null } = {}) {
  const r = await new sql.Request(tx)
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('p', sql.BigInt, productId)
    .input('c', sql.Int, changeMl)
    .query(
      `UPDATE dbo.bar_products SET stock_ml = stock_ml + @c
       OUTPUT inserted.stock_ml AS balance
       WHERE id = @p AND lodge_id = @lodgeId`
    );
  if (!r.recordset.length) throw new ApiError('Product not found.', 404);
  const balance = r.recordset[0].balance;
  await new sql.Request(tx)
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('p', sql.BigInt, productId)
    .input('c', sql.Int, changeMl)
    .input('b', sql.Int, balance)
    .input('r', sql.NVarChar, reason)
    .input('o', sql.BigInt, orderId)
    .input('n', sql.NVarChar, note)
    .input('u', sql.BigInt, userId)
    .query(
      `INSERT INTO dbo.bar_stock_movements (lodge_id, product_id, change_ml, balance_after, reason, ref_order_id, note, created_by)
       VALUES (@lodgeId, @p, @c, @b, @r, @o, @n, @u)`
    );
  return balance;
}

async function insertSize(tx, lodgeId, productId, s) {
  await new sql.Request(tx)
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('p', sql.BigInt, productId)
    .input('n', sql.NVarChar, s.label)
    .input('m', sql.Int, s.ml)
    .input('pr', sql.Decimal(10, 2), s.price)
    .query(
      `INSERT INTO dbo.bar_menu_items (lodge_id, product_id, size_label, ml_per_unit, price)
       VALUES (@lodgeId, @p, @n, @m, @pr)`
    );
}

async function createProduct(lodgeId, input, userId) {
  const tx = await begin();
  try {
    const r = await new sql.Request(tx)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('c', sql.BigInt, input.categoryId ?? null)
      .input('n', sql.NVarChar, input.name)
      .input('b', sql.NVarChar, input.brand ?? null)
      .input('bm', sql.Int, input.bottleMl)
      .input('low', sql.Int, input.lowStockMl ?? null)
      .query(
        `INSERT INTO dbo.bar_products (lodge_id, category_id, name, brand, bottle_ml, low_stock_ml)
         OUTPUT inserted.id VALUES (@lodgeId, @c, @n, @b, @bm, @low)`
      );
    const productId = r.recordset[0].id;
    for (const s of input.sizes || []) await insertSize(tx, lodgeId, productId, s);
    const opening = (input.openingBottles || 0) * input.bottleMl + (input.openingMl || 0);
    if (opening > 0) await moveStock(tx, lodgeId, productId, opening, 'OPENING', { userId });
    await tx.commit();
    return { id: productId };
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

async function updateProduct(lodgeId, productId, input) {
  const r = await (await getPool())
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('id', sql.BigInt, productId)
    .input('c', sql.BigInt, input.categoryId ?? null)
    .input('n', sql.NVarChar, input.name)
    .input('b', sql.NVarChar, input.brand ?? null)
    .input('bm', sql.Int, input.bottleMl)
    .input('low', sql.Int, input.lowStockMl ?? null)
    .input('a', sql.Bit, input.isActive ?? true)
    .query(
      `UPDATE dbo.bar_products
       SET category_id=@c, name=@n, brand=@b, bottle_ml=@bm, low_stock_ml=@low, is_active=@a
       WHERE id=@id AND lodge_id=@lodgeId`
    );
  if (!r.rowsAffected[0]) throw new ApiError('Product not found.', 404);
  return { id: productId };
}

async function addSize(lodgeId, productId, input) {
  const p = await (await getPool())
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('p', sql.BigInt, productId)
    .query('SELECT id FROM dbo.bar_products WHERE id=@p AND lodge_id=@lodgeId');
  if (!p.recordset.length) throw new ApiError('Product not found.', 404);
  const tx = await begin();
  try {
    await insertSize(tx, lodgeId, productId, input);
    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
  return { ok: true };
}

async function updateSize(lodgeId, sizeId, input) {
  const r = await (await getPool())
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('id', sql.BigInt, sizeId)
    .input('n', sql.NVarChar, input.label ?? null)
    .input('m', sql.Int, input.ml ?? null)
    .input('pr', sql.Decimal(10, 2), input.price ?? null)
    .input('av', sql.Bit, input.isAvailable ?? null)
    .input('ac', sql.Bit, input.isActive ?? null)
    .query(
      `UPDATE dbo.bar_menu_items
       SET size_label = ISNULL(@n, size_label), ml_per_unit = ISNULL(@m, ml_per_unit),
           price = ISNULL(@pr, price), is_available = ISNULL(@av, is_available), is_active = ISNULL(@ac, is_active)
       WHERE id=@id AND lodge_id=@lodgeId`
    );
  if (!r.rowsAffected[0]) throw new ApiError('Size not found.', 404);
  return { id: sizeId };
}

// ------------------------------------------------------------------- stock

async function adjustStock(lodgeId, productId, input, userId) {
  const pool = await getPool();
  const p = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('p', sql.BigInt, productId)
    .query('SELECT bottle_ml FROM dbo.bar_products WHERE id=@p AND lodge_id=@lodgeId');
  if (!p.recordset.length) throw new ApiError('Product not found.', 404);
  const amount = input.bottles * p.recordset[0].bottle_ml + input.ml;
  const removes = input.reason === 'WASTAGE' || (input.reason === 'ADJUSTMENT' && input.direction === 'REMOVE');
  if (input.reason === 'ADJUSTMENT' && !input.direction) throw new ApiError('Choose add or remove.', 400, 'direction');
  const tx = await begin();
  try {
    const balance = await moveStock(tx, lodgeId, productId, removes ? -amount : amount, input.reason, {
      note: input.note ?? null,
      userId,
    });
    await tx.commit();
    return { stockMl: balance, ...stockView(balance, p.recordset[0].bottle_ml) };
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

async function listMovements(lodgeId, productId, limit = 100) {
  const r = await (await getPool())
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('p', sql.BigInt, productId)
    .input('n', sql.Int, Math.min(Number(limit) || 100, 500))
    .query(
      `SELECT TOP (@n) id, change_ml, balance_after, reason, note, ref_order_id, created_at
       FROM dbo.bar_stock_movements WHERE lodge_id=@lodgeId AND product_id=@p ORDER BY id DESC`
    );
  return r.recordset.map((m) => ({
    id: m.id,
    changeMl: m.change_ml,
    balanceAfter: m.balance_after,
    reason: m.reason,
    note: m.note,
    orderId: m.ref_order_id,
    createdAt: m.created_at,
  }));
}

// ------------------------------------------------------------------ orders

// Prices and ml come from the database, never from the request.
async function resolveLines(tx, lodgeId, items) {
  const lines = [];
  for (const it of items) {
    const r = await new sql.Request(tx)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('id', sql.BigInt, it.menuItemId)
      .query(
        `SELECT m.id, m.product_id, m.size_label, m.ml_per_unit, m.price, m.is_available, m.is_active,
                p.name, p.is_active AS product_active
         FROM dbo.bar_menu_items m JOIN dbo.bar_products p ON p.id = m.product_id
         WHERE m.id=@id AND m.lodge_id=@lodgeId`
      );
    const m = r.recordset[0];
    if (!m || !m.is_active || !m.product_active) throw new ApiError('A selected bar item is no longer on the menu.', 400, 'items');
    if (!m.is_available) throw new ApiError(`${m.name} ${m.size_label} is not available right now.`, 400, 'items');
    lines.push({ ...it, m });
  }
  return lines;
}

async function insertLines(tx, lodgeId, orderId, lines, userId) {
  let added = 0;
  for (const { quantity, m } of lines) {
    const lineTotal = round2(Number(m.price) * quantity);
    added += lineTotal;
    await new sql.Request(tx)
      .input('o', sql.BigInt, orderId)
      .input('mi', sql.BigInt, m.id)
      .input('p', sql.BigInt, m.product_id)
      .input('n', sql.NVarChar, m.name)
      .input('s', sql.NVarChar, m.size_label)
      .input('ml', sql.Int, m.ml_per_unit)
      .input('up', sql.Decimal(10, 2), m.price)
      .input('q', sql.Int, quantity)
      .input('lt', sql.Decimal(10, 2), lineTotal)
      .query(
        `INSERT INTO dbo.bar_order_items (order_id, menu_item_id, product_id, item_name, size_label, ml_per_unit, unit_price, quantity, line_total)
         VALUES (@o, @mi, @p, @n, @s, @ml, @up, @q, @lt)`
      );
    await moveStock(tx, lodgeId, m.product_id, -(m.ml_per_unit * quantity), 'SALE', { orderId, userId });
  }
  await new sql.Request(tx)
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('o', sql.BigInt, orderId)
    .input('a', sql.Decimal(10, 2), round2(added))
    .query('UPDATE dbo.bar_orders SET subtotal = subtotal + @a WHERE id = @o AND lodge_id = @lodgeId');
}

// Restaurant food on a bar order: a normal food order (so the kitchen queue, the
// ready/deliver flow and recipe stock all work) tagged with this bar order, made
// in the same transaction. Its total is part of the bar order's total.
async function addFoodOrder(tx, lodgeId, barOrderId, ctx, foodItems, userId) {
  if (!foodItems?.length) return;
  const pool = await getPool();
  const lodge = (
    await pool.request().input('lodgeId', sql.BigInt, lodgeId).query('SELECT serves_food FROM dbo.lodges WHERE id = @lodgeId')
  ).recordset[0];
  if (!lodge?.serves_food) throw new ApiError('This property has no restaurant menu to order food from.', 400, 'foodItems');
  const food = await ordersService.createOrder(lodgeId, {
    source: ctx.source,
    roomId: ctx.roomId ?? null,
    bookingId: ctx.bookingId ?? null,
    tableId: ctx.tableId ?? null,
    guestName: ctx.guestName ?? null,
    guestPhone: ctx.guestPhone ?? null,
    items: foodItems.map((f) => ({ itemId: f.itemId, portionId: f.portionId ?? null, quantity: f.quantity })),
    status: ctx.foodStatus || 'QUEUED',
    note: ctx.note ?? null,
    customerTag: ctx.customerTag ?? null,
    createdBy: userId ?? null,
    barOrderId,
    transaction: tx,
  });
  await new sql.Request(tx)
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('o', sql.BigInt, barOrderId)
    .input('a', sql.Decimal(10, 2), food.subtotal)
    .query('UPDATE dbo.bar_orders SET subtotal = subtotal + @a, food_subtotal = food_subtotal + @a WHERE id = @o AND lodge_id = @lodgeId');
}

async function createOrder(lodgeId, input, userId) {
  const tx = await begin();
  try {
    const lines = await resolveLines(tx, lodgeId, input.items || []);
    const date = todayIST();
    const n = await new sql.Request(tx)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('d', sql.Date, date)
      .query(
        `SELECT ISNULL(MAX(order_number), 0) + 1 AS n
         FROM dbo.bar_orders WITH (UPDLOCK, HOLDLOCK) WHERE lodge_id=@lodgeId AND order_date=@d`
      );
    const r = await new sql.Request(tx)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('d', sql.Date, date)
      .input('n', sql.Int, n.recordset[0].n)
      .input('src', sql.NVarChar, input.source)
      .input('t', sql.BigInt, input.tableId ?? null)
      .input('r', sql.BigInt, input.roomId ?? null)
      .input('b', sql.BigInt, input.bookingId ?? null)
      .input('ro', sql.BigInt, input.restaurantOrderId ?? null)
      .input('gn', sql.NVarChar, input.guestName ?? null)
      .input('gp', sql.NVarChar, input.guestPhone ?? null)
      .input('u', sql.BigInt, userId ?? null)
      .input('ct', sql.NVarChar, input.source === 'TABLE' ? cleanTag(input.customerTag) : null)
      .query(
        `INSERT INTO dbo.bar_orders (lodge_id, order_date, order_number, source, table_id, room_id, booking_id,
           restaurant_order_id, guest_name, guest_phone, created_by, customer_tag)
         OUTPUT inserted.id
         VALUES (@lodgeId, @d, @n, @src, @t, @r, @b, @ro, @gn, @gp, @u, @ct)`
      );
    const orderId = r.recordset[0].id;
    await insertLines(tx, lodgeId, orderId, lines, userId);
    await addFoodOrder(tx, lodgeId, orderId, input, input.foodItems, userId);
    await tx.commit();
    return { id: orderId, orderNumber: n.recordset[0].n };
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

// Locks an open order and returns it, so callers can reuse its table/room/guest.
// An order posted to a room bill belongs to that stay's invoice, so it is frozen here
// (delivering is still allowed): void the stay bill to release it.
async function lockOpenOrder(tx, lodgeId, orderId, { allowRoomBill = false } = {}) {
  const r = await new sql.Request(tx)
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('id', sql.BigInt, orderId)
    .query(
      `SELECT id, status, source, table_id, room_id, booking_id, guest_name, guest_phone, on_room_bill, customer_tag
       FROM dbo.bar_orders WITH (UPDLOCK) WHERE id=@id AND lodge_id=@lodgeId`
    );
  const o = r.recordset[0];
  if (!o) throw new ApiError('Order not found.', 404);
  if (o.status !== 'OPEN') throw new ApiError('This order is already billed or cancelled.', 409);
  if (o.on_room_bill && !allowRoomBill) throw new ApiError('This order is on a room bill. Void that bill to change it.', 409);
  return {
    source: o.source,
    tableId: o.table_id,
    roomId: o.room_id,
    bookingId: o.booking_id,
    guestName: o.guest_name,
    guestPhone: o.guest_phone,
    customerTag: o.customer_tag,
  };
}

async function addItems(lodgeId, orderId, input, userId) {
  const tx = await begin();
  try {
    const ctx = await lockOpenOrder(tx, lodgeId, orderId);
    const lines = await resolveLines(tx, lodgeId, input.items || []);
    await insertLines(tx, lodgeId, orderId, lines, userId);
    await addFoodOrder(tx, lodgeId, orderId, ctx, input.foodItems, userId);
    // More was added, so it is no longer ready to bill.
    await new sql.Request(tx).input('lodgeId', sql.BigInt, lodgeId).input('o', sql.BigInt, orderId)
      .query('UPDATE dbo.bar_orders SET ready_to_bill_at = NULL WHERE id = @o AND lodge_id = @lodgeId');
    await tx.commit();
    return { id: orderId };
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

// ---- delivery. Drinks need no kitchen, so a drink is deliverable as soon as it is
// placed. Food is cooked by the kitchen and delivered through the restaurant's
// own flow (it has to be marked ready first); these just reach it with bar.take.

async function deliverItem(lodgeId, orderId, itemId) {
  const tx = await begin();
  try {
    await lockOpenOrder(tx, lodgeId, orderId, { allowRoomBill: true });
    const r = await new sql.Request(tx)
      .input('o', sql.BigInt, orderId)
      .input('i', sql.BigInt, itemId)
      .query(
        `UPDATE dbo.bar_order_items SET delivered_at = COALESCE(delivered_at, SYSDATETIMEOFFSET())
         WHERE id = @i AND order_id = @o AND is_cancelled = 0`
      );
    if (!r.rowsAffected[0]) throw new ApiError('Item not found on this order.', 404);
    await tx.commit();
    return { ok: true };
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

// Every drink at once; food that the kitchen has finished is handed over too, and
// dishes still being cooked are reported back rather than failing the whole call.
async function deliverAll(lodgeId, orderId) {
  const tx = await begin();
  try {
    await lockOpenOrder(tx, lodgeId, orderId, { allowRoomBill: true });
    await new sql.Request(tx)
      .input('o', sql.BigInt, orderId)
      .query('UPDATE dbo.bar_order_items SET delivered_at = COALESCE(delivered_at, SYSDATETIMEOFFSET()) WHERE order_id = @o AND is_cancelled = 0');
    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
  const foods = (
    await (await getPool())
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('o', sql.BigInt, orderId)
      .query("SELECT id FROM dbo.food_orders WHERE lodge_id = @lodgeId AND bar_order_id = @o AND status IN ('PREPARING', 'READY')")
  ).recordset;
  let foodNotReady = 0;
  for (const f of foods) {
    try {
      await ordersService.deliverAllItems(lodgeId, f.id);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 409) throw err;
      foodNotReady += 1;
    }
  }
  return { ok: true, foodNotReady };
}

async function deliverFoodItem(lodgeId, foodOrderId, itemId) {
  const found = (
    await (await getPool())
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('id', sql.BigInt, foodOrderId)
      .query('SELECT id FROM dbo.food_orders WHERE id = @id AND lodge_id = @lodgeId AND bar_order_id IS NOT NULL')
  ).recordset[0];
  if (!found) throw new ApiError('Order not found.', 404);
  await ordersService.setItemDelivered(lodgeId, foodOrderId, itemId, {});
  return { ok: true };
}

// Cancels given lines (or every active line when itemIds is null) and puts the ml
// back. A drink that has been served cannot be put back on the shelf.
async function cancelLines(tx, lodgeId, orderId, itemIds, userId) {
  const q = new sql.Request(tx).input('o', sql.BigInt, orderId);
  const filter = itemIds ? `AND id IN (${itemIds.map((_, i) => `@i${i}`).join(',')})` : '';
  (itemIds || []).forEach((v, i) => q.input(`i${i}`, sql.BigInt, v));
  const rows = (
    await q.query(
      `SELECT id, product_id, ml_per_unit, quantity, line_total, delivered_at FROM dbo.bar_order_items
       WHERE order_id=@o AND is_cancelled=0 ${filter}`
    )
  ).recordset;
  if (itemIds && rows.length !== itemIds.length) throw new ApiError('Item not found on this order.', 404);
  if (rows.some((row) => row.delivered_at)) {
    throw new ApiError('That drink has already been served. Record it under Wastage in Stock if it was not paid for.', 409);
  }
  let removed = 0;
  for (const row of rows) {
    await new sql.Request(tx).input('id', sql.BigInt, row.id).query('UPDATE dbo.bar_order_items SET is_cancelled=1 WHERE id=@id');
    await moveStock(tx, lodgeId, row.product_id, row.ml_per_unit * row.quantity, 'REVERSAL', { orderId, userId });
    removed += Number(row.line_total);
  }
  await new sql.Request(tx)
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('o', sql.BigInt, orderId)
    .input('a', sql.Decimal(10, 2), round2(removed))
    .query('UPDATE dbo.bar_orders SET subtotal = subtotal - @a WHERE id=@o AND lodge_id=@lodgeId');
}

// Change how many of an undelivered drink are on an open order; the ml follow it.
async function updateItemQty(lodgeId, orderId, itemId, quantity, userId) {
  const tx = await begin();
  try {
    await lockOpenOrder(tx, lodgeId, orderId);
    const row = (
      await new sql.Request(tx).input('o', sql.BigInt, orderId).input('i', sql.BigInt, itemId)
        .query('SELECT id, product_id, ml_per_unit, unit_price, quantity, delivered_at FROM dbo.bar_order_items WHERE id=@i AND order_id=@o AND is_cancelled=0')
    ).recordset[0];
    if (!row) throw new ApiError('Item not found on this order.', 404);
    if (row.delivered_at) throw new ApiError('That drink has already been served and cannot be changed.', 409);
    const delta = quantity - row.quantity;
    if (delta !== 0) {
      const lineTotal = round2(Number(row.unit_price) * quantity);
      const diff = round2(lineTotal - Number(row.unit_price) * row.quantity);
      await new sql.Request(tx).input('i', sql.BigInt, itemId).input('q', sql.Int, quantity).input('lt', sql.Decimal(10, 2), lineTotal)
        .query('UPDATE dbo.bar_order_items SET quantity=@q, line_total=@lt WHERE id=@i');
      await moveStock(tx, lodgeId, row.product_id, -(delta * row.ml_per_unit), delta > 0 ? 'SALE' : 'REVERSAL', { orderId, userId });
      await new sql.Request(tx).input('lodgeId', sql.BigInt, lodgeId).input('o', sql.BigInt, orderId).input('a', sql.Decimal(10, 2), diff)
        .query('UPDATE dbo.bar_orders SET subtotal = subtotal + @a, ready_to_bill_at = NULL WHERE id=@o AND lodge_id=@lodgeId');
    }
    await tx.commit();
    return { ok: true };
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

async function cancelItem(lodgeId, orderId, itemId, userId) {
  const tx = await begin();
  try {
    await lockOpenOrder(tx, lodgeId, orderId);
    await cancelLines(tx, lodgeId, orderId, [itemId], userId);
    await tx.commit();
    return { ok: true };
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

async function cancelOrder(lodgeId, orderId, userId) {
  const pool = await getPool();
  // Checked before anything is touched: a served drink or a cooked dish cannot be taken back.
  const open = (
    await pool.request().input('lodgeId', sql.BigInt, lodgeId).input('o', sql.BigInt, orderId)
      .query("SELECT status FROM dbo.bar_orders WHERE id = @o AND lodge_id = @lodgeId")
  ).recordset[0];
  if (!open) throw new ApiError('Order not found.', 404);
  if (open.status !== 'OPEN') throw new ApiError('This order is already billed or cancelled.', 409);
  const served = (
    await pool.request().input('o', sql.BigInt, orderId)
      .query('SELECT COUNT(*) AS n FROM dbo.bar_order_items WHERE order_id = @o AND is_cancelled = 0 AND delivered_at IS NOT NULL')
  ).recordset[0].n;
  if (served > 0) throw new ApiError('Some drinks have already been served, so the whole order cannot be cancelled. Remove the other items instead.', 409);
  const foods = (
    await pool.request().input('lodgeId', sql.BigInt, lodgeId).input('o', sql.BigInt, orderId)
      .query("SELECT id, status FROM dbo.food_orders WHERE lodge_id = @lodgeId AND bar_order_id = @o AND status <> 'CANCELLED'")
  ).recordset;
  if (foods.some((f) => !['PENDING', 'QUEUED', 'PREPARING'].includes(f.status))) {
    throw new ApiError('The food on this order is already cooked, so the order cannot be cancelled.', 409);
  }
  // ponytail: not atomic with the drinks below; a cooked dish is refused here before anything changes.
  for (const f of foods) {
    await ordersService.updateStatus(lodgeId, f.id, 'CANCELLED', { cancelReason: 'Bar order cancelled', userId });
  }

  const tx = await begin();
  try {
    await lockOpenOrder(tx, lodgeId, orderId);
    await cancelLines(tx, lodgeId, orderId, null, userId);
    await new sql.Request(tx)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('o', sql.BigInt, orderId)
      .query("UPDATE dbo.bar_orders SET status='CANCELLED', subtotal = 0, food_subtotal = 0 WHERE id=@o AND lodge_id=@lodgeId");
    await tx.commit();
    return { ok: true };
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

// Food lines of bar orders (kitchen status included), keyed by bar order id.
async function loadFoodLines(pool, lodgeId, orderIds) {
  const byOrder = new Map();
  if (!orderIds.length) return byOrder;
  const q = pool.request().input('lodgeId', sql.BigInt, lodgeId);
  orderIds.forEach((id, i) => q.input(`o${i}`, sql.BigInt, id));
  const rows = (
    await q.query(
      `SELECT fo.bar_order_id, fo.id AS food_order_id, fo.order_number AS food_order_number, fo.status,
              fi.id, fi.item_name, fi.portion_label, fi.quantity, fi.line_total, fi.ready_at, fi.delivered_at
       FROM dbo.food_orders fo JOIN dbo.food_order_items fi ON fi.order_id = fo.id
       WHERE fo.lodge_id = @lodgeId AND fo.status <> 'CANCELLED'
         AND fo.bar_order_id IN (${orderIds.map((_, i) => `@o${i}`).join(',')})
       ORDER BY fi.id`
    )
  ).recordset;
  for (const r of rows) {
    const list = byOrder.get(String(r.bar_order_id)) || [];
    list.push({
      id: r.id,
      foodOrderId: r.food_order_id,
      name: r.item_name,
      portion: r.portion_label || null,
      quantity: r.quantity,
      lineTotal: Number(r.line_total),
      readyAt: r.ready_at,
      deliveredAt: r.delivered_at,
      // What the kitchen has done with it, for the captain's card.
      kitchenStatus: r.delivered_at ? 'DELIVERED' : r.ready_at ? 'READY' : r.status === 'PREPARING' ? 'PREPARING' : 'QUEUED',
    });
    byOrder.set(String(r.bar_order_id), list);
  }
  return byOrder;
}

// Posts an open bar order (drinks and any dishes on it) to a checked-in guest's room bill.
// The stay invoice then carries it as a Bar line; no separate bar bill or payment.
async function addToRoomBill(lodgeId, orderId, { bookingId, roomId }) {
  const pool = await getPool();
  const stay = (
    await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('bookingId', sql.BigInt, bookingId)
      .input('roomId', sql.BigInt, roomId)
      .query(`SELECT b.id FROM dbo.bookings b
              JOIN dbo.booking_rooms br ON br.booking_id = b.id AND br.room_id = @roomId AND br.status <> 'CANCELLED'
              WHERE b.id = @bookingId AND b.lodge_id = @lodgeId
                AND (b.status = 'CHECKED_IN' OR (b.status = 'CHECKED_OUT' AND NOT EXISTS (
                  SELECT 1 FROM dbo.invoices bi WHERE bi.booking_id = @bookingId AND bi.status = 'ISSUED')))`)
  ).recordset[0];
  if (!stay) throw new ApiError('That guest is not checked in.', 409);
  const r = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('o', sql.BigInt, orderId)
    .input('bookingId', sql.BigInt, bookingId)
    .input('roomId', sql.BigInt, roomId)
    .query(`UPDATE dbo.bar_orders
            SET booking_id = @bookingId, room_id = @roomId, on_room_bill = 1,
                ready_to_bill_at = COALESCE(ready_to_bill_at, SYSDATETIMEOFFSET())
            WHERE id = @o AND lodge_id = @lodgeId AND status = 'OPEN' AND on_room_bill = 0 AND invoice_id IS NULL`);
  if (!r.rowsAffected[0]) throw new ApiError('That order is not open, or is already on a room bill.', 409);
  return { ok: true };
}

// A captain or the desk says the guest is done and ready to pay. Needs everything
// delivered, as in the restaurant; the bill itself can still be issued "anyway".
async function markReadyToBill(lodgeId, orderId) {
  const orders = (await listOrders(lodgeId, { status: 'OPEN' })).filter((o) => String(o.id) === String(orderId));
  if (!orders.length) throw new ApiError('Order not found, or already billed.', 404);
  await (await getPool())
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('o', sql.BigInt, orderId)
    .query("UPDATE dbo.bar_orders SET ready_to_bill_at = COALESCE(ready_to_bill_at, SYSDATETIMEOFFSET()) WHERE id = @o AND lodge_id = @lodgeId AND status = 'OPEN'");
  return { ok: true };
}

// status OPEN: the live orders. status HISTORY (with from/to): billed and cancelled
// orders placed in that period, each with the number of the bill that settled it.
async function listOrders(lodgeId, { status = 'OPEN', from = null, to = null } = {}) {
  const pool = await getPool();
  const history = status === 'HISTORY';
  const where = history ? "o.status IN ('BILLED', 'CANCELLED') AND o.order_date BETWEEN @from AND @to" : 'o.status = @s AND o.on_room_bill = 0';
  const bind = (r) => {
    r.input('lodgeId', sql.BigInt, lodgeId);
    if (history) r.input('from', sql.Date, from).input('to', sql.Date, to);
    else r.input('s', sql.NVarChar, status);
    return r;
  };
  const orders = (
    await bind(pool.request())
      .query(
        `SELECT o.id, o.order_date, o.order_number, o.source, o.table_id, o.room_id, o.booking_id, o.restaurant_order_id,
                o.guest_name, o.guest_phone, o.customer_tag, o.status, o.bill_id, o.created_at, o.ready_to_bill_at,
                t.label AS table_label, r.room_number, bb.bill_seq, inv.invoice_number AS room_invoice_number
         FROM dbo.bar_orders o
         LEFT JOIN dbo.dining_tables t ON t.id = o.table_id
         LEFT JOIN dbo.rooms r ON r.id = o.room_id
         LEFT JOIN dbo.bar_bills bb ON bb.id = o.bill_id
         LEFT JOIN dbo.invoices inv ON inv.id = o.invoice_id
         WHERE o.lodge_id=@lodgeId AND ${where} ORDER BY o.id DESC`
      )
  ).recordset;
  if (!orders.length) return [];
  const items = (
    await bind(pool.request())
      .query(
        `SELECT i.id, i.order_id, i.item_name, i.size_label, i.ml_per_unit, i.unit_price, i.quantity, i.line_total, i.delivered_at
         FROM dbo.bar_order_items i JOIN dbo.bar_orders o ON o.id = i.order_id
         WHERE o.lodge_id=@lodgeId AND ${where} AND i.is_cancelled=0 ORDER BY i.id`
      )
  ).recordset;
  const food = await loadFoodLines(pool, lodgeId, orders.map((o) => o.id));
  const code = await lodgeCode(pool, lodgeId);
  return orders.map((o) => {
    const drinks = items
      .filter((i) => i.order_id === o.id)
      .map((i) => ({
        id: i.id,
        name: i.item_name,
        size: i.size_label,
        ml: i.ml_per_unit,
        unitPrice: Number(i.unit_price),
        quantity: i.quantity,
        lineTotal: Number(i.line_total),
        deliveredAt: i.delivered_at,
      }));
    const foodItems = food.get(String(o.id)) || [];
    return {
      id: o.id,
      orderDate: o.order_date,
      orderNumber: o.order_number,
      source: o.source,
      tableId: o.table_id,
      tableLabel: o.table_label,
      roomId: o.room_id,
      roomNumber: o.room_number,
      bookingId: o.booking_id,
      restaurantOrderId: o.restaurant_order_id,
      guestName: o.guest_name,
      guestPhone: o.guest_phone,
      customerTag: o.customer_tag ?? null,
      status: o.status,
      // Worked out from the lines, so a dish the restaurant side later returns is already out of it.
      subtotal: round2(drinks.reduce((s, d) => s + d.lineTotal, 0) + foodItems.reduce((s, f) => s + f.lineTotal, 0)),
      undelivered: drinks.filter((d) => !d.deliveredAt).length + foodItems.filter((f) => !f.deliveredAt).length,
      createdAt: o.created_at,
      readyToBill: o.ready_to_bill_at != null,
      billId: o.bill_id,
      billNumber: o.bill_seq != null ? billNumber(o.bill_seq, code) : null,
      // Billed on a guest's room bill instead: the stay invoice that carried it.
      roomInvoiceNumber: o.room_invoice_number ?? null,
      items: drinks,
      foodItems,
    };
  });
}

// Where a bar order can be placed: dining tables, and in-house guests by room.
// Read here (not via /tables, /orders) so bar-only staff don't need food permissions.
async function listTargets(lodgeId) {
  const pool = await getPool();
  const [tables, guests] = await Promise.all([
    pool.request().input('lodgeId', sql.BigInt, lodgeId).query(
      "SELECT id, label FROM dbo.dining_tables WHERE lodge_id = @lodgeId AND area = 'BAR' AND is_active = 1 ORDER BY LEN(label), label"
    ),
    pool.request().input('lodgeId', sql.BigInt, lodgeId).query(
      `SELECT DISTINCT br.room_id, r.room_number, b.id AS booking_id, b.guest_name, b.guest_phone
       FROM dbo.booking_rooms br
       JOIN dbo.bookings b ON b.id = br.booking_id
       JOIN dbo.rooms r ON r.id = br.room_id
       WHERE b.lodge_id = @lodgeId AND br.status = 'CHECKED_IN' AND b.status = 'CHECKED_IN'
       ORDER BY r.room_number`
    ),
  ]);
  return {
    tables: tables.recordset.map((t) => ({ id: t.id, label: t.label })),
    guests: guests.recordset.map((g) => ({
      roomId: g.room_id,
      roomNumber: g.room_number,
      bookingId: g.booking_id,
      guestName: g.guest_name || '',
      guestPhone: g.guest_phone || '',
    })),
  };
}

// Moves an open bar order (and the restaurant food on it) to another customer. Also the
// way to rename or merge customers at a table.
async function setOrderCustomer(lodgeId, orderId, tag) {
  const t = cleanTag(tag);
  const pool = await getPool();
  const r = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('id', sql.BigInt, orderId)
    .input('t', sql.NVarChar, t)
    .query("UPDATE dbo.bar_orders SET customer_tag = @t WHERE id = @id AND lodge_id = @lodgeId AND source = 'TABLE' AND status = 'OPEN' AND on_room_bill = 0");
  if (!r.rowsAffected[0]) throw new ApiError('Only an open table order can be moved to another customer.', 409);
  await pool.request().input('lodgeId', sql.BigInt, lodgeId).input('id', sql.BigInt, orderId).input('t', sql.NVarChar, t)
    .query('UPDATE dbo.food_orders SET customer_tag = @t WHERE bar_order_id = @id AND lodge_id = @lodgeId AND invoice_id IS NULL');
  return { id: orderId, customerTag: t };
}

// ----------------------------------------------------------------- billing

// Open orders grouped the way the restaurant tab list is: by table, room or counter order.
async function listTabs(lodgeId) {
  // Every open order is billable; kitchen/delivery status doesn't gate billing.
  const orders = (await listOrders(lodgeId, { status: 'OPEN' }));
  const tabs = new Map();
  for (const o of orders) {
    // A table splits into one tab per customer; '~' alone is the untagged group.
    const key = o.source === 'TABLE' ? `T${o.tableId}~${encodeURIComponent(customerKey(o.customerTag))}` : o.source === 'ROOM' ? `R${o.roomId}` : `C${o.id}`;
    if (!tabs.has(key)) {
      tabs.set(key, {
        key,
        source: o.source,
        tableId: o.tableId,
        customerTag: o.customerTag ?? null,
        label: o.source === 'TABLE' ? `Table ${o.tableLabel ?? o.tableId}` : o.source === 'ROOM' ? `Room ${o.roomNumber ?? o.roomId}` : `Counter #${o.orderNumber}`,
        guestName: o.source === 'TABLE' && o.customerTag ? o.customerTag : o.guestName,
        guestPhone: o.guestPhone,
        roomId: o.roomId,
        bookingId: o.bookingId,
        orderIds: [],
        items: [],
        foodItems: [],
        pendingDelivery: 0,
        subtotal: 0,
      });
    }
    const t = tabs.get(key);
    t.orderIds.push(o.id);
    t.items.push(...o.items);
    t.foodItems.push(...o.foodItems);
    t.pendingDelivery += o.undelivered;
    t.subtotal = round2(t.subtotal + o.subtotal);
  }
  return [...tabs.values()];
}

// Prices are tax-inclusive, so tax is the part of each amount that is tax.
// Drinks use the bar's rate; food uses the restaurant's GST rate (0 when the lodge has none).
function splitTax(drinks, food, barPercent, foodRatePercent) {
  const t = billing.computeFoodTax(food, foodRatePercent);
  return {
    drinkTax: round2(drinks - drinks / (1 + barPercent / 100)),
    foodTax: round2(t.cgstAmount + t.sgstAmount),
  };
}

// Placeholders for an id list, bound on the request: @i0, @i1 ...
function idList(request, ids) {
  ids.forEach((v, i) => request.input(`i${i}`, sql.BigInt, v));
  return ids.map((_, i) => `@i${i}`).join(',');
}

async function issueBill(lodgeId, input, userId) {
  const tx = await begin();
  try {
    const ids = [...new Set(input.orderIds)];
    const q = new sql.Request(tx).input('lodgeId', sql.BigInt, lodgeId);
    const list = idList(q, ids);
    const orders = (
      await q.query(
        `SELECT id, status, guest_name, guest_phone, customer_tag, on_room_bill FROM dbo.bar_orders WITH (UPDLOCK)
         WHERE lodge_id=@lodgeId AND id IN (${list})`
      )
    ).recordset;
    if (orders.length !== ids.length) throw new ApiError('Order not found.', 404);
    if (orders.some((o) => o.status !== 'OPEN')) throw new ApiError('An order is already billed or cancelled. Refresh and try again.', 409);
    if (orders.some((o) => o.on_room_bill)) throw new ApiError('An order is on a room bill and is billed with the stay.', 409);

    // Drinks and the restaurant food ordered on these bar orders, worked out from the
    // lines themselves (a dish the kitchen side later returned is already gone).
    const dq = new sql.Request(tx);
    const drinkRow = (
      await dq.query(
        `SELECT ISNULL(SUM(line_total), 0) AS drinks, ISNULL(SUM(CASE WHEN delivered_at IS NULL THEN 1 ELSE 0 END), 0) AS undelivered
         FROM dbo.bar_order_items WHERE is_cancelled = 0 AND order_id IN (${idList(dq, ids)})`
      )
    ).recordset[0];
    const fq = new sql.Request(tx).input('lodgeId', sql.BigInt, lodgeId);
    const foodRow = (
      await fq.query(
        `SELECT ISNULL(SUM(fi.line_total), 0) AS food, ISNULL(SUM(CASE WHEN fi.delivered_at IS NULL THEN 1 ELSE 0 END), 0) AS undelivered
         FROM dbo.food_orders fo JOIN dbo.food_order_items fi ON fi.order_id = fo.id
         WHERE fo.lodge_id = @lodgeId AND fo.status <> 'CANCELLED' AND fo.bar_order_id IN (${idList(fq, ids)})`
      )
    ).recordset[0];
    const drinks = round2(Number(drinkRow.drinks));
    const food = round2(Number(foodRow.food));
    const subtotal = round2(drinks + food);
    if (subtotal <= 0) throw new ApiError('Nothing to bill.', 400);

    const paid = round2(input.payments.reduce((s, p) => s + p.amount, 0));
    if (Math.abs(paid - subtotal) > 0.009) throw new ApiError(`Payments (${paid}) must equal the bill total (${subtotal}).`, 400, 'payments');

    // Prices are tax-inclusive, so tax is extracted from the amount, not added on top.
    // Drinks: the bar's own rate (alcohol is outside GST). Food: the restaurant's GST
    // rate, only when the lodge is GST registered, exactly as a restaurant bill does.
    const { taxPercent } = await getSettings(lodgeId);
    let foodRate = 0;
    if (food > 0) {
      const lodge = (
        await new sql.Request(tx).input('lodgeId', sql.BigInt, lodgeId)
          .query('SELECT is_gst_registered, is_specified_premises FROM dbo.lodges WHERE id = @lodgeId')
      ).recordset[0];
      if (lodge.is_gst_registered) {
        foodRate = (await billing.getFoodRate(await getPool(), lodge.is_specified_premises)).ratePercent;
      }
    }
    const { drinkTax, foodTax } = splitTax(drinks, food, taxPercent, foodRate);

    const seq = (
      await new sql.Request(tx)
        .input('lodgeId', sql.BigInt, lodgeId)
        .query('SELECT ISNULL(MAX(bill_seq), 0) + 1 AS n FROM dbo.bar_bills WITH (UPDLOCK, HOLDLOCK) WHERE lodge_id=@lodgeId')
    ).recordset[0].n;
    const bill = await new sql.Request(tx)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('s', sql.Int, seq)
      .input('d', sql.Date, todayIST())
      .input('sub', sql.Decimal(10, 2), subtotal)
      .input('tp', sql.Decimal(5, 2), taxPercent)
      .input('ta', sql.Decimal(10, 2), drinkTax)
      .input('fs', sql.Decimal(10, 2), food)
      .input('ftp', sql.Decimal(5, 2), foodRate)
      .input('fta', sql.Decimal(10, 2), foodTax)
      .input('cn', sql.NVarChar, input.customerName ?? orders[0].customer_tag ?? orders[0].guest_name ?? null)
      .input('cp', sql.NVarChar, input.customerPhone ?? orders[0].guest_phone ?? null)
      .input('u', sql.BigInt, userId ?? null)
      .query(
        `INSERT INTO dbo.bar_bills (lodge_id, bill_seq, bill_date, subtotal, tax_percent, tax_amount, total, customer_name, customer_phone, created_by,
           food_subtotal, food_tax_percent, food_tax_amount)
         OUTPUT inserted.id
         VALUES (@lodgeId, @s, @d, @sub, @tp, @ta, @sub, @cn, @cp, @u, @fs, @ftp, @fta)`
      );
    const billId = bill.recordset[0].id;
    for (const p of input.payments) {
      await new sql.Request(tx)
        .input('b', sql.BigInt, billId)
        .input('m', sql.NVarChar, p.method)
        .input('a', sql.Decimal(10, 2), p.amount)
        .input('r', sql.NVarChar, p.reference ?? null)
        .query('INSERT INTO dbo.bar_bill_payments (bill_id, method, amount, reference) VALUES (@b, @m, @a, @r)');
    }
    const u = new sql.Request(tx).input('lodgeId', sql.BigInt, lodgeId).input('b', sql.BigInt, billId);
    await u.query(`UPDATE dbo.bar_orders SET status='BILLED', bill_id=@b WHERE lodge_id=@lodgeId AND id IN (${idList(u, ids)})`);
    await tx.commit();
    return getBill(lodgeId, billId);
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

// Bar bills run their own series (bar_bills.bill_seq, per lodge), numbered
// plain 1, 2, 3, so the number is just the sequence.
const billNumber = (seq) => String(seq);
async function lodgeCode(pool, lodgeId) {
  const r = await pool.request().input('lodgeId', sql.BigInt, lodgeId).query('SELECT booking_code FROM dbo.lodges WHERE id = @lodgeId');
  return r.recordset[0]?.booking_code || '';
}

async function getBill(lodgeId, billId) {
  const pool = await getPool();
  const b = (
    await pool.request().input('lodgeId', sql.BigInt, lodgeId).input('id', sql.BigInt, billId).query(
      'SELECT * FROM dbo.bar_bills WHERE id=@id AND lodge_id=@lodgeId'
    )
  ).recordset[0];
  if (!b) throw new ApiError('Bill not found.', 404);
  const [items, foodLines, pays] = await Promise.all([
    pool.request().input('lodgeId', sql.BigInt, lodgeId).input('b', sql.BigInt, billId).query(
      `SELECT i.item_name, i.size_label, i.unit_price, SUM(i.quantity) AS quantity, SUM(i.line_total) AS line_total
       FROM dbo.bar_order_items i JOIN dbo.bar_orders o ON o.id = i.order_id
       WHERE o.lodge_id=@lodgeId AND o.bill_id=@b AND i.is_cancelled=0 GROUP BY i.item_name, i.size_label, i.unit_price ORDER BY i.item_name`
    ),
    pool.request().input('lodgeId', sql.BigInt, lodgeId).input('b', sql.BigInt, billId).query(
      `SELECT fi.item_name, fi.portion_label, fi.unit_price, SUM(fi.quantity) AS quantity, SUM(fi.line_total) AS line_total
       FROM dbo.food_order_items fi JOIN dbo.food_orders fo ON fo.id = fi.order_id
       JOIN dbo.bar_orders o ON o.id = fo.bar_order_id
       WHERE o.lodge_id=@lodgeId AND fo.lodge_id=@lodgeId AND o.bill_id=@b AND fo.status <> 'CANCELLED'
       GROUP BY fi.item_name, fi.portion_label, fi.unit_price ORDER BY fi.item_name`
    ),
    pool.request().input('b', sql.BigInt, billId).query('SELECT method, amount, reference FROM dbo.bar_bill_payments WHERE bill_id=@b ORDER BY id'),
  ]);
  return {
    id: b.id,
    billNumber: billNumber(b.bill_seq, await lodgeCode(pool, lodgeId)),
    billDate: b.bill_date,
    subtotal: Number(b.subtotal),
    drinksSubtotal: round2(Number(b.subtotal) - Number(b.food_subtotal)),
    foodSubtotal: Number(b.food_subtotal),
    taxPercent: Number(b.tax_percent),
    taxAmount: Number(b.tax_amount),
    foodTaxPercent: Number(b.food_tax_percent),
    foodTaxAmount: Number(b.food_tax_amount),
    total: Number(b.total),
    customerName: b.customer_name,
    customerPhone: b.customer_phone,
    createdAt: b.created_at,
    items: items.recordset.map((i) => ({
      kind: 'DRINK',
      name: i.item_name,
      size: i.size_label,
      unitPrice: Number(i.unit_price),
      quantity: i.quantity,
      lineTotal: Number(i.line_total),
    })),
    foodItems: foodLines.recordset.map((i) => ({
      kind: 'FOOD',
      name: i.item_name,
      size: i.portion_label || '',
      unitPrice: Number(i.unit_price),
      quantity: i.quantity,
      lineTotal: Number(i.line_total),
    })),
    payments: pays.recordset.map((p) => ({ method: p.method, amount: Number(p.amount), reference: p.reference })),
  };
}

async function listBills(lodgeId, { from, to }) {
  const code = await lodgeCode(await getPool(), lodgeId);
  const r = await (await getPool())
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('f', sql.Date, from)
    .input('t', sql.Date, to)
    .query(
      `SELECT id, bill_seq, bill_date, total, tax_amount, food_subtotal, food_tax_amount, customer_name, created_at
       FROM dbo.bar_bills WHERE lodge_id=@lodgeId AND bill_date BETWEEN @f AND @t ORDER BY id DESC`
    );
  return r.recordset.map((b) => ({
    id: b.id,
    billNumber: billNumber(b.bill_seq, code),
    billDate: b.bill_date,
    total: Number(b.total),
    taxAmount: Number(b.tax_amount),
    foodTaxAmount: Number(b.food_tax_amount),
    foodSubtotal: Number(b.food_subtotal),
    customerName: b.customer_name,
    createdAt: b.created_at,
  }));
}

// ----------------------------------------------------------------- reports

// The same category from bar bills and from room bills reads as one row.
function mergeCategories(list) {
  const by = new Map();
  for (const c of list) {
    const hit = by.get(c.category);
    if (hit) {
      hit.ml += c.ml;
      hit.amount = round2(hit.amount + c.amount);
    } else {
      by.set(c.category, { ...c });
    }
  }
  return [...by.values()].sort((x, y) => y.amount - x.amount);
}

async function salesReport(lodgeId, { from, to }) {
  const pool = await getPool();
  const rq = () => pool.request().input('lodgeId', sql.BigInt, lodgeId).input('f', sql.Date, from).input('t', sql.Date, to);
  const [totals, byDay, byPay, byItem, byCat, byFood, roomTotals, roomDrinks, roomDishes] = await Promise.all([
    rq().query(
      `SELECT COUNT(*) AS bills, ISNULL(SUM(total),0) AS total, ISNULL(SUM(tax_amount),0) AS tax,
              ISNULL(SUM(food_subtotal),0) AS food, ISNULL(SUM(food_tax_amount),0) AS food_tax
       FROM dbo.bar_bills WHERE lodge_id=@lodgeId AND bill_date BETWEEN @f AND @t`
    ),
    rq().query(
      `SELECT bill_date, COUNT(*) AS bills, SUM(total) AS total FROM dbo.bar_bills
       WHERE lodge_id=@lodgeId AND bill_date BETWEEN @f AND @t GROUP BY bill_date ORDER BY bill_date`
    ),
    rq().query(
      `SELECT p.method, SUM(p.amount) AS amount FROM dbo.bar_bill_payments p JOIN dbo.bar_bills b ON b.id = p.bill_id
       WHERE b.lodge_id=@lodgeId AND b.bill_date BETWEEN @f AND @t GROUP BY p.method`
    ),
    rq().query(
      `SELECT i.item_name, i.size_label, SUM(i.quantity) AS qty, SUM(i.quantity * i.ml_per_unit) AS ml, SUM(i.line_total) AS amount
       FROM dbo.bar_order_items i JOIN dbo.bar_orders o ON o.id = i.order_id JOIN dbo.bar_bills b ON b.id = o.bill_id
       WHERE b.lodge_id=@lodgeId AND b.bill_date BETWEEN @f AND @t AND i.is_cancelled=0
       GROUP BY i.item_name, i.size_label ORDER BY SUM(i.line_total) DESC`
    ),
    rq().query(
      `SELECT ISNULL(c.name, 'Uncategorised') AS category, SUM(i.quantity * i.ml_per_unit) AS ml, SUM(i.line_total) AS amount
       FROM dbo.bar_order_items i JOIN dbo.bar_orders o ON o.id = i.order_id JOIN dbo.bar_bills b ON b.id = o.bill_id
       JOIN dbo.bar_products p ON p.id = i.product_id LEFT JOIN dbo.bar_categories c ON c.id = p.category_id
       WHERE b.lodge_id=@lodgeId AND b.bill_date BETWEEN @f AND @t AND i.is_cancelled=0
       GROUP BY c.name ORDER BY SUM(i.line_total) DESC`
    ),
    // Restaurant food ordered on bar orders: counted here, never in the restaurant report.
    rq().query(
      `SELECT fi.item_name, ISNULL(fi.portion_label, '') AS size_label, SUM(fi.quantity) AS qty, SUM(fi.line_total) AS amount
       FROM dbo.food_order_items fi JOIN dbo.food_orders fo ON fo.id = fi.order_id
       JOIN dbo.bar_orders o ON o.id = fo.bar_order_id JOIN dbo.bar_bills b ON b.id = o.bill_id
       WHERE b.lodge_id=@lodgeId AND fo.lodge_id=@lodgeId AND b.bill_date BETWEEN @f AND @t AND fo.status <> 'CANCELLED'
       GROUP BY fi.item_name, fi.portion_label ORDER BY SUM(fi.line_total) DESC`
    ),
    // Bar orders billed to a guest's room: collected on the stay bill, so there is no bar
    // bill or payment, but the sale is still the bar's. Dated by the stay invoice.
    rq().query(
      `SELECT COUNT(*) AS invoices, ISNULL(SUM(i.bar_subtotal),0) AS drinks, ISNULL(SUM(i.bar_food_subtotal),0) AS food,
              ISNULL(SUM(i.bar_tax_amount),0) AS tax, ISNULL(SUM(i.bar_food_tax_amount),0) AS food_tax
       FROM dbo.invoices i
       WHERE i.lodge_id=@lodgeId AND i.status='ISSUED' AND (i.bar_subtotal + i.bar_food_subtotal) > 0
         AND CAST(SWITCHOFFSET(i.created_at, '+05:30') AS date) BETWEEN @f AND @t`
    ),
    rq().query(
      `SELECT i2.item_name, i2.size_label, ISNULL(c.name, 'Uncategorised') AS category,
              SUM(i2.quantity) AS qty, SUM(i2.quantity * i2.ml_per_unit) AS ml, SUM(i2.line_total) AS amount
       FROM dbo.bar_order_items i2 JOIN dbo.bar_orders o ON o.id = i2.order_id
       JOIN dbo.invoices i ON i.id = o.invoice_id
       JOIN dbo.bar_products p ON p.id = i2.product_id LEFT JOIN dbo.bar_categories c ON c.id = p.category_id
       WHERE o.lodge_id=@lodgeId AND i.lodge_id=@lodgeId AND o.on_room_bill=1 AND i.status='ISSUED' AND i2.is_cancelled=0
         AND CAST(SWITCHOFFSET(i.created_at, '+05:30') AS date) BETWEEN @f AND @t
       GROUP BY i2.item_name, i2.size_label, c.name`
    ),
    rq().query(
      `SELECT fi.item_name, ISNULL(fi.portion_label, '') AS size_label, SUM(fi.quantity) AS qty, SUM(fi.line_total) AS amount
       FROM dbo.food_order_items fi JOIN dbo.food_orders fo ON fo.id = fi.order_id
       JOIN dbo.bar_orders o ON o.id = fo.bar_order_id JOIN dbo.invoices i ON i.id = o.invoice_id
       WHERE o.lodge_id=@lodgeId AND fo.lodge_id=@lodgeId AND i.lodge_id=@lodgeId AND o.on_room_bill=1 AND i.status='ISSUED'
         AND fo.status <> 'CANCELLED' AND CAST(SWITCHOFFSET(i.created_at, '+05:30') AS date) BETWEEN @f AND @t
       GROUP BY fi.item_name, fi.portion_label`
    ),
  ]);
  const t = totals.recordset[0];
  const rt = roomTotals.recordset[0];
  const roomSales = round2(Number(rt.drinks) + Number(rt.food));
  return {
    from,
    to,
    bills: t.bills,
    // Includes the bar orders billed to a room (onRoomBill), which carry no bar bill.
    total: round2(Number(t.total) + roomSales),
    // tax is the drinks tax at the bar rate; foodTax is GST collected on the restaurant food.
    tax: round2(Number(t.tax) + Number(rt.tax)),
    drinks: round2(Number(t.total) - Number(t.food) + Number(rt.drinks)),
    food: round2(Number(t.food) + Number(rt.food)),
    foodTax: round2(Number(t.food_tax) + Number(rt.food_tax)),
    onRoomBill: { invoices: rt.invoices, total: roomSales },
    byDay: byDay.recordset.map((d) => ({ date: d.bill_date, bills: d.bills, total: Number(d.total) })),
    byPayment: byPay.recordset.map((p) => ({ method: p.method, amount: Number(p.amount) })),
    byItem: [
      ...byItem.recordset.map((i) => ({ name: i.item_name, size: i.size_label, quantity: i.qty, ml: i.ml, amount: Number(i.amount), kind: 'DRINK' })),
      ...byFood.recordset.map((i) => ({ name: i.item_name, size: i.size_label, quantity: i.qty, ml: 0, amount: Number(i.amount), kind: 'FOOD' })),
      ...roomDrinks.recordset.map((i) => ({ name: i.item_name, size: i.size_label, quantity: i.qty, ml: i.ml, amount: Number(i.amount), kind: 'DRINK' })),
      ...roomDishes.recordset.map((i) => ({ name: i.item_name, size: i.size_label, quantity: i.qty, ml: 0, amount: Number(i.amount), kind: 'FOOD' })),
    ].sort((a, b) => b.amount - a.amount),
    byCategory: mergeCategories([
      ...byCat.recordset.map((c) => ({ category: c.category, ml: c.ml, amount: Number(c.amount) })),
      ...roomDrinks.recordset.map((c) => ({ category: c.category, ml: c.ml, amount: Number(c.amount) })),
      ...(byFood.recordset.length || roomDishes.recordset.length
        ? [{ category: 'Food (restaurant menu)', ml: 0, amount: round2([...byFood.recordset, ...roomDishes.recordset].reduce((sum, f) => sum + Number(f.amount), 0)) }]
        : []),
    ]),
  };
}

// Opening, in, sold, wastage, closing per product — all from the movement ledger.
async function stockReport(lodgeId, { from, to }) {
  const pool = await getPool();
  const settings = await getSettings(lodgeId);
  const r = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('f', sql.Date, from)
    .input('t', sql.Date, to)
    .query(
      `SELECT p.id, p.name, p.brand, p.bottle_ml, p.stock_ml, p.low_stock_ml,
         ISNULL(SUM(CASE WHEN CAST(m.created_at AS DATE) > @t THEN m.change_ml END), 0) AS after_ml,
         ISNULL(SUM(CASE WHEN CAST(m.created_at AS DATE) BETWEEN @f AND @t AND m.reason IN ('OPENING','PURCHASE') THEN m.change_ml END), 0) AS in_ml,
         ISNULL(SUM(CASE WHEN CAST(m.created_at AS DATE) BETWEEN @f AND @t AND m.reason IN ('SALE','REVERSAL') THEN -m.change_ml END), 0) AS sold_ml,
         ISNULL(SUM(CASE WHEN CAST(m.created_at AS DATE) BETWEEN @f AND @t AND m.reason = 'WASTAGE' THEN -m.change_ml END), 0) AS wastage_ml,
         ISNULL(SUM(CASE WHEN CAST(m.created_at AS DATE) BETWEEN @f AND @t AND m.reason = 'ADJUSTMENT' THEN m.change_ml END), 0) AS adjust_ml
       FROM dbo.bar_products p LEFT JOIN dbo.bar_stock_movements m ON m.product_id = p.id
       WHERE p.lodge_id=@lodgeId GROUP BY p.id, p.name, p.brand, p.bottle_ml, p.stock_ml, p.low_stock_ml ORDER BY p.name`
    );
  return {
    from,
    to,
    products: r.recordset.map((p) => {
      const closing = p.stock_ml - p.after_ml;
      const opening = closing - (p.in_ml - p.sold_ml - p.wastage_ml + p.adjust_ml);
      const limit = p.low_stock_ml ?? settings.defaultLowStockMl;
      const v = (ml) => stockView(ml, p.bottle_ml);
      return {
        id: p.id,
        name: p.name,
        brand: p.brand,
        bottleMl: p.bottle_ml,
        opening: v(opening),
        purchased: v(p.in_ml),
        sold: v(p.sold_ml),
        wastage: v(p.wastage_ml),
        adjustment: v(p.adjust_ml),
        closing: v(closing),
        current: v(p.stock_ml),
        isLow: limit != null && p.stock_ml <= limit,
      };
    }),
  };
}

module.exports = {
  stockView,
  splitTax,
  billNumber,
  getSettings,
  updateSettings,
  getMenu,
  saveCategory,
  deleteCategory,
  createProduct,
  updateProduct,
  addSize,
  updateSize,
  adjustStock,
  listMovements,
  createOrder,
  addItems,
  cancelItem,
  cancelOrder,
  deliverItem,
  deliverAll,
  deliverFoodItem,
  updateItemQty,
  markReadyToBill,
  addToRoomBill,
  listOrders,
  listTargets,
  listTabs,
  issueBill,
  getBill,
  listBills,
  salesReport,
  stockReport,
};
