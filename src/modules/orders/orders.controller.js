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
      source = 'ROOM';
      roomId = input.roomId;
      bookingId = await resolveRoomBooking(lodgeId, input.roomId);
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
  updateStatusHandler,
  updateItemReadyHandler,
  clearPinLockoutHandler,
};
