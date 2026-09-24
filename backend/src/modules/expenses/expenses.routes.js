const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const { expenseBillUpload } = require('../../middleware/expenseBillUpload');
const {
  listCategoriesHandler,
  createCategoryHandler,
  updateCategoryHandler,
  listVendorsHandler,
  createVendorHandler,
  updateVendorHandler,
  listExpensesHandler,
  getExpenseHandler,
  createExpenseHandler,
  updateExpenseHandler,
  deleteExpenseHandler,
  listPaymentsHandler,
  addPaymentHandler,
  deletePaymentHandler,
  getExpenseBillHandler,
  getSummaryHandler,
  listTemplatesHandler,
  createTemplateHandler,
  updateTemplateHandler,
  logOccurrenceHandler,
} = require('./expenses.controller');

const router = Router();

// One permission for the whole module, same simplicity level as
// assets.manage — expenses don't yet need a separate viewer role.
const canAccess = requirePermission('expenses.manage');

router.get('/categories', authenticate, canAccess, listCategoriesHandler);
router.post('/categories', authenticate, canAccess, createCategoryHandler);
router.patch('/categories/:id', authenticate, canAccess, updateCategoryHandler);

router.get('/vendors', authenticate, canAccess, listVendorsHandler);
router.post('/vendors', authenticate, canAccess, createVendorHandler);
router.patch('/vendors/:id', authenticate, canAccess, updateVendorHandler);

router.get('/summary', authenticate, canAccess, getSummaryHandler);

router.get('/recurring', authenticate, canAccess, listTemplatesHandler);
router.post('/recurring', authenticate, canAccess, createTemplateHandler);
router.patch('/recurring/:id', authenticate, canAccess, updateTemplateHandler);
// "Log this month" — one occurrence, entered by hand with its own
// amount/vendor/payment, not a scheduled generator.
router.post('/recurring/:id/log', authenticate, canAccess, expenseBillUpload, logOccurrenceHandler);

router.get('/', authenticate, canAccess, listExpensesHandler);
router.post('/', authenticate, canAccess, expenseBillUpload, createExpenseHandler);
router.get('/:id', authenticate, canAccess, getExpenseHandler);
router.get('/:id/bill', authenticate, canAccess, getExpenseBillHandler);
router.patch('/:id', authenticate, canAccess, expenseBillUpload, updateExpenseHandler);
router.delete('/:id', authenticate, canAccess, deleteExpenseHandler);

router.get('/:id/payments', authenticate, canAccess, listPaymentsHandler);
router.post('/:id/payments', authenticate, canAccess, addPaymentHandler);
router.delete('/:id/payments/:paymentId', authenticate, canAccess, deletePaymentHandler);

module.exports = router;
