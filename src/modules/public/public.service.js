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

// How many photos one room type carries onto the page. A type with eight rooms
// behind it can pool forty, which is a slower page and a gallery nobody reaches
// the end of.
const MAX_TYPE_IMAGES = 12;

// What the public page lists: the room *types* a guest can book, not the
// individual rooms behind them. Every booking site works this way — you choose
// a "Deluxe Double", and which room you get is decided at the desk — and it is
// what keeps five identical Deluxe rooms from reading as five separate
// products on a page that should be selling one.
//
// Room numbers, floors and room ids deliberately never leave this function.
// Hiding them in the page would have left them in the JSON for anyone with
// devtools; more to the point, per-room availability published daily lets
// anybody map which rooms are occupied when, which is the property's business
// and nobody else's. A count per type answers the guest's question — is there
// space — without answering that one.
//
// Cheapest type first, so the page reads like a rate card. With a date range,
// each type carries how many of its rooms are free, on the same overlap rule
// the reception tape chart uses, so a guest sees the truth staff see.
async function listPublicRoomTypes(lodgeId, checkInDate, checkOutDate) {
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
      SELECT r.id, r.bed_size, r.bathroom_type, r.max_occupancy, r.description,
             c.id AS category_id, c.name AS category_name, c.base_price AS category_base_price${availabilityColumn}
      FROM dbo.rooms r
      JOIN dbo.room_categories c ON c.id = r.category_id
      WHERE r.lodge_id = @lodgeId AND r.is_active = 1
      -- room_number still orders the rows even though it is never returned: it
      -- decides whose photos lead each type's gallery, and "the lowest-numbered
      -- room first" is at least stable between page loads.
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

  const byCategory = new Map();
  for (const row of roomsResult.recordset) {
    const key = String(row.category_id);
    let type = byCategory.get(key);
    if (!type) {
      type = {
        id: row.category_id,
        name: row.category_name,
        // Every room in a category is sold at the category's price, so this is
        // the exact nightly rate rather than a "from".
        price: Number(row.category_base_price),
        roomCount: 0,
        // null, not 0, when no dates were asked for — "we don't know" and "none
        // free" have to look different to the page.
        availableCount: hasDateRange ? 0 : null,
        bedSizes: [],
        bathroomTypes: [],
        minOccupancy: null,
        maxOccupancy: null,
        description: '',
        images: [],
      };
      byCategory.set(key, type);
    }

    type.roomCount += 1;
    if (hasDateRange && row.is_available) type.availableCount += 1;
    if (row.bed_size && !type.bedSizes.includes(row.bed_size)) type.bedSizes.push(row.bed_size);
    if (row.bathroom_type && !type.bathroomTypes.includes(row.bathroom_type)) {
      type.bathroomTypes.push(row.bathroom_type);
    }
    // A range, because rooms in one category needn't sleep the same number —
    // "sleeps 2–3" is honest where a single figure would be wrong for some of
    // the rooms it is describing.
    if (row.max_occupancy) {
      type.minOccupancy = type.minOccupancy == null ? row.max_occupancy : Math.min(type.minOccupancy, row.max_occupancy);
      type.maxOccupancy = type.maxOccupancy == null ? row.max_occupancy : Math.max(type.maxOccupancy, row.max_occupancy);
    }
    // Descriptions are written per room today, so the type borrows the first
    // one written. A category-level description is what this really wants.
    if (!type.description && row.description && row.description.trim()) {
      type.description = row.description.trim();
    }
    for (const filename of imagesByRoom.get(row.id) || []) {
      if (type.images.length >= MAX_TYPE_IMAGES) break;
      if (!type.images.includes(filename)) type.images.push(filename);
    }
  }

  return Array.from(byCategory.values());
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
          // The dish photo, as a bare filename the browser resolves against the
          // /menu-images static mount. null on the dishes nobody photographed,
          // which on most menus is most of them.
          image: item.image,
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
// check-in, and every guest-side request carries both. There is still no server
// session behind it: the phone remembers the pair and re-sends it, and this
// checks it afresh each time. That is what makes the guest's "log in" survive a
// refresh while still going dead the moment reception checks them out and the
// PIN is cleared — nothing has to be expired or revoked, because nothing was
// ever issued.
//
// Every caller that touches a room's food gets here first, so the lockout and
// the uniform failure below cover the whole guest surface rather than just
// placement.
async function verifyRoomAccess(slug, roomNumber, pin) {
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

  return {
    lodge,
    pool,
    roomLabel,
    roomId: row.room_id,
    bookingId: row.booking_id,
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
  };
}

// What the phone gets when the guest signs in: enough to greet them and to
// know the sign-in took, and nothing about the property it couldn't already
// read off the public menu. The PIN itself is never echoed back.
async function openGuestSession(slug, roomNumber, pin) {
  const access = await verifyRoomAccess(slug, roomNumber, pin);
  return {
    roomNumber: access.roomLabel,
    guestName: access.guestName || '',
    lodge: { name: access.lodge.name, slug: access.lodge.slug, phone: access.lodge.phone },
  };
}

// The orders belonging to *this stay*, not to this room. Scoped on booking_id,
// so the guest who checks in on Friday cannot read what the last guest in that
// room ate on Thursday — the room number is reused, the booking never is.
const GUEST_ORDER_HISTORY_LIMIT = 40;

// PENDING and QUEUED only. Once a pan is on the heat the food exists, and a
// screen that offered "cancel" then would be writing a cheque the kitchen has
// to honour. From there the guest is told to call the desk, who can cancel it
// as staff and decide what happens to the dish.
const GUEST_EDITABLE_STATUSES = ['PENDING', 'QUEUED'];

async function listGuestOrders(slug, roomNumber, pin) {
  const access = await verifyRoomAccess(slug, roomNumber, pin);
  const { pool, lodge, bookingId } = access;

  const ordersResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodge.id)
    .input('bookingId', sql.BigInt, bookingId)
    .input('limit', sql.Int, GUEST_ORDER_HISTORY_LIMIT)
    .query(`
      SELECT TOP (@limit)
             o.id, o.public_token, o.order_number, o.status, o.subtotal, o.note,
             o.placed_at, o.cancelled_at
      FROM dbo.food_orders o
      WHERE o.lodge_id = @lodgeId AND o.booking_id = @bookingId AND o.source = 'ROOM'
      ORDER BY o.placed_at DESC
    `);

  const rows = ordersResult.recordset;
  if (rows.length === 0) {
    return { roomNumber: access.roomLabel, guestName: access.guestName || '', orders: [] };
  }

  const itemsRequest = pool.request();
  rows.forEach((row, index) => itemsRequest.input(`o${index}`, sql.BigInt, row.id));
  const itemsResult = await itemsRequest.query(`
    SELECT order_id, id, item_name, unit_price, quantity, line_total,
           menu_item_id, menu_item_portion_id
    FROM dbo.food_order_items
    WHERE order_id IN (${rows.map((_, index) => `@o${index}`).join(', ')})
    ORDER BY id ASC
  `);

  const itemsByOrder = new Map();
  for (const row of itemsResult.recordset) {
    const list = itemsByOrder.get(String(row.order_id)) || [];
    list.push({
      id: row.id,
      name: row.item_name,
      unitPrice: Number(row.unit_price),
      quantity: row.quantity,
      lineTotal: Number(row.line_total),
      // The two ids the edit screen needs to put this line back in the cart as
      // the dish and size it came from, rather than by matching on its name.
      itemId: row.menu_item_id,
      portionId: row.menu_item_portion_id,
    });
    itemsByOrder.set(String(row.order_id), list);
  }

  return {
    roomNumber: access.roomLabel,
    guestName: access.guestName || '',
    orders: rows.map((row) => ({
      // The order's own opaque token is its handle everywhere on the guest
      // side. Order numbers restart daily and are called across the kitchen,
      // so they name an order to a human but must never address one.
      token: row.public_token,
      orderNumber: row.order_number,
      status: row.status,
      subtotal: Number(row.subtotal),
      note: row.note || '',
      placedAt: row.placed_at,
      cancelledAt: row.cancelled_at,
      // Decided here rather than on the phone, so the buttons a guest sees and
      // the rules the server enforces can never drift apart.
      canModify: GUEST_EDITABLE_STATUSES.includes(row.status),
      items: itemsByOrder.get(String(row.id)) || [],
    })),
  };
}

