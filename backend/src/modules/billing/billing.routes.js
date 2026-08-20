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
  previewAdvanceReceiptHandler,
  issueAdvanceReceiptHandler,
  listAllAdvanceReceiptsHandler,
  listAdvanceReceiptsHandler,
  getAdvanceReceiptHandler,
  voidAdvanceReceiptHandler,
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
// Advance receipts. Taken at the desk when the booking is made, so these sit
// under bookings/ like the stay bill does — same booking, different document.
//
// The preview is a POST because it is priced from a body (the amount and how it
// was paid), not from a stay that already exists: a GET with the figures in the
// query string would put money in the access logs for no gain.
router.post('/bookings/:bookingId/advance-receipt/preview', authenticate, staff, previewAdvanceReceiptHandler);
router.post('/bookings/:bookingId/advance-receipt', authenticate, staff, issueAdvanceReceiptHandler);
router.get('/bookings/:bookingId/advance-receipts', authenticate, staff, listAdvanceReceiptsHandler);
// Ahead of /:id, or a bare list would be parsed as a receipt id.
router.get('/advance-receipts', authenticate, staff, listAllAdvanceReceiptsHandler);
router.get('/advance-receipts/:id', authenticate, staff, getAdvanceReceiptHandler);
router.post('/advance-receipts/:id/void', authenticate, staff, voidAdvanceReceiptHandler);

router.get('/invoices', authenticate, staff, listInvoicesHandler);
router.get('/invoices/:id', authenticate, staff, getInvoiceHandler);
router.post('/invoices/:id/void', authenticate, staff, voidInvoiceHandler);

module.exports = router;
