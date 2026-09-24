const {
  categorySchema,
  updateCategorySchema,
  vendorSchema,
  expenseSchema,
  expensePaymentSchema,
  recurringTemplateSchema,
  updateRecurringTemplateSchema,
} = require('./expenses.schema');
const fs = require('fs');
const path = require('path');
const expensesService = require('./expenses.service');
const vendorsService = require('../vendors/vendors.service');
const { ApiError } = require('../../middleware/errorHandler');
const { UPLOAD_DIR: BILL_UPLOAD_DIR } = require('../../middleware/expenseBillUpload');

function parse(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0].message, 400);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

async function listCategoriesHandler(req, res, next) {
  try {
    const categories = await expensesService.listCategories(req.user.lodgeId, {
      includeInactive: req.query.includeInactive === 'true',
    });
    res.json({ categories });
  } catch (err) {
    next(err);
  }
}

async function createCategoryHandler(req, res, next) {
  try {
    const category = await expensesService.createCategory(req.user.lodgeId, parse(categorySchema, req.body));
    res.status(201).json({ category });
  } catch (err) {
    next(err);
  }
}

async function updateCategoryHandler(req, res, next) {
  try {
    const category = await expensesService.updateCategory(
      req.user.lodgeId,
      Number(req.params.id),
      parse(updateCategorySchema, req.body)
    );
    res.json({ category });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Vendors — same shared service Assets uses.
// ---------------------------------------------------------------------------

async function listVendorsHandler(req, res, next) {
  try {
    const vendors = await vendorsService.listVendors(req.user.lodgeId, {
      includeInactive: req.query.includeInactive === 'true',
    });
    res.json({ vendors });
  } catch (err) {
    next(err);
  }
}

async function createVendorHandler(req, res, next) {
  try {
    const vendor = await vendorsService.createVendor(req.user.lodgeId, parse(vendorSchema, req.body));
    res.status(201).json({ vendor });
  } catch (err) {
    next(err);
  }
}

async function updateVendorHandler(req, res, next) {
  try {
    const vendor = await vendorsService.updateVendor(
      req.user.lodgeId,
      Number(req.params.id),
      parse(vendorSchema, req.body)
    );
    res.json({ vendor });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

async function listExpensesHandler(req, res, next) {
  try {
    const expenses = await expensesService.listExpenses(req.user.lodgeId, {
      categoryId: req.query.categoryId ? Number(req.query.categoryId) : undefined,
      vendorId: req.query.vendorId ? Number(req.query.vendorId) : undefined,
      assetId: req.query.assetId ? Number(req.query.assetId) : undefined,
      recurringTemplateId: req.query.recurringTemplateId ? Number(req.query.recurringTemplateId) : undefined,
      from: req.query.from || undefined,
      to: req.query.to || undefined,
    });
    res.json({ expenses });
  } catch (err) {
    next(err);
  }
}

async function getExpenseHandler(req, res, next) {
  try {
    const expense = await expensesService.getExpense(req.user.lodgeId, Number(req.params.id));
    res.json({ expense });
  } catch (err) {
    next(err);
  }
}

async function createExpenseHandler(req, res, next) {
  try {
    const expense = await expensesService.createExpense(
      req.user.lodgeId,
      parse(expenseSchema, req.body),
      req.user.sub,
      req.file?.filename
    );
    res.status(201).json({ expense });
  } catch (err) {
    // A validation failure after multer already wrote the file leaves it
    // orphaned on disk — nothing in the database ever points to it.
    if (req.file) fs.unlink(req.file.path, () => {});
    next(err);
  }
}

async function updateExpenseHandler(req, res, next) {
  try {
    const expense = await expensesService.updateExpense(
      req.user.lodgeId,
      Number(req.params.id),
      parse(expenseSchema, req.body),
      req.file?.filename
    );
    res.json({ expense });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    next(err);
  }
}

async function deleteExpenseHandler(req, res, next) {
  try {
    await expensesService.deleteExpense(req.user.lodgeId, Number(req.params.id));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Payments — several per expense, see dbo.expense_payments.
// ---------------------------------------------------------------------------

async function listPaymentsHandler(req, res, next) {
  try {
    const payments = await expensesService.listPayments(req.user.lodgeId, Number(req.params.id));
    res.json({ payments });
  } catch (err) {
    next(err);
  }
}

async function addPaymentHandler(req, res, next) {
  try {
    const expense = await expensesService.addPayment(
      req.user.lodgeId,
      Number(req.params.id),
      parse(expensePaymentSchema, req.body)
    );
    res.status(201).json({ expense });
  } catch (err) {
    next(err);
  }
}

async function deletePaymentHandler(req, res, next) {
  try {
    const expense = await expensesService.deletePayment(
      req.user.lodgeId,
      Number(req.params.id),
      Number(req.params.paymentId)
    );
    res.json({ expense });
  } catch (err) {
    next(err);
  }
}

async function getExpenseBillHandler(req, res, next) {
  try {
    const filename = await expensesService.getBillFilename(req.user.lodgeId, Number(req.params.id));
    if (!(await expensesService.billExists(filename))) {
      throw new ApiError('That receipt is no longer on file.', 404);
    }
    // basename, not the stored string — same guard as assets.controller.js.
    res.sendFile(path.join(BILL_UPLOAD_DIR, path.basename(filename)));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

async function getSummaryHandler(req, res, next) {
  try {
    const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
    const summary = await expensesService.getMonthlySummary(req.user.lodgeId, year);
    res.json({ summary });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Recurring templates
// ---------------------------------------------------------------------------

async function listTemplatesHandler(req, res, next) {
  try {
    const templates = await expensesService.listTemplates(req.user.lodgeId, {
      includeInactive: req.query.includeInactive === 'true',
    });
    res.json({ templates });
  } catch (err) {
    next(err);
  }
}

async function createTemplateHandler(req, res, next) {
  try {
    const template = await expensesService.createTemplate(
      req.user.lodgeId,
      parse(recurringTemplateSchema, req.body)
    );
    res.status(201).json({ template });
  } catch (err) {
    next(err);
  }
}

async function updateTemplateHandler(req, res, next) {
  try {
    const template = await expensesService.updateTemplate(
      req.user.lodgeId,
      Number(req.params.id),
      parse(updateRecurringTemplateSchema, req.body)
    );
    res.json({ template });
  } catch (err) {
    next(err);
  }
}

// "Log this month" — the desk manually recording one occurrence of a
// recurring template, entering amount/vendor/payment right here (this IS
// the expense form; expenseSchema covers it) rather than inheriting a
// guessed amount from the template.
async function logOccurrenceHandler(req, res, next) {
  try {
    const expense = await expensesService.logRecurringOccurrence(
      req.user.lodgeId,
      Number(req.params.id),
      parse(expenseSchema, req.body),
      req.user.sub,
      req.file?.filename
    );
    res.status(201).json({ expense });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    next(err);
  }
}

module.exports = {
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
};
