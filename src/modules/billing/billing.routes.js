const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const { billShareUpload } = require('../../middleware/billShareUpload');
const {
  listBillableBookingsHandler,
  previewEventBillHandler,
  issueEventInvoiceHandler,
  previewEventAdvanceReceiptHandler,
  issueEventAdvanceReceiptHandler,
  listEventAdvanceReceiptsHandler,
  listOpenFoodTabsHandler,
  previewFoodBillHandler,
  issueFoodInvoiceHandler,
  previewBillHandler,
  issueInvoiceHandler,
  listInvoicesHandler,
  getInvoiceHandler,
  voidInvoiceHandler,
  getSeriesHandler,
  updateSeriesHandler,
  previewAdvanceReceiptHandler,
  issueAdvanceReceiptHandler,
  listAllAdvanceReceiptsHandler,
  listAdvanceReceiptsHandler,
  getAdvanceReceiptHandler,
  voidAdvanceReceiptHandler,
  shareInvoiceWhatsAppHandler,
  listInvoiceSharesHandler,
} = require('./billing.controller');

const router = Router();

// Owner and reception cut bills at the counter — same scope as bookings.
const staff = requirePermission('billing.manage');

router.get('/queue', authenticate, staff, listBillableBookingsHandler);
router.get('/bookings/:bookingId/preview', authenticate, staff, previewBillHandler);
router.post('/bookings/:bookingId/invoice', authenticate, staff, issueInvoiceHandler);

// Functions. The same two documents a stay gets — the final bill and the
// advance receipt — against an event booking. Behind billing.manage like the
// rest: the events desk takes the booking, the billing desk writes the paper.
router.get('/events/:eventId/preview', authenticate, staff, previewEventBillHandler);
router.post('/events/:eventId/invoice', authenticate, staff, issueEventInvoiceHandler);
router.post('/events/:eventId/advance-receipt/preview', authenticate, staff, previewEventAdvanceReceiptHandler);
router.post('/events/:eventId/advance-receipt', authenticate, staff, issueEventAdvanceReceiptHandler);
router.get('/events/:eventId/advance-receipts', authenticate, staff, listEventAdvanceReceiptsHandler);

// Food bills. :tab is "counter", "table-<id>" or "room-<id>" — the three ways
// food is served to someone with no stay to charge it to, each billed on its
// own document.
router.get('/food-tabs', authenticate, staff, listOpenFoodTabsHandler);
router.get('/food-tabs/:tab/preview', authenticate, staff, previewFoodBillHandler);
router.post('/food-tabs/:tab/invoice', authenticate, staff, issueFoodInvoiceHandler);
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

// Sending a bill to the guest, and the record of what has been sent.
//
// The PDF travels up rather than being built here: it is drawn in the browser
// off the very document the desk previewed, so the guest gets the bill on the
// paper and in the language that was chosen on screen. See billShare.service.
//
// billShareUpload runs before the handler and writes the file to disk, so the
// handler is responsible for removing it again on any path that does not send.
router.post('/invoices/:id/share/whatsapp', authenticate, staff, billShareUpload, shareInvoiceWhatsAppHandler);
router.get('/invoices/:id/shares', authenticate, staff, listInvoiceSharesHandler);

// The serials printed on bills and advance receipts. Behind billing.manage like
// everything else here: whoever cuts the bills is who decides what they are
// numbered, and it is not a separate job.
router.get('/series', authenticate, staff, getSeriesHandler);
router.patch('/series/:series', authenticate, staff, updateSeriesHandler);

module.exports = router;
