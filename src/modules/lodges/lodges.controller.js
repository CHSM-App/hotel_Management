const { createLodgeSchema } = require('./lodges.schema');
const lodgesService = require('./lodges.service');
const { ApiError } = require('../../middleware/errorHandler');

async function createLodgeHandler(req, res, next) {
  try {
    const parsed = createLodgeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }

    const result = await lodgesService.createLodgeWithOwner(parsed.data);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function listLodgesHandler(req, res, next) {
  try {
    const lodges = await lodgesService.listLodges();
    res.json({ lodges });
  } catch (err) {
    next(err);
  }
}

async function getLodgeHandler(req, res, next) {
  try {
    // A non-numeric :id would reach SQL Server as a failed BigInt conversion
    // (a 500) rather than the "no such lodge" this actually is.
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError('Lodge not found.', 404);
    }

    const detail = await lodgesService.getLodgeDetail(id);
    res.json(detail);
  } catch (err) {
    next(err);
  }
}

module.exports = { createLodgeHandler, listLodgesHandler, getLodgeHandler };
