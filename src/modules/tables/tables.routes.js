const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const {
  listTablesHandler,
  createTableHandler,
  bulkCreateTablesHandler,
  updateTableHandler,
  updateTableStatusHandler,
  regenerateQrHandler,
  deleteTableHandler,
} = require('./tables.controller');

const router = Router();

// Reception picks a table when typing in a counter order, so listing takes
// either permission; everything that changes the floor plan is food.manage.
router.get('/', authenticate, requirePermission('food.manage', 'orders.manage'), listTablesHandler);

router.post('/', authenticate, requirePermission('food.manage'), createTableHandler);
router.post('/bulk', authenticate, requirePermission('food.manage'), bulkCreateTablesHandler);
router.patch('/:id', authenticate, requirePermission('food.manage'), updateTableHandler);
router.patch('/:id/status', authenticate, requirePermission('food.manage'), updateTableStatusHandler);
router.post('/:id/regenerate-qr', authenticate, requirePermission('food.manage'), regenerateQrHandler);
router.delete('/:id', authenticate, requirePermission('food.manage'), deleteTableHandler);

module.exports = router;
