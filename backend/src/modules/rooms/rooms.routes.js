const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const { roomImageUpload } = require('../../middleware/roomImageUpload');
const {
  listRoomsHandler,
  createRoomHandler,
  updateRoomHandler,
  updateRoomStatusHandler,
  deleteRoomHandler,
  deleteRoomImageHandler,
} = require('./rooms.controller');

const router = Router();

// Owner only — matches the "Rooms & rates" feature scope on the dashboard.
router.get('/', authenticate, requirePermission('rooms.manage'), listRoomsHandler);
router.post('/', authenticate, requirePermission('rooms.manage'), roomImageUpload, createRoomHandler);
router.patch('/:id', authenticate, requirePermission('rooms.manage'), roomImageUpload, updateRoomHandler);
router.patch('/:id/status', authenticate, requirePermission('rooms.manage'), updateRoomStatusHandler);
router.delete('/:id/images/:imageId', authenticate, requirePermission('rooms.manage'), deleteRoomImageHandler);
router.delete('/:id', authenticate, requirePermission('rooms.manage'), deleteRoomHandler);

module.exports = router;
