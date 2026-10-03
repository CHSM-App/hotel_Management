const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const {
  listSwitchableChargesHandler,
  createSwitchableChargeHandler,
  updateSwitchableChargeHandler,
  updateSwitchableChargeStatusHandler,
  deleteSwitchableChargeHandler,
} = require('./switchableCharges.controller');

const router = Router();

router.get('/', authenticate, requirePermission('rooms.manage', 'bookings.manage'), listSwitchableChargesHandler);
router.post('/', authenticate, requirePermission('rooms.manage'), createSwitchableChargeHandler);
router.patch('/:id', authenticate, requirePermission('rooms.manage'), updateSwitchableChargeHandler);
router.patch('/:id/status', authenticate, requirePermission('rooms.manage'), updateSwitchableChargeStatusHandler);
router.delete('/:id', authenticate, requirePermission('rooms.manage'), deleteSwitchableChargeHandler);

module.exports = router;
