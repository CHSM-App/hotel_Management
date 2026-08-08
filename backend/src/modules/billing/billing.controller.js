const { issueInvoiceSchema, voidInvoiceSchema } = require('./billing.schema');
const billingService = require('./billing.service');
const { ApiError } = require('../../middleware/errorHandler');

async function listBillableBookingsHandler(req, res, next) {
  try {
    const bookings = await billingService.listBillableBookings(req.user.lodgeId);
    res.json({ bookings });
  } catch (err) {
    next(err);
  }
}

async function previewBillHandler(req, res, next) {
  try {
    const preview = await billingService.previewBill(req.user.lodgeId, Number(req.params.bookingId));
    res.json(preview);
  } catch (err) {
    next(err);
  }
}

async function issueInvoiceHandler(req, res, next) {
  try {
    const parsed = issueInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }
    const invoice = await billingService.issueInvoice(
      req.user.lodgeId,
      req.user.sub,
      Number(req.params.bookingId),
      parsed.data
    );
    res.status(201).json({ invoice });
  } catch (err) {
    next(err);
  }
}

async function listInvoicesHandler(req, res, next) {
  try {
    const invoices = await billingService.listInvoices(req.user.lodgeId);
    res.json({ invoices });
  } catch (err) {
    next(err);
  }
}

async function getInvoiceHandler(req, res, next) {
  try {
    const invoice = await billingService.getInvoice(req.user.lodgeId, Number(req.params.id));
    res.json({ invoice });
  } catch (err) {
    next(err);
  }
}

async function voidInvoiceHandler(req, res, next) {
  try {
    const parsed = voidInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }
    const invoice = await billingService.voidInvoice(req.user.lodgeId, Number(req.params.id), parsed.data.reason);
    res.json({ invoice });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listBillableBookingsHandler,
  previewBillHandler,
  issueInvoiceHandler,
  listInvoicesHandler,
  getInvoiceHandler,
  voidInvoiceHandler,
};
