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
  listBedsHandler,
  createBedHandler,
  updateBedHandler,
  deleteBedHandler,
  setBedCountHandler,
} = require('./rooms.controller');

const router = Router();

// Rooms & rates, plus orders.take — a captain placing a room order needs the
// room list to populate the picker, same as the counter-order form's table list.
router.get('/', authenticate, requirePermission('rooms.manage', 'orders.take'), listRoomsHandler);

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

// Bed CRUD for a dormitory room. Readable by anyone who can book (the
// booking form needs bed labels), writable only by rooms.manage.
router.get('/:id/beds', authenticate, requirePermission('rooms.manage', 'bookings.manage'), listBedsHandler);
router.post('/:id/beds', authenticate, requirePermission('rooms.manage'), createBedHandler);
router.patch('/:id/beds/:bedId', authenticate, requirePermission('rooms.manage'), updateBedHandler);
router.delete('/:id/beds/:bedId', authenticate, requirePermission('rooms.manage'), deleteBedHandler);
// The desk's actual entry point: "this room has N beds" rather than adding
// them one at a time — reconciles the room's beds to that count.
router.put('/:id/beds/count', authenticate, requirePermission('rooms.manage'), setBedCountHandler);

router.delete('/:id', authenticate, requirePermission('rooms.manage'), deleteRoomHandler);

module.exports = router;
