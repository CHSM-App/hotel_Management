const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const {
  getOccupancyHandler,
  getGstSummaryHandler,
  getBookingsReportHandler,
  getEventsReportHandler,
  getFoodOrdersReportHandler,
  getAnalyticsOverviewHandler,
  getRoomsAnalyticsHandler,
} = require('./reports.controller');

const router = Router();

// Financial and property-wide reports — owner only, same scope as Staff & roles.
const owner = requirePermission('reports.view');

router.get('/occupancy', authenticate, owner, getOccupancyHandler);
router.get('/gst-summary', authenticate, owner, getGstSummaryHandler);
router.get('/bookings', authenticate, owner, getBookingsReportHandler);
router.get('/events', authenticate, owner, getEventsReportHandler);
router.get('/food-orders', authenticate, owner, getFoodOrdersReportHandler);
router.get('/analytics-overview', authenticate, owner, getAnalyticsOverviewHandler);
router.get('/rooms-analytics', authenticate, owner, getRoomsAnalyticsHandler);

module.exports = router;
