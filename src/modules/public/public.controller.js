const { z } = require('zod');
const publicService = require('./public.service');
const { orderItemsSchema } = require('../orders/orders.schema');
const { ApiError } = require('../../middleware/errorHandler');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const guestFields = {
  guestName: z.string().trim().max(200).optional().default(''),
  guestPhone: z.string().trim().max(20).optional().default(''),
  note: z.string().trim().max(300).optional().default(''),
  items: orderItemsSchema,
};

// roomNumber moved out of the URL and into the body when ordering went to a
// single link — the room is something the guest asserts, alongside the PIN that
// backs the assertion, not something the address identifies.
const roomIdentity = {
  roomNumber: z.string().trim().min(1, 'Enter your room number.').max(20),
  pin: z.string().trim().min(1, 'Enter the PIN reception gave you.'),
};

const roomOrderSchema = z.object({ ...guestFields, ...roomIdentity });

// Sign-in, and reading back the guest's own orders. Both carry the identity and
// nothing else.
const roomIdentitySchema = z.object(roomIdentity);

const editOrderSchema = z.object({ ...guestFields, ...roomIdentity });

const tableOrderSchema = z.object(guestFields);

function parse(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0].message, 400);
  }
  return parsed.data;
}

async function getLodgePageHandler(req, res, next) {
  try {
    const lodge = await publicService.getLodgeBySlug(String(req.params.slug || ''));

    const checkInDate = String(req.query.checkInDate || '');
    const checkOutDate = String(req.query.checkOutDate || '');
    // Malformed or missing dates just fall back to the plain rate-card view
    // (no availability column) rather than erroring the whole page.
    const hasValidRange =
      DATE_RE.test(checkInDate) && DATE_RE.test(checkOutDate) && checkOutDate > checkInDate;

    const roomTypes = lodge.hasRooms
      ? await publicService.listPublicRoomTypes(
          lodge.id,
          hasValidRange ? checkInDate : null,
          hasValidRange ? checkOutDate : null
        )
      : [];
    res.json({ lodge, roomTypes });
  } catch (err) {
    next(err);
  }
}

// The single ordering page for the whole property.
async function getMenuPageHandler(req, res, next) {
  try {
    const context = await publicService.getLodgeOrderingContext(String(req.params.slug || ''));
    res.json(context);
  } catch (err) {
    next(err);
  }
}

async function getTableOrderPageHandler(req, res, next) {
  try {
    const context = await publicService.getTableOrderingContext(String(req.params.token || ''));
    res.json(context);
  } catch (err) {
    next(err);
  }
}

async function placeRoomOrderHandler(req, res, next) {
  try {
    const input = parse(roomOrderSchema, req.body);
    const result = await publicService.placeRoomOrder(
      String(req.params.slug || ''),
      input.roomNumber,
      input
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function openSessionHandler(req, res, next) {
  try {
    const input = parse(roomIdentitySchema, req.body);
    const session = await publicService.openGuestSession(
      String(req.params.slug || ''),
      input.roomNumber,
      input.pin
    );
    res.json(session);
  } catch (err) {
    next(err);
  }
}

// A read, sent as a POST, because what authorises it is a secret — and a secret
// in a query string is a secret in the browser history, in the proxy log and in
// the referrer of the next image the page loads.
async function listGuestOrdersHandler(req, res, next) {
  try {
    const input = parse(roomIdentitySchema, req.body);
    const result = await publicService.listGuestOrders(
      String(req.params.slug || ''),
      input.roomNumber,
      input.pin
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function updateGuestOrderHandler(req, res, next) {
  try {
    const input = parse(editOrderSchema, req.body);
    const result = await publicService.updateGuestOrder(
      String(req.params.slug || ''),
      input.roomNumber,
      input.pin,
      String(req.params.token || ''),
      input
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function cancelGuestOrderHandler(req, res, next) {
  try {
    const input = parse(roomIdentitySchema, req.body);
    const result = await publicService.cancelGuestOrder(
      String(req.params.slug || ''),
      input.roomNumber,
      input.pin,
      String(req.params.token || '')
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function placeTableOrderHandler(req, res, next) {
  try {
    const input = parse(tableOrderSchema, req.body);
    const result = await publicService.placeTableOrder(String(req.params.token || ''), input);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function getOrderStatusHandler(req, res, next) {
  try {
    const status = await publicService.getPublicOrderStatus(String(req.params.token || ''));
    res.json(status);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getLodgePageHandler,
  getMenuPageHandler,
  getTableOrderPageHandler,
  openSessionHandler,
  listGuestOrdersHandler,
  updateGuestOrderHandler,
  cancelGuestOrderHandler,
  placeRoomOrderHandler,
  placeTableOrderHandler,
  getOrderStatusHandler,
};
