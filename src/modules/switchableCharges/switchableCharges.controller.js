const {
  createSwitchableChargeSchema,
  updateSwitchableChargeSchema,
  statusSchema,
} = require('./switchableCharges.schema');
const switchableChargesService = require('./switchableCharges.service');
const { ApiError } = require('../../middleware/errorHandler');

async function listSwitchableChargesHandler(req, res, next) {
  try {
    const switchableCharges = await switchableChargesService.listSwitchableCharges(req.user.lodgeId);
    res.json({ switchableCharges });
  } catch (err) {
    next(err);
  }
}

async function createSwitchableChargeHandler(req, res, next) {
  try {
    const parsed = createSwitchableChargeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }

    const result = await switchableChargesService.createSwitchableCharge(req.user.lodgeId, parsed.data);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function updateSwitchableChargeHandler(req, res, next) {
  try {
    const parsed = updateSwitchableChargeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }

    const result = await switchableChargesService.updateSwitchableCharge(
      req.user.lodgeId,
      Number(req.params.id),
      parsed.data
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function updateSwitchableChargeStatusHandler(req, res, next) {
  try {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }

    const result = await switchableChargesService.setSwitchableChargeActive(
      req.user.lodgeId,
      Number(req.params.id),
      parsed.data.isActive
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function deleteSwitchableChargeHandler(req, res, next) {
  try {
    await switchableChargesService.deleteSwitchableCharge(req.user.lodgeId, Number(req.params.id));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listSwitchableChargesHandler,
  createSwitchableChargeHandler,
  updateSwitchableChargeHandler,
  updateSwitchableChargeStatusHandler,
  deleteSwitchableChargeHandler,
};
