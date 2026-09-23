const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const { assetBillUpload } = require('../../middleware/assetBillUpload');
const {
  listCategoriesHandler,
  createCategoryHandler,
  listAssetsHandler,
  getAssetHandler,
  getAssetByQrHandler,
  createAssetHandler,
  createAssetsBulkHandler,
  updateAssetHandler,
  getAssetBillHandler,
  updateAssetStatusHandler,
  deleteAssetHandler,
  listCoveragePeriodsHandler,
  createCoveragePeriodHandler,
  deleteCoveragePeriodHandler,
  listVendorsHandler,
  createVendorHandler,
  updateVendorHandler,
  listWorkOrdersHandler,
  createWorkOrderHandler,
  createWorkOrdersBulkHandler,
  updateWorkOrderHandler,
} = require('./assets.controller');

const router = Router();

// One permission for the whole module, same simplicity level as
// rooms.manage/staff.manage — assets don't yet need a separate viewer role.
const canAccess = requirePermission('assets.manage');

router.get('/categories', authenticate, canAccess, listCategoriesHandler);
router.post('/categories', authenticate, canAccess, createCategoryHandler);

router.get('/vendors', authenticate, canAccess, listVendorsHandler);
router.post('/vendors', authenticate, canAccess, createVendorHandler);
router.patch('/vendors/:id', authenticate, canAccess, updateVendorHandler);

router.get('/work-orders', authenticate, canAccess, listWorkOrdersHandler);
router.post('/work-orders', authenticate, canAccess, createWorkOrderHandler);
// Ahead of PATCH '/work-orders/:id' for the same reason '/bulk' is ahead of
// '/:id' on assets below — a distinct path, not a param value, so it can
// never collide with a numeric work order id.
router.post('/work-orders/bulk', authenticate, canAccess, createWorkOrdersBulkHandler);
router.patch('/work-orders/:id', authenticate, canAccess, updateWorkOrderHandler);

// Resolves a scanned QR token to its asset — kept ahead of /:id so "qr" is
// never read as a numeric id.
router.get('/qr/:token', authenticate, canAccess, getAssetByQrHandler);

router.get('/', authenticate, canAccess, listAssetsHandler);
router.post('/', authenticate, canAccess, assetBillUpload, createAssetHandler);
// Ahead of POST '/' for the same reason /qr/:token is ahead of /:id — a
// distinct path, not a query flag, so a bulk request can never be read as a
// single-asset one with a stray extra field.
router.post('/bulk', authenticate, canAccess, assetBillUpload, createAssetsBulkHandler);
router.get('/:id', authenticate, canAccess, getAssetHandler);
router.get('/:id/bill', authenticate, canAccess, getAssetBillHandler);
router.patch('/:id', authenticate, canAccess, assetBillUpload, updateAssetHandler);
router.patch('/:id/status', authenticate, canAccess, updateAssetStatusHandler);
router.delete('/:id', authenticate, canAccess, deleteAssetHandler);

router.get('/:id/coverage', authenticate, canAccess, listCoveragePeriodsHandler);
router.post('/:id/coverage', authenticate, canAccess, createCoveragePeriodHandler);
router.delete('/:id/coverage/:periodId', authenticate, canAccess, deleteCoveragePeriodHandler);

module.exports = router;
