const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');

// ---------------------------------------------------------------------------
// Room cleaning
//
// Status is derived, never stored, so check-in and check-out are untouched:
//   OUT_OF_ORDER  housekeeping marked it
//   OCCUPIED      a guest is checked in
//   CLEANING      an attendant has started it
//   DIRTY         a guest checked out after it was last cleaned, or someone
//                 marked it "needs cleaning"
//   READY         everything else
// ---------------------------------------------------------------------------

// Pure — takes one board row. Exported so a test can pin the rules.
function roomStatusOf(row) {
  if (row.out_of_order) return 'OUT_OF_ORDER';
  if (row.occupied) return 'OCCUPIED';
  if (row.cleaning_started_at) return 'CLEANING';
  const checkedOutSince =
    row.last_checkout_at && new Date(row.last_checkout_at) > new Date(row.last_cleaned_at);
  if (row.needs_cleaning || checkedOutSince) return 'DIRTY';
  return 'READY';
}

// Rooms get a housekeeping row the first time the board is opened, stamped
// "cleaned now" so turning the section on never floods it with rooms that were
// checked out months ago.
async function ensureRoomRows(pool, lodgeId) {
  try {
    await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .query(`
        INSERT INTO dbo.housekeeping_rooms (room_id, lodge_id)
        SELECT r.id, r.lodge_id FROM dbo.rooms r
        WHERE r.lodge_id = @lodgeId
          AND NOT EXISTS (SELECT 1 FROM dbo.housekeeping_rooms h WHERE h.room_id = r.id)
      `);
  } catch (err) {
    // Two screens opening at once can race to insert the same row; the loser's
    // duplicate is harmless because the winner's row is the one wanted.
    if (!/PRIMARY KEY|duplicate key/i.test(String(err.message))) throw err;
  }
}

const STATUS_ORDER = { DIRTY: 0, CLEANING: 1, READY: 2, OCCUPIED: 3, OUT_OF_ORDER: 4 };

