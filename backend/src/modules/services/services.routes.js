const { Router } = require('express');
const { authenticate, requirePermission, requireCapability } = require('../../middleware/authenticate');
const {
  listServicesHandler,
  createServiceHandler,
  updateServiceHandler,
  listUsagesHandler,
  startUsageHandler,
  completeUsageHandler,
  cancelUsageHandler,
} = require('./services.controller');

const router = Router();

// Only properties with the add-on switched on (lodges.has_other_services).
const enabled = requireCapability('hasOtherServices');
// The catalogue is priced by whoever prices the rooms; running a use is front
// desk work, so reception and the billing desk can do it too.
const setup = requirePermission('rooms.manage');
const desk = requirePermission('bookings.manage', 'billing.manage', 'rooms.manage');

router.get('/', authenticate, enabled, desk, listServicesHandler);
router.post('/', authenticate, enabled, setup, createServiceHandler);

// Declared before /:id so "usages" isn't read as a service id.
router.get('/usages', authenticate, enabled, desk, listUsagesHandler);
router.post('/usages', authenticate, enabled, desk, startUsageHandler);
router.post('/usages/:id/complete', authenticate, enabled, desk, completeUsageHandler);
router.post('/usages/:id/cancel', authenticate, enabled, desk, cancelUsageHandler);

router.patch('/:id', authenticate, enabled, setup, updateServiceHandler);

module.exports = router;
