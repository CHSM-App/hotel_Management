const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const {
  listCustomersHandler,
  listFeedbackHandler,
  getCustomerHandler,
  createCustomerHandler,
  updateCustomerHandler,
} = require('./customers.controller');

const router = Router();

const canManage = requirePermission('customers.manage');

router.get('/', authenticate, canManage, listCustomersHandler);
// Before /:id — otherwise Express reads "feedback" as a customer id and this
// route is never reached.
router.get('/feedback', authenticate, canManage, listFeedbackHandler);
router.get('/:id', authenticate, canManage, getCustomerHandler);
router.post('/', authenticate, canManage, createCustomerHandler);
router.patch('/:id', authenticate, canManage, updateCustomerHandler);

module.exports = router;