async function listRooms(lodgeId) {
  const pool = await getPool();
  await ensureRoomRows(pool, lodgeId);
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT r.id, r.room_number, c.name AS category_name,
             h.last_cleaned_at, h.needs_cleaning, h.cleaning_started_at, h.out_of_order, h.out_of_order_note,
             cu.name AS cleaning_by_name,
             CASE WHEN EXISTS (SELECT 1 FROM dbo.booking_rooms br WHERE br.room_id = r.id AND br.status = 'CHECKED_IN')
                  THEN 1 ELSE 0 END AS occupied,
             (SELECT MAX(br.actual_check_out_at) FROM dbo.booking_rooms br
              WHERE br.room_id = r.id AND br.status = 'CHECKED_OUT') AS last_checkout_at,
             CASE WHEN EXISTS (SELECT 1 FROM dbo.booking_rooms br
                               WHERE br.room_id = r.id AND br.status = 'BOOKED'
                                 AND br.check_in_date = CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'India Standard Time' AS DATE))
                  THEN 1 ELSE 0 END AS arriving_today
      FROM dbo.rooms r
      JOIN dbo.room_categories c ON c.id = r.category_id
      JOIN dbo.housekeeping_rooms h ON h.room_id = r.id
      LEFT JOIN dbo.users cu ON cu.id = h.cleaning_by
      WHERE r.lodge_id = @lodgeId AND r.is_active = 1
    `);

  const rooms = result.recordset.map((row) => ({
    id: row.id,
    roomNumber: row.room_number,
    categoryName: row.category_name,
    status: roomStatusOf(row),
    arrivingToday: !!row.arriving_today,
    cleaningBy: row.cleaning_by_name ?? null,
    cleaningStartedAt: row.cleaning_started_at ?? null,
    outOfOrderNote: row.out_of_order_note ?? null,
    lastCleanedAt: row.last_cleaned_at,
    // The guest's check-out, when that is what made the room dirty, so the
    // board can say how long it has been waiting. Null for a room someone
    // marked by hand: there is no honest start time for that.
    dirtySince:
      row.last_checkout_at && new Date(row.last_checkout_at) > new Date(row.last_cleaned_at) ? row.last_checkout_at : null,
  }));
  // Work to do first, and among dirty rooms the ones a guest is arriving into.
  rooms.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      Number(b.arrivingToday) - Number(a.arrivingToday) ||
      String(a.roomNumber).localeCompare(String(b.roomNumber), undefined, { numeric: true })
  );
  return rooms;
}

async function requireRoom(request, lodgeId, roomId) {
  const found = await request
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roomId', sql.BigInt, roomId)
    .query('SELECT id FROM dbo.rooms WHERE id = @roomId AND lodge_id = @lodgeId');
  if (found.recordset.length === 0) throw new ApiError('Room not found.', 404);
}

async function startCleaning(lodgeId, userId, roomId) {
  const pool = await getPool();
  await requireRoom(pool.request(), lodgeId, roomId);
  await ensureRoomRows(pool, lodgeId);
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roomId', sql.BigInt, roomId)
    .input('userId', sql.BigInt, userId ?? null)
    .query(`
      UPDATE dbo.housekeeping_rooms
      SET cleaning_started_at = SYSDATETIMEOFFSET(), cleaning_by = @userId
      WHERE room_id = @roomId AND lodge_id = @lodgeId AND cleaning_started_at IS NULL AND out_of_order = 0
    `);
  if (result.rowsAffected[0] === 0) {
    throw new ApiError('This room is already being cleaned or is out of order.', 409);
  }
}

// Gives the room back without cleaning it — started by mistake.
async function releaseRoom(lodgeId, roomId) {
  const pool = await getPool();
  await requireRoom(pool.request(), lodgeId, roomId);
  await pool
    .request()
    .input('roomId', sql.BigInt, roomId)
    .query('UPDATE dbo.housekeeping_rooms SET cleaning_started_at = NULL, cleaning_by = NULL WHERE room_id = @roomId');
}

async function assertLinenItems(request, lodgeId, ids) {
  if (ids.length === 0) return;
  request.input('lodgeId', sql.BigInt, lodgeId);
  ids.forEach((id, i) => request.input(`li${i}`, sql.BigInt, id));
  const found = await request.query(
    `SELECT id FROM dbo.linen_items WHERE lodge_id = @lodgeId AND id IN (${ids.map((_, i) => `@li${i}`).join(', ')})`
  );
  if (found.recordset.length !== new Set(ids).size) throw new ApiError('One of those linen items was not found.', 404);
}

// Done: the room is clean, the linen changed in it goes to the dirty pool, and
// anything found is logged. Works whether or not Start was pressed first.
async function finishCleaning(lodgeId, userId, roomId, input) {
  const pool = await getPool();
  await requireRoom(pool.request(), lodgeId, roomId);
  await ensureRoomRows(pool, lodgeId);
  await assertLinenItems(pool.request(), lodgeId, input.linen.map((l) => l.linenItemId));

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const row = await new sql.Request(transaction)
      .input('roomId', sql.BigInt, roomId)
      .input('lodgeId', sql.BigInt, lodgeId)
      .query(`
        UPDATE dbo.housekeeping_rooms
        SET last_cleaned_at = SYSDATETIMEOFFSET(), needs_cleaning = 0, cleaning_started_at = NULL, cleaning_by = NULL
        OUTPUT deleted.cleaning_started_at AS started_at, deleted.out_of_order AS out_of_order
        WHERE room_id = @roomId AND lodge_id = @lodgeId
      `);
    if (row.recordset[0]?.out_of_order) {
      throw new ApiError('This room is out of order. Put it back in service first.', 409);
    }

    await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('roomId', sql.BigInt, roomId)
      .input('userId', sql.BigInt, userId ?? null)
      .input('startedAt', sql.DateTimeOffset, row.recordset[0]?.started_at ?? new Date())
      .input('issues', sql.NVarChar, input.issues || null)
      .input('lostFound', sql.NVarChar, input.lostFound || null)
      .query(`
        INSERT INTO dbo.housekeeping_log (lodge_id, room_id, cleaned_by, started_at, issues, lost_found)
        VALUES (@lodgeId, @roomId, @userId, @startedAt, @issues, @lostFound)
      `);

    for (const line of input.linen) {
      await new sql.Request(transaction)
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('itemId', sql.BigInt, line.linenItemId)
        .input('qty', sql.Int, line.quantity)
        .input('roomId', sql.BigInt, roomId)
        .input('userId', sql.BigInt, userId ?? null)
        .query(`
          INSERT INTO dbo.linen_movements (lodge_id, linen_item_id, kind, quantity, room_id, created_by)
          VALUES (@lodgeId, @itemId, 'CHANGED', @qty, @roomId, @userId)
        `);
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function markDirty(lodgeId, roomId) {
  const pool = await getPool();
  await requireRoom(pool.request(), lodgeId, roomId);
  await ensureRoomRows(pool, lodgeId);
  await pool.request().input('roomId', sql.BigInt, roomId).query('UPDATE dbo.housekeeping_rooms SET needs_cleaning = 1 WHERE room_id = @roomId');
}

// Back in service always lands DIRTY: whoever repaired it left a mess.
async function setOutOfOrder(lodgeId, roomId, { outOfOrder, note }) {
  const pool = await getPool();
  await requireRoom(pool.request(), lodgeId, roomId);
  await ensureRoomRows(pool, lodgeId);
  await pool
    .request()
    .input('roomId', sql.BigInt, roomId)
    .input('flag', sql.Bit, outOfOrder ? 1 : 0)
    .input('note', sql.NVarChar, outOfOrder ? note || null : null)
    .query(`
      UPDATE dbo.housekeeping_rooms
      SET out_of_order = @flag, out_of_order_note = @note,
          cleaning_started_at = NULL, cleaning_by = NULL,
          needs_cleaning = CASE WHEN @flag = 0 THEN 1 ELSE needs_cleaning END
      WHERE room_id = @roomId
    `);
}

// ---------------------------------------------------------------------------
// Hotel linen — an append-only ledger; stock is derived from it.
// ---------------------------------------------------------------------------

// Pure, exported for a test. Everything is a sum over the ledger:
//   dirty      waiting to go out        = CHANGED - SENT
//   inLaundry  out and not yet back     = SENT - RECEIVED - lost/damaged at the laundry
//   owned      what the lodge still has = totalOwned - every loss
//   clean      in rooms and the store   = owned - dirty - inLaundry
//
// Neither dirty nor at-the-laundry can be negative. Linen sent out beyond what
// was recorded as dirty simply came from the clean pile (the room's linen change
// was never counted), so dirty bottoms out at 0 instead of showing -31.
// `short` flags a lodge whose counts cannot be right (more out than owned), so
// the screen can say "check how many you own" rather than print a negative.
function linenStockOf(row) {
  const n = (v) => Number(v ?? 0);
  const dirty = Math.max(0, n(row.changed) - n(row.sent));
  const inLaundry = Math.max(0, n(row.sent) - n(row.received) - n(row.lost_laundry));
  const owned = n(row.total_owned) - n(row.lost_all);
  const clean = owned - dirty - inLaundry;
  return { owned, dirty, inLaundry, clean: Math.max(0, clean), short: clean < 0, lostTotal: n(row.lost_all) };
}

async function listLinen(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT i.id, i.name, i.total_owned, i.is_active,
             SUM(CASE WHEN m.kind = 'CHANGED' THEN m.quantity ELSE 0 END) AS changed,
             SUM(CASE WHEN m.kind = 'SENT' THEN m.quantity ELSE 0 END) AS sent,
             SUM(CASE WHEN m.kind = 'RECEIVED' THEN m.quantity ELSE 0 END) AS received,
             SUM(CASE WHEN m.kind IN ('LOST', 'DAMAGED') AND m.source = 'LAUNDRY' THEN m.quantity ELSE 0 END) AS lost_laundry,
             SUM(CASE WHEN m.kind IN ('LOST', 'DAMAGED') THEN m.quantity ELSE 0 END) AS lost_all
      FROM dbo.linen_items i
      LEFT JOIN dbo.linen_movements m ON m.linen_item_id = i.id AND m.lodge_id = i.lodge_id
      WHERE i.lodge_id = @lodgeId
      GROUP BY i.id, i.name, i.total_owned, i.is_active
      ORDER BY i.name
    `);
  return result.recordset.map((row) => ({
    id: row.id,
    name: row.name,
    totalOwned: row.total_owned,
    isActive: !!row.is_active,
    ...linenStockOf(row),
  }));
}

