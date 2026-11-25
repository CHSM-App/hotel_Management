const service = require('./quotations.service');
const { createQuotationSchema, updateQuotationSchema } = require('./quotations.schema');
const { ApiError } = require('../../middleware/errorHandler');

function parse(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(parsed.error.issues[0].message, 400);
  return parsed.data;
}

const idOf = (req) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError('Quotation not found.', 404);
  return id;
};

async function createHandler(req, res, next) {
  try {
    const data = parse(createQuotationSchema, req.body);
    service.assertKindAllowed(req.permissions, data.kind);
    res.status(201).json(await service.createQuotation(req.user.lodgeId, req.user.sub, data));
  } catch (err) {
    next(err);
  }
}

async function listHandler(req, res, next) {
  try {
    res.json(await service.listQuotations(req.user.lodgeId, { state: req.query.state, q: req.query.q, kind: req.query.kind, kinds: service.allowedKinds(req.permissions) }));
  } catch (err) {
    next(err);
  }
}

async function getHandler(req, res, next) {
  try {
    res.json(await service.getQuotation(req.user.lodgeId, idOf(req), req.permissions));
  } catch (err) {
    next(err);
  }
}

async function updateHandler(req, res, next) {
  try {
    const data = parse(updateQuotationSchema, req.body);
    res.json(await service.updateQuotation(req.user.lodgeId, idOf(req), data, req.permissions));
  } catch (err) {
    next(err);
  }
}

async function shareHandler(req, res, next) {
  try {
    res.json(await service.shareQuotation(req.user.lodgeId, idOf(req), req.file, req.permissions));
  } catch (err) {
    next(err);
  }
}

async function shareWhatsAppHandler(req, res, next) {
  try {
    res.json(
      await service.sendQuotationOnWhatsApp(req.user.lodgeId, req.user.sub, idOf(req), { file: req.file, phone: req.body?.phone }, req.permissions)
    );
  } catch (err) {
    next(err);
  }
}

async function deleteHandler(req, res, next) {
  try {
    res.json(await service.deleteQuotation(req.user.lodgeId, idOf(req), req.permissions));
  } catch (err) {
    next(err);
  }
}

module.exports = { createHandler, listHandler, getHandler, updateHandler, deleteHandler, shareHandler, shareWhatsAppHandler };
