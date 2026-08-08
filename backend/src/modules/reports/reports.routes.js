const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const { getOccupancyHandler, getGstSummaryHandler } = require('./reports.controller');

const router = Router();

// Financial and property-wide reports — owner only, same scope as Staff & roles.
const owner = requirePermission('reports.view');

router.get('/occupancy', authenticate, owner, getOccupancyHandler);
router.get('/gst-summary', authenticate, owner, getGstSummaryHandler);

module.exports = router;
