const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const { roomImageUpload } = require('../../middleware/roomImageUpload');
const {
  listRoomsHandler,
  getCheckoutPolicyHandler,
  updateCheckoutPolicyHandler,
  createRoomHandler,
  updateRoomHandler,
  updateRoomStatusHandler,
  deleteRoomHandler,
  deleteRoomImageHandler,
} = require('./rooms.controller');

const router = Router();

// Owner only — matches the "Rooms & rates" feature scope on the dashboard.
router.get('/', authenticate, requirePermission('rooms.manage'), listRoomsHandler);

// Declared before /:id so "checkout-policy" isn't swallowed as a room id.
// Readable by anyone who works the desk, because the checkout dialog quotes the
// policy back at them; only rooms.manage can change it.
router.get(
  '/checkout-policy',
  authenticate,
  requirePermission('rooms.manage', 'bookings.manage'),
  getCheckoutPolicyHandler
);
router.patch(
  '/checkout-policy',
  authenticate,
  requirePermission('rooms.manage'),
  updateCheckoutPolicyHandler
);

router.post('/', authenticate, requirePermission('rooms.manage'), roomImageUpload, createRoomHandler);
router.patch('/:id', authenticate, requirePermission('rooms.manage'), roomImageUpload, updateRoomHandler);
router.patch('/:id/status', authenticate, requirePermission('rooms.manage'), updateRoomStatusHandler);
router.delete('/:id/images/:imageId', authenticate, requirePermission('rooms.manage'), deleteRoomImageHandler);
router.delete('/:id', authenticate, requirePermission('rooms.manage'), deleteRoomHandler);

module.exports = router;