// "Towel" and "towel" are the same thing. A second copy would split one stock
// across two rows that can never be reconciled.
async function assertLinenNameFree(pool, lodgeId, name, exceptId = null) {
  const found = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, name)
    .input('exceptId', sql.BigInt, exceptId)
    .query(`
      SELECT TOP 1 name, is_active FROM dbo.linen_items
      WHERE lodge_id = @lodgeId AND LOWER(name) = LOWER(@name) AND (@exceptId IS NULL OR id <> @exceptId)
    `);
  if (found.recordset.length > 0) {
    const hidden = !found.recordset[0].is_active;
    throw new ApiError(
      hidden
        ? `${found.recordset[0].name} is already in your list but hidden. Bring it back instead of adding it again.`
        : `You already have ${found.recordset[0].name}.`,
      409
    );
  }
}

async function createLinenItem(lodgeId, input) {
  const pool = await getPool();
  await assertLinenNameFree(pool, lodgeId, input.name);
  await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, input.name)
    .input('owned', sql.Int, input.totalOwned)
    .query('INSERT INTO dbo.linen_items (lodge_id, name, total_owned) VALUES (@lodgeId, @name, @owned)');
}

async function updateLinenItem(lodgeId, id, input) {
  const pool = await getPool();
  if (input.name !== undefined) await assertLinenNameFree(pool, lodgeId, input.name, id);
  const request = pool.request().input('lodgeId', sql.BigInt, lodgeId).input('id', sql.BigInt, id);
  const sets = [];
  if (input.name !== undefined) {
    request.input('name', sql.NVarChar, input.name);
    sets.push('name = @name');
  }
  if (input.totalOwned !== undefined) {
    request.input('owned', sql.Int, input.totalOwned);
    sets.push('total_owned = @owned');
  }
  if (input.isActive !== undefined) {
    request.input('active', sql.Bit, input.isActive ? 1 : 0);
    sets.push('is_active = @active');
  }
  if (sets.length === 0) throw new ApiError('Nothing to update.', 400);
  const result = await request.query(`UPDATE dbo.linen_items SET ${sets.join(', ')} WHERE id = @id AND lodge_id = @lodgeId`);
  if (result.rowsAffected[0] === 0) throw new ApiError('Linen item not found.', 404);
}

