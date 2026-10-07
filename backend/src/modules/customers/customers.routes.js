const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const {
  listCustomersHandler,
  getCustomerHandler,
  createCustomerHandler,
  updateCustomerHandler,
} = require('./customers.controller');

const router = Router();

const canManage = requirePermission('customers.manage');

router.get('/', authenticate, canManage, listCustomersHandler);
router.get('/:id', authenticate, canManage, getCustomerHandler);
router.post('/', authenticate, canManage, createCustomerHandler);
router.patch('/:id', authenticate, canManage, updateCustomerHandler);

module.exports = router;
