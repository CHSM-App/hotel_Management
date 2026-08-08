const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const {
  listBillableBookingsHandler,
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
router.get('/invoices', authenticate, staff, listInvoicesHandler);
router.get('/invoices/:id', authenticate, staff, getInvoiceHandler);
router.post('/invoices/:id/void', authenticate, staff, voidInvoiceHandler);

module.exports = router;