async function addMovements(lodgeId, userId, rows) {
  const pool = await getPool();
  await assertLinenItems(pool.request(), lodgeId, rows.map((r) => r.linenItemId));
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const r of rows) {
      await new sql.Request(transaction)
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('itemId', sql.BigInt, r.linenItemId)
        .input('kind', sql.NVarChar, r.kind)
        .input('source', sql.NVarChar, r.source ?? null)
        .input('qty', sql.Int, r.quantity)
        .input('note', sql.NVarChar, r.note || null)
        .input('userId', sql.BigInt, userId ?? null)
        .query(`
          INSERT INTO dbo.linen_movements (lodge_id, linen_item_id, kind, source, quantity, note, created_by)
          VALUES (@lodgeId, @itemId, @kind, @source, @qty, @note, @userId)
        `);
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

// A batch can only hold linen that exists. Without this the board happily showed
// 31 sheets at the laundry for a lodge that owns 24.
async function stockById(lodgeId) {
  return new Map((await listLinen(lodgeId)).map((i) => [String(i.id), i]));
}

async function sendToLaundry(lodgeId, userId, input) {
  const stock = await stockById(lodgeId);
  for (const l of input.lines) {
    const item = stock.get(String(l.linenItemId));
    if (!item) continue; // an unknown id is rejected by addMovements below
    const available = item.dirty + item.clean;
    if (l.quantity > available) {
      throw new ApiError(
        `Only ${available} ${item.name} ${available === 1 ? 'is' : 'are'} here to send. Check how many you own, or lower the count.`,
        409
      );
    }
  }
  await addMovements(lodgeId, userId, input.lines.map((l) => ({ ...l, kind: 'SENT', note: input.note })));
}

// What came back, and what did not: a shortfall is recorded as lost or damaged
// at the laundry so the stock board stays true.
async function receiveFromLaundry(lodgeId, userId, input) {
  const stock = await stockById(lodgeId);
  for (const l of input.lines) {
    const item = stock.get(String(l.linenItemId));
    if (item && l.received + l.lost + l.damaged > item.inLaundry) {
      throw new ApiError(`Only ${item.inLaundry} ${item.name} ${item.inLaundry === 1 ? 'is' : 'are'} at the laundry.`, 409);
    }
  }
  const rows = [];
  for (const l of input.lines) {
    if (l.received > 0) rows.push({ linenItemId: l.linenItemId, kind: 'RECEIVED', quantity: l.received, note: input.note });
    if (l.lost > 0) rows.push({ linenItemId: l.linenItemId, kind: 'LOST', source: 'LAUNDRY', quantity: l.lost, note: input.note });
    if (l.damaged > 0) rows.push({ linenItemId: l.linenItemId, kind: 'DAMAGED', source: 'LAUNDRY', quantity: l.damaged, note: input.note });
  }
  if (rows.length === 0) throw new ApiError('Enter at least one count.', 400);
  await addMovements(lodgeId, userId, rows);
}

// A loss from the room or store, not at the laundry.
const recordLoss = (lodgeId, userId, input) =>
  addMovements(lodgeId, userId, [{ linenItemId: input.linenItemId, kind: input.kind, source: 'STORE', quantity: input.quantity, note: input.note }]);

async function listLinenMovements(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT TOP 200 m.id, m.kind, m.source, m.quantity, m.note, m.created_at, i.name AS item_name, r.room_number,
             u.name AS user_name
      FROM dbo.linen_movements m
      JOIN dbo.linen_items i ON i.id = m.linen_item_id
      LEFT JOIN dbo.rooms r ON r.id = m.room_id
      LEFT JOIN dbo.users u ON u.id = m.created_by
      WHERE m.lodge_id = @lodgeId
      ORDER BY m.created_at DESC, m.id DESC
    `);
  return result.recordset.map((row) => ({
    id: row.id,
    kind: row.kind,
    source: row.source,
    quantity: row.quantity,
    note: row.note,
    createdAt: row.created_at,
    itemName: row.item_name,
    roomNumber: row.room_number ?? null,
    userName: row.user_name ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Guest laundry — a tagged order of garments. Delivered writes completed
// service uses, which the existing Services to bill flow takes from there.
// ---------------------------------------------------------------------------

const NEXT_STATUS = { RECEIVED: ['WASHING', 'CANCELLED'], WASHING: ['READY', 'CANCELLED'], READY: ['DELIVERED', 'CANCELLED'] };

// There is no price list. Each laundry entry is priced when the clothes are taken
// in; this only remembers what was typed before, so the form can offer the same
// garment at the price last used. Newest price wins, names compared ignoring case.
async function listRecentGarments(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT TOP 40 item_name, unit_price FROM (
        SELECT i.item_name, i.unit_price,
               ROW_NUMBER() OVER (PARTITION BY LOWER(i.item_name) ORDER BY i.id DESC) AS rn
        FROM dbo.laundry_order_items i
        JOIN dbo.laundry_orders o ON o.id = i.order_id
        WHERE o.lodge_id = @lodgeId
      ) x
      WHERE rn = 1
      ORDER BY item_name
    `);
  return result.recordset.map((row) => ({ name: row.item_name, price: Number(row.unit_price) }));
}

