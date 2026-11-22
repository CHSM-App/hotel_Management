const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const {
  listTablesHandler,
  listCustomersHandler,
  createTableHandler,
  bulkCreateTablesHandler,
  updateTableHandler,
  updateTableStatusHandler,
  regenerateQrHandler,
  deleteTableHandler,
} = require('./tables.controller');

const router = Router();

// Reception or a captain picks a table when typing in a counter order, so
// listing takes any of the three; everything that changes the floor plan is
// food.manage.
router.get('/', authenticate, requirePermission('food.manage', 'orders.manage', 'orders.take', 'bar.manage'), listTablesHandler);

// Open customers per table, for the order forms (restaurant and bar).
router.get('/customers', authenticate, requirePermission('food.manage', 'orders.manage', 'orders.take', 'bar.manage', 'bar.take', 'bar.bill'), listCustomersHandler);

router.post('/', authenticate, requirePermission('food.manage', 'bar.manage'), createTableHandler);
router.post('/bulk', authenticate, requirePermission('food.manage', 'bar.manage'), bulkCreateTablesHandler);
router.patch('/:id', authenticate, requirePermission('food.manage', 'bar.manage'), updateTableHandler);
router.patch('/:id/status', authenticate, requirePermission('food.manage', 'bar.manage'), updateTableStatusHandler);
router.post('/:id/regenerate-qr', authenticate, requirePermission('food.manage', 'bar.manage'), regenerateQrHandler);
router.delete('/:id', authenticate, requirePermission('food.manage', 'bar.manage'), deleteTableHandler);

module.exports = router;
