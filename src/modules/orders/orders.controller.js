const { counterOrderSchema, updateStatusSchema, updateItemReadySchema } = require('./orders.schema');
const ordersService = require('./orders.service');
const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');

function parse(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0].message, 400);
  }
  return parsed.data;
}

async function listOrdersHandler(req, res, next) {
  try {
    const orders = await ordersService.listOrders(req.user.lodgeId, {
      status: req.query.status,
      date: req.query.date,
    });
    res.json({ orders });
  } catch (err) {
    next(err);
  }
}

// The kitchen screen polls this. Kept separate from the day list so the screen
// never has to reason about dates — it asks for "what's still cooking".
async function listQueueHandler(req, res, next) {
  try {
    const orders = await ordersService.listOrders(req.user.lodgeId, { live: true });
    res.json({ orders });
  } catch (err) {
    next(err);
  }
}

async function getOrderHandler(req, res, next) {
  try {
    const order = await ordersService.getOrder(req.user.lodgeId, Number(req.params.id));
    res.json({ order });
  } catch (err) {
    next(err);
  }
}

// A counter order attached to a room is charged to whoever is in it, so the
// room's live booking is resolved here rather than trusted from the client.
async function resolveRoomBooking(lodgeId, roomId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roomId', sql.BigInt, roomId)
    .query(`
      SELECT TOP 1 id FROM dbo.bookings
      WHERE lodge_id = @lodgeId AND room_id = @roomId AND status = 'CHECKED_IN'
      ORDER BY actual_check_in_at DESC
    `);
  return result.recordset[0]?.id ?? null;
}

// Who the desk is about to charge. Staff pick a room from the dropdown and
// see the name and phone of whoever is actually checked into it, so a walk-in
// claiming "room 12, put it on my bill" is checked against the register before
// the food is charged to a stranger's stay.
//
// Deliberately not the guest's food PIN. The PIN authenticates an anonymous
// phone as being in a room; staff are already authenticated, and asking them
// to type it would let a desk typo trip the guest's own 15-minute lockout.
// This answers the question staff actually have — "is this the right guest?" —
// and answers it by showing them the register rather than by taking a secret.
async function roomOccupancyHandler(req, res, next) {
  try {
    const lodgeId = req.user.lodgeId;
    const roomId = Number(req.params.roomId);
    if (!Number.isSafeInteger(roomId) || roomId <= 0) {
      throw new ApiError('Unknown room.', 400);
    }

    const pool = await getPool();
    const result = await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('roomId', sql.BigInt, roomId)
      .query(`
        SELECT TOP 1 r.room_number, b.id AS booking_id, b.guest_name, b.guest_phone
        FROM dbo.rooms r
        LEFT JOIN dbo.bookings b
          ON b.room_id = r.id AND b.lodge_id = @lodgeId AND b.status = 'CHECKED_IN'
        WHERE r.id = @roomId AND r.lodge_id = @lodgeId
        ORDER BY b.actual_check_in_at DESC
      `);

    const row = result.recordset[0];
    if (!row) {
      throw new ApiError('Room not found.', 404);
    }

    // An empty room is a normal answer, not an error: the desk may still serve
    // food to it, and the screen says "nobody checked in" rather than failing.
    res.json({
      occupancy: {
        roomNumber: row.room_number,
        occupied: !!row.booking_id,
        guestName: row.guest_name || '',
        guestPhone: row.guest_phone || '',
      },
    });
  } catch (err) {
    next(err);
  }
}

async function createCounterOrderHandler(req, res, next) {
  try {
    const input = parse(counterOrderSchema, req.body);
    const lodgeId = req.user.lodgeId;

    let source = 'COUNTER';
    let roomId = null;
    let tableId = null;
    let bookingId = null;

    if (input.roomId) {
      const roomResult = await (await getPool())
        .request()
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('roomId', sql.BigInt, input.roomId)
        .query('SELECT id FROM dbo.rooms WHERE id = @roomId AND lodge_id = @lodgeId');
      if (roomResult.recordset.length === 0) {
        throw new ApiError('Room not found.', 404);
      }
      bookingId = await resolveRoomBooking(lodgeId, input.roomId);
      // No active booking on the room, so there is nobody to charge the food
      // to. Refused here rather than just noted on the screen — the client
      // check is only a courtesy, and a direct API call has to obey this too.
      if (!bookingId) {
        throw new ApiError('This room has no guest checked in — a food order can’t be placed for it.', 409);
      }
      source = 'ROOM';
      roomId = input.roomId;
    } else if (input.tableId) {
      const tableResult = await (await getPool())
        .request()
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('tableId', sql.BigInt, input.tableId)
        .query('SELECT id FROM dbo.dining_tables WHERE id = @tableId AND lodge_id = @lodgeId');
      if (tableResult.recordset.length === 0) {
        throw new ApiError('Table not found.', 404);
      }
      source = 'TABLE';
      tableId = input.tableId;
    }

    // Staff typed it in, so there is nothing to verify — it joins the queue
    // directly rather than waiting for the kitchen to accept it.
    const result = await ordersService.createOrder(lodgeId, {
      source,
      roomId,
      bookingId,
      tableId,
      guestName: input.guestName,
      guestPhone: input.guestPhone,
      note: input.note,
      items: input.items,
      status: 'QUEUED',
      createdBy: req.user.sub,
    });

    res.status(201).json(await ordersService.getOrder(lodgeId, result.id));
  } catch (err) {
    next(err);
  }
}

async function updateStatusHandler(req, res, next) {
  try {
    const input = parse(updateStatusSchema, req.body);
    const order = await ordersService.updateStatus(req.user.lodgeId, Number(req.params.id), input.status, {
      cancelReason: input.cancelReason,
      userId: req.user.sub,
    });
    res.json({ order });
  } catch (err) {
    next(err);
  }
}

// The kitchen ticking a single dish off a ticket. Returns the whole order so
// the screen re-renders from the server's answer rather than guessing at what
// the tick did to the rest of the ticket.
async function updateItemReadyHandler(req, res, next) {
  try {
    const input = parse(updateItemReadySchema, req.body);
    const order = await ordersService.setItemReady(
      req.user.lodgeId,
      Number(req.params.id),
      Number(req.params.itemId),
      input.ready,
      { userId: req.user.sub }
    );
    res.json({ order });
  } catch (err) {
    next(err);
  }
}

// A guest who fumbles the PIN five times locks their own room out of ordering
// for fifteen minutes. They'll phone the desk about it, so reception needs to
// be able to clear it without waiting for the timer.
async function clearPinLockoutHandler(req, res, next) {
  try {
    const publicService = require('../public/public.service');
    await publicService.clearPinLockout(req.user.lodgeId, String(req.params.roomNumber || '').trim());
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listOrdersHandler,
  listQueueHandler,
  getOrderHandler,
  createCounterOrderHandler,
  roomOccupancyHandler,
  updateStatusHandler,
  updateItemReadyHandler,
  clearPinLockoutHandler,
};