// Laundry is a service sold at the lodge's usual service tax rate. It is not asked
// at the desk — staff should not have to think about GST while taking in a bag.
// A property that is not GST registered bills these on a cash receipt with no tax.
const LAUNDRY_GST_RATE = 18;

// Guests staying right now, per room — what a housekeeping login needs to pick
// a guest without being given billing access.
async function listInHouse(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT b.id AS booking_id, br.room_id, r.room_number, b.guest_name
      FROM dbo.booking_rooms br
      JOIN dbo.bookings b ON b.id = br.booking_id
      JOIN dbo.rooms r ON r.id = br.room_id
      WHERE b.lodge_id = @lodgeId AND br.status = 'CHECKED_IN'
      ORDER BY r.room_number
    `);
  return result.recordset.map((row) => ({
    bookingId: row.booking_id,
    roomId: row.room_id,
    roomNumber: row.room_number,
    guestName: row.guest_name,
  }));
}

async function createLaundryOrder(lodgeId, userId, input) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    let roomId = null;
    let guestName = input.guestName || null;
    let guestPhone = input.guestPhone || null;
    if (input.bookingId) {
      const stay = await new sql.Request(transaction)
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('bookingId', sql.BigInt, input.bookingId)
        .input('roomId', sql.BigInt, input.roomId ?? null)
        .query(`
          SELECT TOP 1 br.room_id, b.guest_name, b.guest_phone
          FROM dbo.booking_rooms br
          JOIN dbo.bookings b ON b.id = br.booking_id
          WHERE b.id = @bookingId AND b.lodge_id = @lodgeId AND br.status = 'CHECKED_IN'
            AND (@roomId IS NULL OR br.room_id = @roomId)
          ORDER BY br.room_id
        `);
      if (stay.recordset.length === 0) throw new ApiError('That guest is not checked in.', 409);
      roomId = stay.recordset[0].room_id;
      guestName = guestName || stay.recordset[0].guest_name;
      guestPhone = guestPhone || stay.recordset[0].guest_phone;
    } else if (!guestName) {
      throw new ApiError('Enter the customer’s name, or choose a guest staying in-house.', 400);
    }

    // Per-lodge running tag, taken under a lock so two desks never share one.
    const tag = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .query('SELECT ISNULL(MAX(tag_number), 0) + 1 AS n FROM dbo.laundry_orders WITH (UPDLOCK, HOLDLOCK) WHERE lodge_id = @lodgeId');
    const tagNumber = tag.recordset[0].n;

    const order = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('tag', sql.Int, tagNumber)
      .input('roomId', sql.BigInt, roomId)
      .input('bookingId', sql.BigInt, input.bookingId ?? null)
      .input('guestName', sql.NVarChar, guestName)
      .input('guestPhone', sql.NVarChar, guestPhone)
      .input('note', sql.NVarChar, input.note || null)
      .input('userId', sql.BigInt, userId ?? null)
      .query(`
        INSERT INTO dbo.laundry_orders (lodge_id, tag_number, room_id, booking_id, guest_name, guest_phone, note, created_by)
        OUTPUT inserted.id
        VALUES (@lodgeId, @tag, @roomId, @bookingId, @guestName, @guestPhone, @note, @userId)
      `);
    const orderId = order.recordset[0].id;

    // Priced as typed at the desk. Same garment twice in one entry is two lines,
    // which is what the guest was told, so it is not merged.
    for (const item of input.items) {
      await new sql.Request(transaction)
        .input('orderId', sql.BigInt, orderId)
        .input('name', sql.NVarChar, item.name)
        .input('price', sql.Decimal(10, 2), item.price)
        .input('gst', sql.Decimal(5, 2), LAUNDRY_GST_RATE)
        .input('qty', sql.Int, item.quantity)
        .query(`
          INSERT INTO dbo.laundry_order_items (order_id, service_id, item_name, unit_label, unit_price, gst_rate_percent, quantity)
          VALUES (@orderId, NULL, @name, 'piece', @price, @gst, @qty)
        `);
    }
    await transaction.commit();
    return getLaundryOrder(lodgeId, orderId);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

function mapOrder(row, items) {
  const lines = (items ?? []).map((i) => ({
    id: i.id,
    name: i.item_name,
    quantity: i.quantity,
    unitPrice: Number(i.unit_price),
    lineTotal: Math.round(Number(i.unit_price) * i.quantity * 100) / 100,
  }));
  return {
    id: row.id,
    tagNumber: row.tag_number,
    status: row.status,
    roomNumber: row.room_number ?? null,
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    note: row.note,
    receivedAt: row.received_at,
    deliveredAt: row.delivered_at,
    pieces: lines.reduce((n, l) => n + l.quantity, 0),
    total: Math.round(lines.reduce((n, l) => n + l.lineTotal, 0) * 100) / 100,
    items: lines,
  };
}

async function loadOrders(lodgeId, where) {
  const pool = await getPool();
  const orders = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT TOP 200 o.id, o.tag_number, o.status, o.guest_name, o.guest_phone, o.note, o.received_at, o.delivered_at,
             r.room_number
      FROM dbo.laundry_orders o
      LEFT JOIN dbo.rooms r ON r.id = o.room_id
      WHERE o.lodge_id = @lodgeId AND ${where}
      ORDER BY o.received_at DESC
    `);
  if (orders.recordset.length === 0) return [];
  const itemsRequest = pool.request();
  orders.recordset.forEach((o, i) => itemsRequest.input(`o${i}`, sql.BigInt, o.id));
  const items = await itemsRequest.query(`
    SELECT id, order_id, item_name, quantity, unit_price FROM dbo.laundry_order_items
    WHERE order_id IN (${orders.recordset.map((_, i) => `@o${i}`).join(', ')}) ORDER BY id
  `);
  const byOrder = new Map();
  for (const item of items.recordset) byOrder.set(String(item.order_id), [...(byOrder.get(String(item.order_id)) ?? []), item]);
  return orders.recordset.map((o) => mapOrder(o, byOrder.get(String(o.id))));
}