// Finds an order the signed-in guest is actually allowed to touch: theirs, on
// this stay, at this property. A token from someone else's order is a 404 —
// the same answer a token that never existed gets.
async function findGuestOrder(access, token) {
  const result = await access.pool
    .request()
    .input('lodgeId', sql.BigInt, access.lodge.id)
    .input('bookingId', sql.BigInt, access.bookingId)
    .input('token', sql.NVarChar, String(token || ''))
    .query(`
      SELECT id, status, order_number
      FROM dbo.food_orders
      WHERE public_token = @token AND lodge_id = @lodgeId AND booking_id = @bookingId
    `);

  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('Order not found.', 404);
  }
  return row;
}

const TOO_LATE_MESSAGE =
  'The kitchen has already started this order, so it can’t be changed from here. Please call the front desk.';

async function updateGuestOrder(slug, roomNumber, pin, token, { items, note, guestName }) {
  const access = await verifyRoomAccess(slug, roomNumber, pin);
  const order = await findGuestOrder(access, token);

  if (!GUEST_EDITABLE_STATUSES.includes(order.status)) {
    throw new ApiError(TOO_LATE_MESSAGE, 409);
  }

  // The status is passed down as well as checked above: this read is already a
  // moment old, and the write is what has to be right if the kitchen accepts
  // the order in between.
  const { subtotal } = await ordersService.replaceOrderItems(access.lodge.id, order.id, items, {
    note,
    guestName: guestName || access.guestName,
    allowedStatuses: GUEST_EDITABLE_STATUSES,
  });

  return { token, orderNumber: order.order_number, status: order.status, subtotal };
}

