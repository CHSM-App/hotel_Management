const reportsService = require('./reports.service');
const { ApiError } = require('../../middleware/errorHandler');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

function parseDateRange(query) {
  const fromDate = String(query.fromDate || '');
  const toDate = String(query.toDate || '');
  if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate) || toDate < fromDate) {
    throw new ApiError('Choose a valid date range.', 400);
  }
  const days = Math.round((new Date(`${toDate}T00:00:00Z`) - new Date(`${fromDate}T00:00:00Z`)) / 86400000) + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new ApiError('Choose a date range of one year or less.', 400);
  }
  return { fromDate, toDate };
}

async function getOccupancyHandler(req, res, next) {
  try {
    const { fromDate, toDate } = parseDateRange(req.query);
    const report = await reportsService.getOccupancyReport(req.user.lodgeId, fromDate, toDate);
    res.json(report);
  } catch (err) {
    next(err);
  }
}

async function getGstSummaryHandler(req, res, next) {
  try {
    const { fromDate, toDate } = parseDateRange(req.query);
    const report = await reportsService.getGstSummary(req.user.lodgeId, fromDate, toDate);
    res.json(report);
  } catch (err) {
    next(err);
  }
}

// Which side of the book to report on. Validated against a fixed set rather
// than passed through — it reaches the query as a filter value.
const BILLING_SIDES = ['ALL', 'GST', 'NON_GST'];

async function getBookingsReportHandler(req, res, next) {
  try {
    const { fromDate, toDate } = parseDateRange(req.query);
    const billingSide = String(req.query.billingSide || 'ALL').toUpperCase();
    if (!BILLING_SIDES.includes(billingSide)) {
      throw new ApiError('Choose GST, non-GST, or all bills.', 400);
    }
    const report = await reportsService.getBookingsReport(
      req.user.lodgeId,
      fromDate,
      toDate,
      billingSide
    );
    res.json(report);
  } catch (err) {
    next(err);
  }
}

module.exports = { getOccupancyHandler, getGstSummaryHandler, getBookingsReportHandler };
