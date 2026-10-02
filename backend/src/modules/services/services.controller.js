const { serviceSchema, updateServiceSchema, startUsageSchema } = require('./services.schema');
const servicesService = require('./services.service');
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
const idOf = (req) => Number(req.params.id);

module.exports = {
  listServicesHandler: handle(async (req, res) =>
    res.json({ services: await servicesService.listServices(lodgeOf(req), { includeInactive: req.query.includeInactive === 'true' }) })
  ),
  createServiceHandler: handle(async (req, res) =>
    res.status(201).json({ service: await servicesService.createService(lodgeOf(req), parse(serviceSchema, req.body)) })
  ),
  updateServiceHandler: handle(async (req, res) =>
    res.json({ service: await servicesService.updateService(lodgeOf(req), idOf(req), parse(updateServiceSchema, req.body)) })
  ),
  listUsagesHandler: handle(async (req, res) =>
    res.json({ usages: await servicesService.listUsages(lodgeOf(req), req.query.status) })
  ),
  startUsageHandler: handle(async (req, res) =>
    res.status(201).json({ usage: await servicesService.startUsage(lodgeOf(req), req.user.sub, parse(startUsageSchema, req.body)) })
  ),
  completeUsageHandler: handle(async (req, res) =>
    res.json({ usage: await servicesService.completeUsage(lodgeOf(req), idOf(req)) })
  ),
  cancelUsageHandler: handle(async (req, res) =>
    res.json({ usage: await servicesService.cancelUsage(lodgeOf(req), idOf(req)) })
  ),
};
