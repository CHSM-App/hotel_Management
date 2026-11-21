const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const { incomeReceiptUpload } = require('../../middleware/incomeReceiptUpload');
const {
  listCategoriesHandler,
  createCategoryHandler,
  updateCategoryHandler,
  listPayersHandler,
  createPayerHandler,
  updatePayerHandler,
  listIncomeHandler,
  getIncomeHandler,
  createIncomeHandler,
  updateIncomeHandler,
  deleteIncomeHandler,
  listReceiptsHandler,
  addReceiptHandler,
  deleteReceiptHandler,
  getIncomeReceiptFileHandler,
  getSummaryHandler,
  listTemplatesHandler,
  createTemplateHandler,
  updateTemplateHandler,
  logOccurrenceHandler,
} = require('./income.controller');

const router = Router();

// One permission for the whole module, same simplicity level as
// expenses.manage — income doesn't yet need a separate viewer role.
const canAccess = requirePermission('income.manage');

router.get('/categories', authenticate, canAccess, listCategoriesHandler);
router.post('/categories', authenticate, canAccess, createCategoryHandler);
router.patch('/categories/:id', authenticate, canAccess, updateCategoryHandler);

router.get('/payers', authenticate, canAccess, listPayersHandler);
router.post('/payers', authenticate, canAccess, createPayerHandler);
router.patch('/payers/:id', authenticate, canAccess, updatePayerHandler);

router.get('/summary', authenticate, canAccess, getSummaryHandler);

router.get('/recurring', authenticate, canAccess, listTemplatesHandler);
router.post('/recurring', authenticate, canAccess, createTemplateHandler);
router.patch('/recurring/:id', authenticate, canAccess, updateTemplateHandler);
router.post('/recurring/:id/log', authenticate, canAccess, incomeReceiptUpload, logOccurrenceHandler);

router.get('/', authenticate, canAccess, listIncomeHandler);
router.post('/', authenticate, canAccess, incomeReceiptUpload, createIncomeHandler);
router.get('/:id', authenticate, canAccess, getIncomeHandler);
router.get('/:id/receipt', authenticate, canAccess, getIncomeReceiptFileHandler);
router.patch('/:id', authenticate, canAccess, incomeReceiptUpload, updateIncomeHandler);
router.delete('/:id', authenticate, canAccess, deleteIncomeHandler);

router.get('/:id/receipts', authenticate, canAccess, listReceiptsHandler);
router.post('/:id/receipts', authenticate, canAccess, addReceiptHandler);
router.delete('/:id/receipts/:receiptId', authenticate, canAccess, deleteReceiptHandler);

module.exports = router;
