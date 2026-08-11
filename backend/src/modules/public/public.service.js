const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const menuService = require('../menu/menu.service');
const ordersService = require('../orders/orders.service');

async function getLodgeBySlug(slug) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('slug', sql.NVarChar, slug)
    .query(`
      SELECT id, name, slug, phone, whatsapp_number, address, city, state,
             has_rooms, serves_food, food_room_service, food_table_service
      FROM dbo.lodges
      WHERE slug = @slug AND is_active = 1
    `);

  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('Lodge not found.', 404);
  }

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    phone: row.phone,
    whatsappNumber: row.whatsapp_number,
    address: row.address,
    city: row.city,
    state: row.state,
    hasRooms: !!row.has_rooms,
    servesFood: !!row.serves_food,
    foodRoomService: !!row.food_room_service,
    foodTableService: !!row.food_table_service,
  };
}

// A stripped-down room listing for the public brochure page — active rooms
// only, no booking/guest data, cheapest category first so the page reads
// like a rate card. When a date range is given, each room also gets an
// `available` flag — same overlap rule as the reception tape chart (a room
// is unavailable if any BOOKED/CHECKED_IN stay overlaps the requested
// range), so a guest sees the same truth staff would see.
async function listPublicRooms(lodgeId, checkInDate, checkOutDate) {
  const pool = await getPool();
  const hasDateRange = Boolean(checkInDate && checkOutDate);

  const roomsRequest = pool.request().input('lodgeId', sql.BigInt, lodgeId);
  let availabilityColumn = '';
  if (hasDateRange) {
    roomsRequest.input('checkInDate', sql.Date, checkInDate).input('checkOutDate', sql.Date, checkOutDate);
    availabilityColumn = `,
             CASE WHEN EXISTS (
               SELECT 1 FROM dbo.bookings b
               WHERE b.room_id = r.id AND b.status IN ('BOOKED', 'CHECKED_IN')
                 AND b.check_in_date < @checkOutDate AND b.check_out_date > @checkInDate
             ) THEN 0 ELSE 1 END AS is_available`;
  }

  const roomsResult = await roomsRequest.query(`
      SELECT r.id, r.room_number, r.floor, r.bed_size, r.bathroom_type, r.max_occupancy, r.description,
             c.name AS category_name, c.base_price AS category_base_price${availabilityColumn}
      FROM dbo.rooms r
      JOIN dbo.room_categories c ON c.id = r.category_id
      WHERE r.lodge_id = @lodgeId AND r.is_active = 1
      ORDER BY c.base_price ASC, r.room_number ASC
    `);

  const imagesResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT ri.room_id, ri.filename
      FROM dbo.room_images ri
      JOIN dbo.rooms r ON r.id = ri.room_id
      WHERE r.lodge_id = @lodgeId AND r.is_active = 1
      ORDER BY ri.sort_order ASC, ri.id ASC
    `);

  const imagesByRoom = new Map();
  for (const row of imagesResult.recordset) {
    const list = imagesByRoom.get(row.room_id) || [];
    list.push(row.filename);
    imagesByRoom.set(row.room_id, list);
  }

  return roomsResult.recordset.map((row) => ({
    id: row.id,
    roomNumber: row.room_number,
    floor: row.floor,
    bedSize: row.bed_size,
    bathroomType: row.bathroom_type,
    maxOccupancy: row.max_occupancy,
    description: row.description,
    categoryName: row.category_name,
    price: Number(row.category_base_price),
    images: imagesByRoom.get(row.id) || [],
    available: hasDateRange ? !!row.is_available : null,
  }));
}

// ---------------------------------------------------------------------------
// Food ordering — the guest side
// ---------------------------------------------------------------------------

// Sections and items a guest may actually order right now: active ones only,
// and unavailable items are dropped rather than greyed out, so an empty
// section means the kitchen has run out of everything in it. Empty sections
// are removed too — a guest doesn't need to see a heading with nothing under it.
async function getPublicMenu(lodgeId) {
  const sections = await menuService.getMenu(lodgeId, { activeOnly: true });

  return sections
    .map((section) => ({
      id: section.id,
      name: section.name,
      items: section.items
        .filter((item) => item.isAvailable)
        // A dish offering sizes is only orderable through one of them, so a
        // dish whose every size has run out drops out of the menu exactly like
        // an unavailable dish does — there is nothing left to order. hadSizes
        // is remembered before the filter, or a dish that just lost its last
        // size would look like an ordinary single-price one.
        .map((item) => ({
          ...item,
          hadSizes: item.portions.length > 0,
          portions: item.portions.filter((portion) => portion.isAvailable),
        }))
        .filter((item) => !item.hadSizes || item.portions.length > 0)
        .map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          // Ignored by the client when portions are present; each portion
          // carries the price that is actually charged.
          price: item.price,
          foodType: item.foodType,
          portions: item.portions.map((portion) => ({
            id: portion.id,
            label: portion.label,
            price: portion.price,
          })),
        })),
    }))
    .filter((section) => section.items.length > 0);
}

function assertServesFood(lodge) {
  if (!lodge.servesFood) {
    throw new ApiError('This property isn’t taking food orders.', 404);
  }
}

// The single public ordering page: one link for the whole property, reached
// from a QR at reception or in a room. It returns the menu and nothing else
// about the property's state.
//
// There is deliberately no "is room 12 ordering open?" lookup to go with it.
// The previous per-room page had one, and behind a single shared link that
// becomes an occupancy oracle — anyone could walk the room numbers and read off
// who's staying. Whether a room can order is now only ever revealed by trying,
// against the uniform failure in placeRoomOrder.
async function getLodgeOrderingContext(slug) {
  const lodge = await getLodgeBySlug(slug);
  assertServesFood(lodge);

  return {
    lodge: { name: lodge.name, slug: lodge.slug, phone: lodge.phone },
    target: null,
    // Whether the room-number + PIN form is shown at all. Not a statement about
    // any particular room.
    roomOrderingEnabled: lodge.foodRoomService,
    menu: await getPublicMenu(lodge.id),
  };
}

async function getTableOrderingContext(token) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('token', sql.NVarChar, token)
    .query(`
      SELECT t.id, t.label, t.lodge_id
      FROM dbo.dining_tables t
      JOIN dbo.lodges l ON l.id = t.lodge_id
      WHERE t.qr_token = @token AND t.is_active = 1 AND l.is_active = 1
    `);
  const table = result.recordset[0];
  if (!table) {
    throw new ApiError('This QR code isn’t in use.', 404);
  }

  const lodgeResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, table.lodge_id)
    .query(`
      SELECT id, name, slug, phone, serves_food, food_table_service
      FROM dbo.lodges WHERE id = @lodgeId
    `);
  const lodge = lodgeResult.recordset[0];

  if (!lodge.serves_food || !lodge.food_table_service) {
    throw new ApiError('This property isn’t taking table orders.', 404);
  }

  // No orderingOpen flag: resolving the token at all is the answer. A table
  // whose QR is live can always order — there's no per-table state to report,
  // and nothing here should hint at what's happening in the building.
  return {
    lodge: { name: lodge.name, slug: lodge.slug, phone: lodge.phone },
    target: { type: 'TABLE', label: table.label },
    menu: await getPublicMenu(table.lodge_id),
  };
}

// A room order is only accepted against the PIN issued at check-in, so the
// guest proves they're the one in the room rather than someone who walked past
// the door and photographed the QR. Verified here, at placement, rather than
// exchanged for a session — there's nothing to log in to and nothing to expire.
// Every way a room order can fail authentication returns exactly this — an
// unknown room number, a room nobody is checked into, and a wrong PIN are
// indistinguishable from outside. Ordering now happens behind one link for the
// whole property rather than a QR on a specific door, so a distinguishable
// error would let anyone with that link enumerate room numbers and read off
// which rooms are occupied.
const PIN_FAILURE_MESSAGE =
  'That room number and PIN don’t match. Check the slip reception gave you, or call the front desk.';

const LOCKOUT_MESSAGE = 'Too many attempts for this room. Please call the front desk.';

const PIN_WINDOW_MS = 15 * 60 * 1000;
const PIN_MAX_FAILURES = 5;
const PIN_LOCK_MS = 15 * 60 * 1000;

// Records a failed PIN attempt against the room number *as typed*. A room that
// doesn't exist is tracked exactly like one that does — see the schema comment
// on food_pin_lockouts for why that's load-bearing rather than incidental.
async function recordPinFailure(pool, lodgeId, roomLabel) {
  await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roomLabel', sql.NVarChar, roomLabel)
    .input('windowMs', sql.Int, PIN_WINDOW_MS)
    .input('maxFailures', sql.Int, PIN_MAX_FAILURES)
    .input('lockMs', sql.Int, PIN_LOCK_MS)
    .query(`
      MERGE dbo.food_pin_lockouts WITH (HOLDLOCK) AS t
      USING (SELECT @lodgeId AS lodge_id, @roomLabel AS room_label) AS s
        ON t.lodge_id = s.lodge_id AND t.room_label = s.room_label
      WHEN MATCHED THEN UPDATE SET
        -- A burst of failures long ago shouldn't add to one happening now, so
        -- an expired window resets the count to this single attempt.
        failed_count = CASE
          WHEN DATEDIFF(SECOND, t.first_failed_at, SYSDATETIMEOFFSET()) * 1000 > @windowMs THEN 1
          ELSE t.failed_count + 1
        END,
        first_failed_at = CASE
          WHEN DATEDIFF(SECOND, t.first_failed_at, SYSDATETIMEOFFSET()) * 1000 > @windowMs THEN SYSDATETIMEOFFSET()
          ELSE t.first_failed_at
        END,
        last_failed_at = SYSDATETIMEOFFSET(),
        locked_until = CASE
          WHEN DATEDIFF(SECOND, t.first_failed_at, SYSDATETIMEOFFSET()) * 1000 <= @windowMs
               AND t.failed_count + 1 >= @maxFailures
            THEN DATEADD(MILLISECOND, @lockMs, SYSDATETIMEOFFSET())
          ELSE t.locked_until
        END
      WHEN NOT MATCHED THEN
        INSERT (lodge_id, room_label, failed_count) VALUES (s.lodge_id, s.room_label, 1);
    `);
}

async function getActiveLock(pool, lodgeId, roomLabel) {
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roomLabel', sql.NVarChar, roomLabel)
    .query(`
      SELECT locked_until FROM dbo.food_pin_lockouts
      WHERE lodge_id = @lodgeId AND room_label = @roomLabel
        AND locked_until IS NOT NULL AND locked_until > SYSDATETIMEOFFSET()
    `);
  return result.recordset[0]?.locked_until ?? null;
}

async function clearPinLockout(lodgeId, roomLabel) {
  const pool = await getPool();
  await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roomLabel', sql.NVarChar, roomLabel)
    .query('DELETE FROM dbo.food_pin_lockouts WHERE lodge_id = @lodgeId AND room_label = @roomLabel');
}

// The guest types their room number and the PIN reception gave them at
// check-in. Verified here, at placement — there's no session to hand out and
// nothing to log in to, so the PIN is checked afresh on every order.
async function placeRoomOrder(slug, roomNumber, { pin, items, note, guestName, guestPhone }) {
  const lodge = await getLodgeBySlug(slug);
  assertServesFood(lodge);
  if (!lodge.foodRoomService) {
    throw new ApiError('This property doesn’t take orders to rooms.', 404);
  }

  const pool = await getPool();
  const roomLabel = String(roomNumber || '').trim();

  // Checked before the room is even looked up, so a locked room and a locked
  // nonexistent room behave identically.
  if (await getActiveLock(pool, lodge.id, roomLabel)) {
    throw new ApiError(LOCKOUT_MESSAGE, 429);
  }

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodge.id)
    .input('roomNumber', sql.NVarChar, roomLabel)
    .query(`
      SELECT TOP 1 r.id AS room_id, b.id AS booking_id, b.food_pin, b.guest_name, b.guest_phone
      FROM dbo.rooms r
      LEFT JOIN dbo.bookings b
        ON b.room_id = r.id AND b.lodge_id = @lodgeId AND b.status = 'CHECKED_IN'
      WHERE r.lodge_id = @lodgeId AND r.room_number = @roomNumber AND r.is_active = 1
      ORDER BY b.actual_check_in_at DESC
    `);
  const row = result.recordset[0];

  const pinMatches =
    row && row.booking_id && row.food_pin && String(pin || '').trim() === String(row.food_pin);

  if (!pinMatches) {
    await recordPinFailure(pool, lodge.id, roomLabel);
    // Re-read rather than assume: this attempt may have been the one that
    // tripped the lock, and the guest should be told to stop trying now.
    if (await getActiveLock(pool, lodge.id, roomLabel)) {
      throw new ApiError(LOCKOUT_MESSAGE, 429);
    }
    throw new ApiError(PIN_FAILURE_MESSAGE, 401);
  }

  // A correct PIN clears the slate — a guest who fumbled it three times and
  // then got it right shouldn't be closer to a lockout on their next order.
  await clearPinLockout(lodge.id, roomLabel);

  // PIN-verified, so the kitchen doesn't need to vet it — straight to the queue.
  const created = await ordersService.createOrder(lodge.id, {
    source: 'ROOM',
    roomId: row.room_id,
    bookingId: row.booking_id,
    guestName: guestName || row.guest_name,
    guestPhone: guestPhone || row.guest_phone,
    note,
    items,
    status: 'QUEUED',
  });

  return {
    orderNumber: created.orderNumber,
    status: created.status,
    subtotal: created.subtotal,
    token: created.publicToken,
  };
}

// A table QR has no booking and no PIN behind it, so this order lands as
// PENDING and waits for the kitchen to accept it. That's the whole guard: a
// prank order from outside the restaurant costs the kitchen one tap to reject,
// not a wasted dish.
async function placeTableOrder(token, { items, note, guestName, guestPhone }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('token', sql.NVarChar, token)
    .query(`
      SELECT t.id, t.lodge_id, l.serves_food, l.food_table_service
      FROM dbo.dining_tables t
      JOIN dbo.lodges l ON l.id = t.lodge_id
      WHERE t.qr_token = @token AND t.is_active = 1 AND l.is_active = 1
    `);
  const table = result.recordset[0];
  if (!table) {
    throw new ApiError('This QR code isn’t in use.', 404);
  }
  if (!table.serves_food || !table.food_table_service) {
    throw new ApiError('This property isn’t taking table orders.', 404);
  }

  const created = await ordersService.createOrder(table.lodge_id, {
    source: 'TABLE',
    tableId: table.id,
    guestName,
    guestPhone,
    note,
    items,
    status: 'PENDING',
  });


  return {
    orderNumber: created.orderNumber,
    status: created.status,
    subtotal: created.subtotal,
    token: created.publicToken,
  };
}

// Lets the guest's phone follow the order to the pass. Keyed on the opaque
// token handed back at placement rather than on (room number, order number):
// order numbers restart at 1 every day and are printed on the kitchen screen,
// so anyone could have walked them and learned which rooms were ordering. A
// token holder learns about their own order and nothing else.
async function getPublicOrderStatus(token) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('token', sql.NVarChar, token)
    .query(`
      SELECT o.order_number, o.status, o.subtotal, o.placed_at
      FROM dbo.food_orders o
      WHERE o.public_token = @token
    `);

  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('Order not found.', 404);
  }

  return {
    orderNumber: row.order_number,
    status: row.status,
    subtotal: Number(row.subtotal),
    placedAt: row.placed_at,
  };
}

module.exports = {
  getLodgeBySlug,
  listPublicRooms,
  getPublicMenu,
  getLodgeOrderingContext,
  getTableOrderingContext,
  placeRoomOrder,
  placeTableOrder,
  getPublicOrderStatus,
  clearPinLockout,
};
