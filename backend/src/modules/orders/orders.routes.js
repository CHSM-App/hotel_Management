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
} = require('./orders.controller');

const router = Router();

// Clearing a PIN lockout is front-desk work, not kitchen work — the guest is
// standing at the counter unable to order. Takes bookings.manage as well so
// reception can do it without holding the kitchen permission.
router.delete(
  '/pin-lockouts/:roomNumber',
  authenticate,
  requirePermission('orders.manage', 'bookings.manage'),
  clearPinLockoutHandler
);

// /queue is declared before /:id so "queue" isn't swallowed as an order id.
router.get('/queue', authenticate, requirePermission('orders.manage'), listQueueHandler);
router.get('/', authenticate, requirePermission('orders.manage'), listOrdersHandler);
router.get('/:id', authenticate, requirePermission('orders.manage'), getOrderHandler);
router.post('/', authenticate, requirePermission('orders.manage'), createCounterOrderHandler);
router.patch('/:id/status', authenticate, requirePermission('orders.manage'), updateStatusHandler);
router.patch(
  '/:id/items/:itemId/ready',
  authenticate,
  requirePermission('orders.manage'),
  updateItemReadyHandler
);

module.exports = router;
