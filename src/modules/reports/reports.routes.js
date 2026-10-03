const { Router } = require('express');
const { authenticate, requirePermission, requireCapability } = require('../../middleware/authenticate');
const {
  getOccupancyHandler,
  getGstSummaryHandler,
  getBookingsReportHandler,
  getEventsReportHandler,
  getFoodOrdersReportHandler,
  getServicesReportHandler,
  getAnalyticsOverviewHandler,
  getRoomsAnalyticsHandler,
  getProfitLossHandler,
  getProfitLossHistoryHandler,
} = require('./reports.controller');

const router = Router();

// Financial and property-wide reports — owner only, same scope as Staff & roles.
const owner = requirePermission('reports.view');
// P&L combines expense/income category detail that expenses.manage and
// income.manage individually gate elsewhere — reports.view alone would let
// someone see that detail through this tab despite being denied the
// sections it comes from. profitLoss.view is required on top of it, not
// instead of it, so a role still needs Reports access at all first.
const profitLossGate = [authenticate, owner, requirePermission('profitLoss.view')];

router.get('/occupancy', authenticate, owner, getOccupancyHandler);
router.get('/gst-summary', authenticate, owner, getGstSummaryHandler);
router.get('/bookings', authenticate, owner, getBookingsReportHandler);
router.get('/events', authenticate, owner, getEventsReportHandler);
router.get('/food-orders', authenticate, owner, getFoodOrdersReportHandler);
router.get('/services', authenticate, requireCapability('hasOtherServices'), owner, getServicesReportHandler);
router.get('/analytics-overview', authenticate, owner, getAnalyticsOverviewHandler);
router.get('/rooms-analytics', authenticate, owner, getRoomsAnalyticsHandler);
router.get('/profit-loss', ...profitLossGate, getProfitLossHandler);
router.get('/profit-loss-history', ...profitLossGate, getProfitLossHistoryHandler);

module.exports = router;
