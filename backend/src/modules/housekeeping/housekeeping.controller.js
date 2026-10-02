const schemas = require('./housekeeping.schema');
const service = require('./housekeeping.service');
const { ApiError } = require('../../middleware/errorHandler');

function parse(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(parsed.error.issues[0].message, 400);
  return parsed.data;
}

// One wrapper instead of a try/catch per handler.
const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    next(err);
  }
};

const lodgeOf = (req) => req.user.lodgeId;
const userOf = (req) => req.user.sub;
const idOf = (req) => Number(req.params.id);
const done = (res) => res.json({ ok: true });

module.exports = {
  listRooms: handle(async (req, res) => res.json({ rooms: await service.listRooms(lodgeOf(req)) })),
  startCleaning: handle(async (req, res) => (await service.startCleaning(lodgeOf(req), userOf(req), idOf(req)), done(res))),
  releaseRoom: handle(async (req, res) => (await service.releaseRoom(lodgeOf(req), idOf(req)), done(res))),
  finishCleaning: handle(async (req, res) => {
    await service.finishCleaning(lodgeOf(req), userOf(req), idOf(req), parse(schemas.finishCleaningSchema, req.body));
    done(res);
  }),
  markDirty: handle(async (req, res) => (await service.markDirty(lodgeOf(req), idOf(req)), done(res))),
  setOutOfOrder: handle(async (req, res) => {
    await service.setOutOfOrder(lodgeOf(req), idOf(req), parse(schemas.outOfOrderSchema, req.body));
    done(res);
  }),

  listLinen: handle(async (req, res) =>
    res.json({ items: await service.listLinen(lodgeOf(req)), movements: await service.listLinenMovements(lodgeOf(req)) })
  ),
  createLinenItem: handle(async (req, res) => {
    await service.createLinenItem(lodgeOf(req), parse(schemas.linenItemSchema, req.body));
    res.status(201).json({ ok: true });
  }),
  updateLinenItem: handle(async (req, res) => {
    await service.updateLinenItem(lodgeOf(req), idOf(req), parse(schemas.updateLinenItemSchema, req.body));
    done(res);
  }),
  sendToLaundry: handle(async (req, res) => {
    await service.sendToLaundry(lodgeOf(req), userOf(req), parse(schemas.sendSchema, req.body));
    done(res);
  }),
  receiveFromLaundry: handle(async (req, res) => {
    await service.receiveFromLaundry(lodgeOf(req), userOf(req), parse(schemas.receiveSchema, req.body));
    done(res);
  }),
  recordLoss: handle(async (req, res) => {
    await service.recordLoss(lodgeOf(req), userOf(req), parse(schemas.lossSchema, req.body));
    done(res);
  }),

  listRecentGarments: handle(async (req, res) => res.json({ garments: await service.listRecentGarments(lodgeOf(req)) })),
  listInHouse: handle(async (req, res) => res.json({ guests: await service.listInHouse(lodgeOf(req)) })),
  listLaundryOrders: handle(async (req, res) =>
    res.json({ orders: await service.listLaundryOrders(lodgeOf(req), req.query.scope) })
  ),
  createLaundryOrder: handle(async (req, res) =>
    res.status(201).json({ order: await service.createLaundryOrder(lodgeOf(req), userOf(req), parse(schemas.laundryOrderSchema, req.body)) })
  ),
  setLaundryStatus: handle(async (req, res) =>
    res.json({ order: await service.setLaundryStatus(lodgeOf(req), userOf(req), idOf(req), parse(schemas.laundryStatusSchema, req.body).status) })
  ),
};