async function cancelGuestOrder(slug, roomNumber, pin, token) {
  const access = await verifyRoomAccess(slug, roomNumber, pin);
  const order = await findGuestOrder(access, token);

  if (!GUEST_EDITABLE_STATUSES.includes(order.status)) {
    throw new ApiError(TOO_LATE_MESSAGE, 409);
  }

  await ordersService.updateStatus(access.lodge.id, order.id, 'CANCELLED', {
    // Written onto the order so the kitchen screen shows who dropped it — a
    // ticket that vanishes with no reason reads like the system lost it.
    cancelReason: 'Cancelled by the guest',
    fromStatuses: GUEST_EDITABLE_STATUSES,
  });

  return { token, orderNumber: order.order_number, status: 'CANCELLED' };
}

async function placeRoomOrder(slug, roomNumber, { pin, items, note, guestName, guestPhone }) {
  const { lodge, roomId, bookingId, guestName: bookedName, guestPhone: bookedPhone } =
    await verifyRoomAccess(slug, roomNumber, pin);

  // PIN-verified, so the kitchen doesn't need to vet it — straight to the queue.
  const created = await ordersService.createOrder(lodge.id, {
    source: 'ROOM',
    roomId,
    bookingId,
    guestName: guestName || bookedName,
    guestPhone: guestPhone || bookedPhone,
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
  listPublicRoomTypes,
  getPublicMenu,
  getLodgeOrderingContext,
  getTableOrderingContext,
  openGuestSession,
  listGuestOrders,
  updateGuestOrder,
  cancelGuestOrder,
  placeRoomOrder,
  placeTableOrder,
  getPublicOrderStatus,
  clearPinLockout,
};
