const pricingService = require('./pricing.service');
const { ApiError } = require('../../middleware/errorHandler');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// A quote is a counter conversation, not a yearly forecast. The cap keeps one
// mistyped year from fanning a request out into thousands of nights.
const MAX_NIGHTS = 365;

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function simulateHandler(req, res, next) {
  try {
    const roomId = Number(req.query.roomId);
    const date = String(req.query.date || '');
    const toDate = String(req.query.toDate || '');
    // "3,5:2" — one of charge 3, two of charge 5.
    const chargeIds = pricingService.parseChargeSelections(req.query.chargeIds);

    if (!roomId) {
      throw new ApiError('Choose a room.', 400);
    }
    if (!DATE_RE.test(date)) {
      throw new ApiError('Choose a from date.', 400);
    }
    // Omitting toDate quotes a single night, which is what the endpoint did
    // before it understood ranges.
    const checkOutDate = toDate ? toDate : addDays(date, 1);
    if (!DATE_RE.test(checkOutDate)) {
      throw new ApiError('Choose a to date.', 400);
    }
    if (checkOutDate <= date) {
      throw new ApiError('The to date must be after the from date.', 400);
    }
    const nights = Math.round((Date.parse(`${checkOutDate}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000);
    if (nights > MAX_NIGHTS) {
      throw new ApiError(`Quote up to ${MAX_NIGHTS} nights at a time.`, 400);
    }

    const result = await pricingService.simulateRange(
      req.user.lodgeId,
      roomId,
      date,
      checkOutDate,
      chargeIds
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { simulateHandler };