async function getLaundryOrder(lodgeId, id) {
  const orders = await loadOrders(lodgeId, `o.id = ${Number(id)}`);
  if (orders.length === 0) throw new ApiError('Laundry order not found.', 404);
  return orders[0];
}

// 'open' = still with us; anything else = the most recent of every kind.
const listLaundryOrders = (lodgeId, scope) =>
  loadOrders(lodgeId, scope === 'open' ? "o.status IN ('RECEIVED', 'WASHING', 'READY')" : '1 = 1');

async function setLaundryStatus(lodgeId, userId, id, status) {
  const pool = await getPool();
  const current = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('id', sql.BigInt, id)
    .query('SELECT status FROM dbo.laundry_orders WHERE id = @id AND lodge_id = @lodgeId');
  if (current.recordset.length === 0) throw new ApiError('Laundry order not found.', 404);
  const from = current.recordset[0].status;
  if (!(NEXT_STATUS[from] ?? []).includes(status)) {
    throw new ApiError(`This order is ${from.toLowerCase()} and cannot move to ${status.toLowerCase()}.`, 409);
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    // The guard on the old status is what stops two people delivering the same
    // order and billing it twice.
    const moved = await new sql.Request(transaction)
      .input('id', sql.BigInt, id)
      .input('from', sql.NVarChar, from)
      .input('to', sql.NVarChar, status)
      .query(`
        UPDATE dbo.laundry_orders
        SET status = @to, delivered_at = CASE WHEN @to = 'DELIVERED' THEN SYSDATETIMEOFFSET() ELSE delivered_at END
        OUTPUT inserted.tag_number, inserted.room_id, inserted.booking_id, inserted.guest_name, inserted.guest_phone
        WHERE id = @id AND status = @from
      `);
    if (moved.recordset.length === 0) throw new ApiError('Someone else just changed this order.', 409);

    if (status === 'DELIVERED') {
      const order = moved.recordset[0];
      const items = await new sql.Request(transaction)
        .input('id', sql.BigInt, id)
        .query('SELECT service_id, item_name, unit_label, unit_price, gst_rate_percent, quantity FROM dbo.laundry_order_items WHERE order_id = @id');
      for (const item of items.recordset) {
        await new sql.Request(transaction)
          .input('lodgeId', sql.BigInt, lodgeId)
          .input('serviceId', sql.BigInt, item.service_id)
          .input('name', sql.NVarChar, item.item_name)
          .input('unit', sql.NVarChar, item.unit_label)
          .input('price', sql.Decimal(10, 2), item.unit_price)
          .input('gst', sql.Decimal(5, 2), item.gst_rate_percent)
          .input('qty', sql.Decimal(8, 2), item.quantity)
          .input('total', sql.Decimal(10, 2), Math.round(Number(item.unit_price) * item.quantity * 100) / 100)
          .input('roomId', sql.BigInt, order.room_id)
          .input('bookingId', sql.BigInt, order.booking_id)
          .input('guestName', sql.NVarChar, order.guest_name)
          .input('guestPhone', sql.NVarChar, order.guest_phone)
          .input('note', sql.NVarChar, `Laundry tag ${order.tag_number}`)
          .input('userId', sql.BigInt, userId ?? null)
          .input('orderId', sql.BigInt, id)
          .query(`
            INSERT INTO dbo.service_usages
              (lodge_id, service_id, service_name, unit_label, unit_price, gst_rate_percent, quantity, line_total,
               room_id, booking_id, guest_name, guest_phone, note, status, completed_at, created_by, laundry_order_id)
            VALUES (@lodgeId, @serviceId, @name, @unit, @price, @gst, @qty, @total,
                    @roomId, @bookingId, @guestName, @guestPhone, @note, 'COMPLETED', SYSDATETIMEOFFSET(), @userId, @orderId)
          `);
      }
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
  return getLaundryOrder(lodgeId, id);
}

module.exports = {
  roomStatusOf,
  linenStockOf,
  listRooms,
  startCleaning,
  releaseRoom,
  finishCleaning,
  markDirty,
  setOutOfOrder,
  listLinen,
  createLinenItem,
  updateLinenItem,
  sendToLaundry,
  receiveFromLaundry,
  recordLoss,
  listLinenMovements,
  listRecentGarments,
  listInHouse,
  createLaundryOrder,
  listLaundryOrders,
  setLaundryStatus,
};
