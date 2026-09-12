const {
  createTableSchema,
  updateTableSchema,
  bulkCreateTableSchema,
  statusSchema,
} = require('./tables.schema');
const tablesService = require('./tables.service');
const { ApiError } = require('../../middleware/errorHandler');

function parse(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0].message, 400);
  }
  return parsed.data;
}

async function listTablesHandler(req, res, next) {
  try {
    const tables = await tablesService.listTables(req.user.lodgeId);
    res.json({ tables });
  } catch (err) {
    next(err);
  }
}

async function createTableHandler(req, res, next) {
  try {
    const result = await tablesService.createTable(req.user.lodgeId, parse(createTableSchema, req.body));
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function bulkCreateTablesHandler(req, res, next) {
  try {
    const result = await tablesService.bulkCreateTables(req.user.lodgeId, parse(bulkCreateTableSchema, req.body));
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function updateTableHandler(req, res, next) {
  try {
    const result = await tablesService.updateTable(
      req.user.lodgeId,
      Number(req.params.id),
      parse(updateTableSchema, req.body)
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function updateTableStatusHandler(req, res, next) {
  try {
    const { isActive } = parse(statusSchema, req.body);
    const result = await tablesService.setTableActive(req.user.lodgeId, Number(req.params.id), isActive);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function regenerateQrHandler(req, res, next) {
  try {
    const result = await tablesService.regenerateQrToken(req.user.lodgeId, Number(req.params.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function deleteTableHandler(req, res, next) {
  try {
    await tablesService.deleteTable(req.user.lodgeId, Number(req.params.id));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listTablesHandler,
  createTableHandler,
  bulkCreateTablesHandler,
  updateTableHandler,
  updateTableStatusHandler,
  regenerateQrHandler,
  deleteTableHandler,
};
