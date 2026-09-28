const {
  categorySchema,
  updateCategorySchema,
  incomeEntrySchema,
  incomeReceiptSchema,
  recurringTemplateSchema,
  updateRecurringTemplateSchema,
} = require('./income.schema');
const fs = require('fs');
const path = require('path');
const incomeService = require('./income.service');
const vendorsService = require('../vendors/vendors.service');
const { vendorSchema } = require('../expenses/expenses.schema');
const { ApiError } = require('../../middleware/errorHandler');
const { UPLOAD_DIR: RECEIPT_UPLOAD_DIR } = require('../../middleware/incomeReceiptUpload');

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
    const categories = await incomeService.listCategories(req.user.lodgeId, {
      includeInactive: req.query.includeInactive === 'true',
    });
    res.json({ categories });
  } catch (err) {
    next(err);
  }
}

async function createCategoryHandler(req, res, next) {
  try {
    const category = await incomeService.createCategory(req.user.lodgeId, parse(categorySchema, req.body));
    res.status(201).json({ category });
  } catch (err) {
    next(err);
  }
}

async function updateCategoryHandler(req, res, next) {
  try {
    const category = await incomeService.updateCategory(
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
// Payers — same shared vendor directory Assets/Expenses use.
// ---------------------------------------------------------------------------

async function listPayersHandler(req, res, next) {
  try {
    const payers = await vendorsService.listVendors(req.user.lodgeId, 'income', {
      includeInactive: req.query.includeInactive === 'true',
    });
    res.json({ payers });
  } catch (err) {
    next(err);
  }
}

async function createPayerHandler(req, res, next) {
  try {
    const payer = await vendorsService.createVendor(req.user.lodgeId, 'income', parse(vendorSchema, req.body));
    res.status(201).json({ payer });
  } catch (err) {
    next(err);
  }
}

async function updatePayerHandler(req, res, next) {
  try {
    const payer = await vendorsService.updateVendor(
      req.user.lodgeId,
      'income',
      Number(req.params.id),
      parse(vendorSchema, req.body)
    );
    res.json({ payer });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Income entries
// ---------------------------------------------------------------------------

async function listIncomeHandler(req, res, next) {
  try {
    const income = await incomeService.listIncome(req.user.lodgeId, {
      categoryId: req.query.categoryId ? Number(req.query.categoryId) : undefined,
      payerId: req.query.payerId ? Number(req.query.payerId) : undefined,
      recurringTemplateId: req.query.recurringTemplateId ? Number(req.query.recurringTemplateId) : undefined,
      from: req.query.from || undefined,
      to: req.query.to || undefined,
    });
    res.json({ income });
  } catch (err) {
    next(err);
  }
}

async function getIncomeHandler(req, res, next) {
  try {
    const income = await incomeService.getIncome(req.user.lodgeId, Number(req.params.id));
    res.json({ income });
  } catch (err) {
    next(err);
  }
}

async function createIncomeHandler(req, res, next) {
  try {
    const income = await incomeService.createIncome(
      req.user.lodgeId,
      parse(incomeEntrySchema, req.body),
      req.user.sub,
      req.file?.filename
    );
    res.status(201).json({ income });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    next(err);
  }
}

async function updateIncomeHandler(req, res, next) {
  try {
    const income = await incomeService.updateIncome(
      req.user.lodgeId,
      Number(req.params.id),
      parse(incomeEntrySchema, req.body),
      req.file?.filename
    );
    res.json({ income });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    next(err);
  }
}

async function deleteIncomeHandler(req, res, next) {
  try {
    await incomeService.deleteIncome(req.user.lodgeId, Number(req.params.id));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Receipts — several per income entry, see dbo.income_receipts.
// ---------------------------------------------------------------------------

async function listReceiptsHandler(req, res, next) {
  try {
    const receipts = await incomeService.listReceipts(req.user.lodgeId, Number(req.params.id));
    res.json({ receipts });
  } catch (err) {
    next(err);
  }
}

async function addReceiptHandler(req, res, next) {
  try {
    const income = await incomeService.addReceipt(
      req.user.lodgeId,
      Number(req.params.id),
      parse(incomeReceiptSchema, req.body)
    );
    res.status(201).json({ income });
  } catch (err) {
    next(err);
  }
}

async function deleteReceiptHandler(req, res, next) {
  try {
    const income = await incomeService.deleteReceipt(
      req.user.lodgeId,
      Number(req.params.id),
      Number(req.params.receiptId)
    );
    res.json({ income });
  } catch (err) {
    next(err);
  }
}

async function getIncomeReceiptFileHandler(req, res, next) {
  try {
    const filename = await incomeService.getReceiptFilename(req.user.lodgeId, Number(req.params.id));
    if (!(await incomeService.receiptExists(filename))) {
      throw new ApiError('That receipt is no longer on file.', 404);
    }
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.sendFile(path.join(RECEIPT_UPLOAD_DIR, path.basename(filename)));
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
    const summary = await incomeService.getMonthlySummary(req.user.lodgeId, year);
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
    const templates = await incomeService.listTemplates(req.user.lodgeId, {
      includeInactive: req.query.includeInactive === 'true',
    });
    res.json({ templates });
  } catch (err) {
    next(err);
  }
}

async function createTemplateHandler(req, res, next) {
  try {
    const template = await incomeService.createTemplate(
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
    const template = await incomeService.updateTemplate(
      req.user.lodgeId,
      Number(req.params.id),
      parse(updateRecurringTemplateSchema, req.body)
    );
    res.json({ template });
  } catch (err) {
    next(err);
  }
}

async function logOccurrenceHandler(req, res, next) {
  try {
    const income = await incomeService.logRecurringOccurrence(
      req.user.lodgeId,
      Number(req.params.id),
      parse(incomeEntrySchema, req.body),
      req.user.sub,
      req.file?.filename
    );
    res.status(201).json({ income });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    next(err);
  }
}

module.exports = {
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
};
