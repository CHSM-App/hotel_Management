const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const {
  listBillableBookingsHandler,
  listOpenFoodTabsHandler,
  previewFoodBillHandler,
  issueFoodInvoiceHandler,
  previewBillHandler,
  issueInvoiceHandler,
  listInvoicesHandler,
  getInvoiceHandler,
  voidInvoiceHandler,
} = require('./billing.controller');

const router = Router();

// Owner and reception cut bills at the counter — same scope as bookings.
const staff = requirePermission('billing.manage');

router.get('/queue', authenticate, staff, listBillableBookingsHandler);
router.get('/bookings/:bookingId/preview', authenticate, staff, previewBillHandler);
router.post('/bookings/:bookingId/invoice', authenticate, staff, issueInvoiceHandler);

// Food bills. :tableId accepts "counter" for orders taken at the till.
router.get('/food-tabs', authenticate, staff, listOpenFoodTabsHandler);
router.get('/food-tabs/:tableId/preview', authenticate, staff, previewFoodBillHandler);
router.post('/food-tabs/:tableId/invoice', authenticate, staff, issueFoodInvoiceHandler);
router.get('/invoices', authenticate, staff, listInvoicesHandler);
router.get('/invoices/:id', authenticate, staff, getInvoiceHandler);
router.post('/invoices/:id/void', authenticate, staff, voidInvoiceHandler);

module.exports = router;
