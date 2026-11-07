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

  listVenues: handle(async (req, res) => res.json({ venues: await service.listVenues(lodgeOf(req)) })),
  startVenueCleaning: handle(async (req, res) => (await service.startVenueCleaning(lodgeOf(req), userOf(req), idOf(req)), done(res))),
  releaseVenue: handle(async (req, res) => (await service.releaseVenue(lodgeOf(req), idOf(req)), done(res))),
  finishVenueCleaning: handle(async (req, res) => {
    await service.finishVenueCleaning(lodgeOf(req), userOf(req), idOf(req), parse(schemas.finishCleaningSchema, req.body));
    done(res);
  }),
  markVenueDirty: handle(async (req, res) => (await service.markVenueDirty(lodgeOf(req), idOf(req)), done(res))),
  setVenueOutOfOrder: handle(async (req, res) => {
    await service.setVenueOutOfOrder(lodgeOf(req), idOf(req), parse(schemas.outOfOrderSchema, req.body));
    done(res);
  }),

  listIssues: handle(async (req, res) => res.json({ issues: await service.listIssues(lodgeOf(req), req.query.scope) })),
  openIssueSummary: handle(async (req, res) => res.json(await service.openIssueSummary(lodgeOf(req)))),
  closeIssue: handle(async (req, res) =>
    res.json(await service.closeIssue(lodgeOf(req), userOf(req), idOf(req), parse(schemas.closeIssueSchema, req.body)))
  ),

  listLinen: handle(async (req, res) =>
    res.json({
      items: await service.listLinen(lodgeOf(req)),
      // True where linen is registered in Asset Inventory and only read here.
      managedInAssets: await service.linenManagedInAssets(lodgeOf(req)),
      movements: await service.listLinenMovements(lodgeOf(req)),
      handovers: await service.listHandovers(lodgeOf(req)),
      lastWashedBy: await service.lastWashedBy(lodgeOf(req)),
    })
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
  receiveHandovers: handle(async (req, res) => {
    await service.receiveHandovers(lodgeOf(req), userOf(req), parse(schemas.receiveHandoverSchema, req.body).movementIds);
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
    res.json({ order: await service.setLaundryStatus(lodgeOf(req), userOf(req), idOf(req), parse(schemas.laundryStatusSchema, req.body)) })
  ),
};
