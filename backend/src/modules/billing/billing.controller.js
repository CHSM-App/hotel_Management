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

// A preview is re-fetched on every keystroke in the discount box, so a
// half-typed or nonsense figure prices the bill at full price rather than
// erroring under the cursor. The service caps it at what is on the bill.
function parseDiscount(raw) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function previewBillHandler(req, res, next) {
  try {
    const preview = await billingService.previewBill(req.user.lodgeId, Number(req.params.bookingId), {
      // The billing desk re-previews with this off to see the bill without the
      // overstay charge before committing to it. Absent means "as agreed at
      // checkout", so only the explicit string turns it off.
      includeLateCheckout: req.query.includeLateCheckout !== 'false',
      discountAmount: parseDiscount(req.query.discountAmount),
      // What the desk wants the guest to hand over. When set it wins: the
      // service solves for the discount that lands there and ignores any
      // discount sent alongside it.
      targetTotal: parseDiscount(req.query.targetTotal),
    });
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

// The restaurant side of the queue: tables holding delivered food that nobody
// has paid for yet.
async function listOpenFoodTabsHandler(req, res, next) {
  try {
    const tabs = await billingService.listOpenFoodTabs(req.user.lodgeId);
    res.json({ tabs });
  } catch (err) {
    next(err);
  }
}

// "counter" is the tab for orders taken at the till with no table — a real
// grouping, so it gets a route rather than being unbillable.
function tableIdParam(raw) {
  return raw === 'counter' ? null : Number(raw);
}

async function previewFoodBillHandler(req, res, next) {
  try {
    const preview = await billingService.previewFoodBill(req.user.lodgeId, tableIdParam(req.params.tableId), {
      discountAmount: parseDiscount(req.query.discountAmount),
      targetTotal: parseDiscount(req.query.targetTotal),
    });
    res.json(preview);
  } catch (err) {
    next(err);
  }
}

async function issueFoodInvoiceHandler(req, res, next) {
  try {
    const parsed = issueInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }
    const invoice = await billingService.issueFoodInvoice(
      req.user.lodgeId,
      req.user.sub,
      tableIdParam(req.params.tableId),
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
  listOpenFoodTabsHandler,
  previewFoodBillHandler,
  issueFoodInvoiceHandler,
  previewBillHandler,
  issueInvoiceHandler,
  listInvoicesHandler,
  getInvoiceHandler,
  voidInvoiceHandler,
};
