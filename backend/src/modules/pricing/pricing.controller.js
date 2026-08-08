const pricingService = require('./pricing.service');
const { ApiError } = require('../../middleware/errorHandler');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function simulateHandler(req, res, next) {
  try {
    const roomId = Number(req.query.roomId);
    const date = String(req.query.date || '');
    const chargeIds = String(req.query.chargeIds || '')
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isInteger(id) && id > 0);

    if (!roomId) {
      throw new ApiError('Choose a room.', 400);
    }
    if (!DATE_RE.test(date)) {
      throw new ApiError('Choose a date.', 400);
    }

    const result = await pricingService.simulate(req.user.lodgeId, roomId, date, chargeIds);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { simulateHandler };
