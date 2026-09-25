const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const {
  listOrdersHandler,
  listQueueHandler,
  getOrderHandler,
  createCounterOrderHandler,
  updateStatusHandler,
  updateItemReadyHandler,
  clearPinLockoutHandler,
  roomOccupancyHandler,
} = require('./orders.controller');

const router = Router();

// Clearing a PIN lockout is front-desk work, not kitchen work — the guest is
// standing at the counter unable to order. Takes bookings.manage as well so
// reception can do it without holding the kitchen permission.
router.delete(
  '/pin-lockouts/:roomNumber',
  authenticate,
  requirePermission('orders.manage', 'orders.take', 'bookings.manage'),
  clearPinLockoutHandler
);

// /queue is declared before /:id so "queue" isn't swallowed as an order id.
// Kitchen work only — the captain taking an order never needs the queue.
router.get('/queue', authenticate, requirePermission('orders.manage'), listQueueHandler);

// Looking up who's in a room is how a captain places a room order, so it
// takes orders.take as well as the kitchen's orders.manage.
router.get(
  '/room-occupancy/:roomId',
  authenticate,
  requirePermission('orders.manage', 'orders.take'),
  roomOccupancyHandler
);
// Kitchen sees the whole day; a captain sees only their own orders — the
// handler itself does that narrowing once it knows which permission got them
// in the door.
router.get('/', authenticate, requirePermission('orders.manage', 'orders.take'), listOrdersHandler);
router.get('/:id', authenticate, requirePermission('orders.manage'), getOrderHandler);
router.post('/', authenticate, requirePermission('orders.manage', 'orders.take'), createCounterOrderHandler);
router.patch('/:id/status', authenticate, requirePermission('orders.manage'), updateStatusHandler);
router.patch(
  '/:id/items/:itemId/ready',
  authenticate,
  requirePermission('orders.manage'),
  updateItemReadyHandler
);

module.exports = router;
