const fs = require('fs');
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

// A service photo that arrived on a request that then failed. Multer has
// already written it to disk by the time the handler runs, so a rejected
// save would otherwise leave the file behind with nothing pointing at it.
function discardUpload(req) {
  if (req.file) fs.unlink(req.file.path, () => {});
}

module.exports = {
  listServicesHandler: handle(async (req, res) =>
    res.json({ services: await servicesService.listServices(lodgeOf(req), { includeInactive: req.query.includeInactive === 'true' }) })
  ),
  createServiceHandler: async (req, res, next) => {
    try {
      const service = await servicesService.createService(lodgeOf(req), {
        ...parse(serviceSchema, req.body),
        imageFilename: req.file ? req.file.filename : null,
      });
      res.status(201).json({ service });
    } catch (err) {
      discardUpload(req);
      next(err);
    }
  },
  updateServiceHandler: async (req, res, next) => {
    try {
      const service = await servicesService.updateService(lodgeOf(req), idOf(req), {
        ...parse(updateServiceSchema, req.body),
        imageFilename: req.file ? req.file.filename : null,
      });
      res.json({ service });
    } catch (err) {
      discardUpload(req);
      next(err);
    }
  },
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
