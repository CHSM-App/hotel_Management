const fs = require('fs/promises');
const path = require('path');
const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const { UPLOAD_DIR: RECEIPT_UPLOAD_DIR } = require('../../middleware/incomeReceiptUpload');

function toNullable(value) {
  return value === '' || value === undefined ? null : value;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
//
// No defaults are seeded — same as expense_categories. A category only
// exists once an owner has typed or picked it in the income form.

function mapCategory(row) {
  return { id: row.id, name: row.name, isActive: !!row.is_active };
}

async function listCategories(lodgeId, { includeInactive = false } = {}) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT id, name, is_active
      FROM dbo.income_categories
      WHERE lodge_id = @lodgeId ${includeInactive ? '' : 'AND is_active = 1'}
      ORDER BY name ASC
    `);
  return result.recordset.map(mapCategory);
}

async function createCategory(lodgeId, input) {
  const pool = await getPool();

  const existing = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, input.name)
    .query('SELECT id FROM dbo.income_categories WHERE lodge_id = @lodgeId AND name = @name');
  if (existing.recordset.length > 0) {
    throw new ApiError('A category with that name already exists.', 409, 'name');
  }

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, input.name)
    .query(`
      INSERT INTO dbo.income_categories (lodge_id, name)
      OUTPUT inserted.id
      VALUES (@lodgeId, @name)
    `);

  return { id: result.recordset[0].id, name: input.name, isActive: true };
}

async function updateCategory(lodgeId, categoryId, input) {
  const pool = await getPool();

  if (input.name !== undefined) {
    const conflict = await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('name', sql.NVarChar, input.name)
      .input('categoryId', sql.BigInt, categoryId)
      .query('SELECT id FROM dbo.income_categories WHERE lodge_id = @lodgeId AND name = @name AND id <> @categoryId');
    if (conflict.recordset.length > 0) {
      throw new ApiError('A category with that name already exists.', 409, 'name');
    }
  }

  const current = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, categoryId)
    .query('SELECT name, is_active FROM dbo.income_categories WHERE id = @categoryId AND lodge_id = @lodgeId');
  if (current.recordset.length === 0) {
    throw new ApiError('Category not found.', 404);
  }
  const next = {
    name: input.name !== undefined ? input.name : current.recordset[0].name,
    isActive: input.isActive !== undefined ? input.isActive : !!current.recordset[0].is_active,
  };

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, categoryId)
    .input('name', sql.NVarChar, next.name)
    .input('isActive', sql.Bit, next.isActive)
    .query(`
      UPDATE dbo.income_categories
      SET name = @name, is_active = @isActive
      OUTPUT inserted.id
      WHERE id = @categoryId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Category not found.', 404);
  }
  return { id: categoryId, name: next.name, isActive: next.isActive };
}

// ---------------------------------------------------------------------------
// Income entries
// ---------------------------------------------------------------------------

// An income entry can be received in more than one instalment — part now,
// rest later (dbo.income_receipts). amount_received on the entry itself is
// a running total kept in sync here rather than typed directly, and
// payment_status is derived from it: >= amount is PAID, >0 is PARTIAL, 0 is
// PENDING. Called after every receipt add/delete.
async function recalcIncomePaymentStatus(pool, incomeId) {
  const totals = await pool
    .request()
    .input('incomeId', sql.BigInt, incomeId)
    .query(`
      SELECT e.amount, ISNULL(SUM(p.amount), 0) AS received
      FROM dbo.income_entries e
      LEFT JOIN dbo.income_receipts p ON p.income_id = e.id
      WHERE e.id = @incomeId
      GROUP BY e.amount
    `);
  const row = totals.recordset[0];
  if (!row) return;
  const amount = Number(row.amount);
  const received = Number(row.received);
  const status = received <= 0 ? 'PENDING' : received >= amount ? 'PAID' : 'PARTIAL';

  await pool
    .request()
    .input('incomeId', sql.BigInt, incomeId)
    .input('amountReceived', sql.Decimal(12, 2), received)
    .input('paymentStatus', sql.NVarChar, status)
    .query(`
      UPDATE dbo.income_entries SET amount_received = @amountReceived, payment_status = @paymentStatus,
          updated_at = SYSDATETIMEOFFSET()
      WHERE id = @incomeId
    `);
}

function mapReceipt(row) {
  return {
    id: row.id,
    incomeId: row.income_id,
    amount: Number(row.amount),
    paymentMethod: row.payment_method,
    referenceNumber: row.reference_number,
    receivedDate: row.received_date,
    createdAt: row.created_at,
  };
}

async function listReceipts(lodgeId, incomeId) {
  const pool = await getPool();
  await getIncome(lodgeId, incomeId); // 404s if the entry isn't this lodge's
  const result = await pool
    .request()
    .input('incomeId', sql.BigInt, incomeId)
    .query('SELECT * FROM dbo.income_receipts WHERE income_id = @incomeId ORDER BY received_date DESC, id DESC');
  return result.recordset.map(mapReceipt);
}

// Adding a receipt can't push amount_received past the entry's amount —
// same clamp as expenses.service.js's addPayment.
async function addReceipt(lodgeId, incomeId, input) {
  const pool = await getPool();
  const income = await getIncome(lodgeId, incomeId);
  const remaining = income.amount - income.amountReceived;
  if (Number(input.amount) > remaining + 0.01) {
    throw new ApiError(`That's more than the ₹${remaining.toFixed(2)} left on this entry.`, 400, 'amount');
  }

  await pool
    .request()
    .input('incomeId', sql.BigInt, incomeId)
    .input('amount', sql.Decimal(12, 2), input.amount)
    .input('paymentMethod', sql.NVarChar, input.paymentMethod)
    .input('referenceNumber', sql.NVarChar, toNullable(input.referenceNumber))
    .input('receivedDate', sql.Date, input.receivedDate)
    .query(`
      INSERT INTO dbo.income_receipts (income_id, amount, payment_method, reference_number, received_date)
      OUTPUT inserted.id
      VALUES (@incomeId, @amount, @paymentMethod, @referenceNumber, @receivedDate)
    `);

  await recalcIncomePaymentStatus(pool, incomeId);
  return getIncome(lodgeId, incomeId);
}

async function deleteReceipt(lodgeId, incomeId, receiptId) {
  const pool = await getPool();
  await getIncome(lodgeId, incomeId);

  const result = await pool
    .request()
    .input('incomeId', sql.BigInt, incomeId)
    .input('receiptId', sql.BigInt, receiptId)
    .query('DELETE FROM dbo.income_receipts OUTPUT deleted.id WHERE id = @receiptId AND income_id = @incomeId');
  if (result.recordset.length === 0) {
    throw new ApiError('Receipt not found.', 404);
  }

  await recalcIncomePaymentStatus(pool, incomeId);
  return getIncome(lodgeId, incomeId);
}

function mapIncome(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    payerId: row.payer_id,
    payerName: row.payer_name ?? null,
    recurringTemplateId: row.recurring_template_id,
    title: row.title,
    description: row.description,
    amount: Number(row.amount),
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    amountReceived: row.amount_received == null ? null : Number(row.amount_received),
    incomeDate: row.income_date,
    // Only whether a receipt/proof is on file, never the stored filename —
    // same reasoning as expenses.service.js's mapExpense.
    hasReceiptDocument: !!row.receipt_document,
    createdAt: row.created_at,
  };
}

const INCOME_SELECT = `
  SELECT e.id, e.category_id, c.name AS category_name, e.payer_id, v.name AS payer_name,
         e.recurring_template_id, e.title, e.description, e.amount, e.payment_method,
         e.payment_status, e.amount_received, e.income_date, e.receipt_document, e.created_at
  FROM dbo.income_entries e
  JOIN dbo.income_categories c ON c.id = e.category_id
  LEFT JOIN dbo.vendors v ON v.id = e.payer_id
`;

async function listIncome(lodgeId, { categoryId, payerId, recurringTemplateId, from, to } = {}) {
  const pool = await getPool();
  const request = pool.request().input('lodgeId', sql.BigInt, lodgeId);
  let filter = '';
  if (categoryId) {
    request.input('categoryId', sql.BigInt, categoryId);
    filter += ' AND e.category_id = @categoryId';
  }
  if (payerId) {
    request.input('payerId', sql.BigInt, payerId);
    filter += ' AND e.payer_id = @payerId';
  }
  if (recurringTemplateId) {
    request.input('recurringTemplateId', sql.BigInt, recurringTemplateId);
    filter += ' AND e.recurring_template_id = @recurringTemplateId';
  }
  if (from) {
    request.input('from', sql.Date, from);
    filter += ' AND e.income_date >= @from';
  }
  if (to) {
    request.input('to', sql.Date, to);
    filter += ' AND e.income_date <= @to';
  }

  const result = await request.query(`
    ${INCOME_SELECT}
    WHERE e.lodge_id = @lodgeId ${filter}
    ORDER BY e.income_date DESC, e.id DESC
  `);
  return result.recordset.map(mapIncome);
}

async function getIncome(lodgeId, incomeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('incomeId', sql.BigInt, incomeId)
    .query(`${INCOME_SELECT} WHERE e.id = @incomeId AND e.lodge_id = @lodgeId`);

  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('Income entry not found.', 404);
  }
  return mapIncome(row);
}

async function assertCategory(pool, lodgeId, categoryId) {
  const category = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, categoryId)
    .query('SELECT id FROM dbo.income_categories WHERE id = @categoryId AND lodge_id = @lodgeId');
  if (category.recordset.length === 0) {
    throw new ApiError('Choose a valid category.', 400, 'categoryId');
  }
}

// paymentMethod/amount on input here seed one initial income_receipts row
// (the common "log it, already received" case) rather than being stored
// directly on the entry — see recalcIncomePaymentStatus.
async function createIncome(lodgeId, input, userId, receiptFilename) {
  const pool = await getPool();
  await assertCategory(pool, lodgeId, input.categoryId);

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, input.categoryId)
    .input('payerId', sql.BigInt, input.payerId ?? null)
    .input('recurringTemplateId', sql.BigInt, input.recurringTemplateId ?? null)
    .input('title', sql.NVarChar, input.title)
    .input('description', sql.NVarChar, toNullable(input.description))
    .input('amount', sql.Decimal(12, 2), input.amount)
    .input('paymentMethod', sql.NVarChar, input.paymentMethod || 'CASH')
    .input('incomeDate', sql.Date, input.incomeDate)
    .input('receiptDocument', sql.NVarChar, receiptFilename ?? null)
    .input('createdBy', sql.BigInt, userId ?? null)
    .query(`
      INSERT INTO dbo.income_entries
        (lodge_id, category_id, payer_id, recurring_template_id, title, description, amount,
         payment_method, income_date, receipt_document, created_by)
      OUTPUT inserted.id
      VALUES
        (@lodgeId, @categoryId, @payerId, @recurringTemplateId, @title, @description, @amount,
         @paymentMethod, @incomeDate, @receiptDocument, @createdBy)
    `);

  const incomeId = result.recordset[0].id;
  const status = input.paymentStatus || 'PAID';
  const initialReceived = status === 'PENDING' ? 0 : status === 'PARTIAL' ? Math.min(Number(input.amountReceived) || 0, Number(input.amount)) : Number(input.amount);
  if (initialReceived > 0) {
    await pool
      .request()
      .input('incomeId', sql.BigInt, incomeId)
      .input('amount', sql.Decimal(12, 2), initialReceived)
      .input('paymentMethod', sql.NVarChar, input.paymentMethod || 'CASH')
      .input('referenceNumber', sql.NVarChar, toNullable(input.referenceNumber))
      .input('receivedDate', sql.Date, input.incomeDate)
      .query(`
        INSERT INTO dbo.income_receipts (income_id, amount, payment_method, reference_number, received_date)
        VALUES (@incomeId, @amount, @paymentMethod, @referenceNumber, @receivedDate)
      `);
  }
  await recalcIncomePaymentStatus(pool, incomeId);

  return getIncome(lodgeId, incomeId);
}

async function updateIncome(lodgeId, incomeId, input, receiptFilename) {
  const pool = await getPool();
  await assertCategory(pool, lodgeId, input.categoryId);

  let previousReceipt = null;
  if (receiptFilename) {
    const current = await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('incomeId', sql.BigInt, incomeId)
      .query('SELECT receipt_document FROM dbo.income_entries WHERE id = @incomeId AND lodge_id = @lodgeId');
    previousReceipt = current.recordset[0]?.receipt_document || null;
  }

  const request = pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('incomeId', sql.BigInt, incomeId)
    .input('categoryId', sql.BigInt, input.categoryId)
    .input('payerId', sql.BigInt, input.payerId ?? null)
    .input('title', sql.NVarChar, input.title)
    .input('description', sql.NVarChar, toNullable(input.description))
    .input('amount', sql.Decimal(12, 2), input.amount)
    .input('incomeDate', sql.Date, input.incomeDate);

  const setReceiptDocument = receiptFilename ? ', receipt_document = @receiptDocument' : '';
  if (receiptFilename) request.input('receiptDocument', sql.NVarChar, receiptFilename);

  // payment_method/payment_status/amount_received are deliberately untouched
  // here — same reasoning as expenses.service.js's updateExpense.
  const result = await request.query(`
      UPDATE dbo.income_entries
      SET category_id = @categoryId, payer_id = @payerId, title = @title,
          description = @description, amount = @amount,
          income_date = @incomeDate ${setReceiptDocument}, updated_at = SYSDATETIMEOFFSET()
      OUTPUT inserted.id
      WHERE id = @incomeId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Income entry not found.', 404);
  }

  await recalcIncomePaymentStatus(pool, incomeId);

  if (previousReceipt) {
    fs.unlink(path.join(RECEIPT_UPLOAD_DIR, path.basename(previousReceipt))).catch(() => {});
  }

  return getIncome(lodgeId, incomeId);
}

async function deleteIncome(lodgeId, incomeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('incomeId', sql.BigInt, incomeId)
    .query('DELETE FROM dbo.income_entries OUTPUT deleted.receipt_document WHERE id = @incomeId AND lodge_id = @lodgeId');
  if (result.recordset.length === 0) {
    throw new ApiError('Income entry not found.', 404);
  }
  const receiptDocument = result.recordset[0].receipt_document;
  if (receiptDocument) {
    fs.unlink(path.join(RECEIPT_UPLOAD_DIR, path.basename(receiptDocument))).catch(() => {});
  }
}

async function receiptExists(filename) {
  if (!filename) return false;
  try {
    await fs.access(path.join(RECEIPT_UPLOAD_DIR, path.basename(filename)));
    return true;
  } catch {
    return false;
  }
}

async function getReceiptFilename(lodgeId, incomeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('incomeId', sql.BigInt, incomeId)
    .query('SELECT receipt_document FROM dbo.income_entries WHERE id = @incomeId AND lodge_id = @lodgeId');
  const row = result.recordset[0];
  if (!row || !row.receipt_document) {
    throw new ApiError('No receipt on file for this income entry.', 404);
  }
  return row.receipt_document;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

async function getMonthlySummary(lodgeId, year) {
  const pool = await getPool();
  const request = pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('year', sql.Int, year);

  const byMonth = await request.query(`
    SELECT MONTH(income_date) AS month, SUM(amount) AS total
    FROM dbo.income_entries
    WHERE lodge_id = @lodgeId AND YEAR(income_date) = @year
    GROUP BY MONTH(income_date)
    ORDER BY month ASC
  `);

  const byCategory = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('year', sql.Int, year)
    .query(`
      SELECT c.id AS category_id, c.name AS category_name, SUM(e.amount) AS total
      FROM dbo.income_entries e
      JOIN dbo.income_categories c ON c.id = e.category_id
      WHERE e.lodge_id = @lodgeId AND YEAR(e.income_date) = @year
      GROUP BY c.id, c.name
      ORDER BY total DESC
    `);

  return {
    byMonth: byMonth.recordset.map((r) => ({ month: r.month, total: Number(r.total) })),
    byCategory: byCategory.recordset.map((r) => ({
      categoryId: r.category_id,
      categoryName: r.category_name,
      total: Number(r.total),
    })),
  };
}

// ---------------------------------------------------------------------------
// Recurring templates
// ---------------------------------------------------------------------------

function mapTemplate(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    payerId: row.payer_id,
    payerName: row.payer_name ?? null,
    title: row.title,
    frequency: row.frequency,
    nextDueDate: row.next_due_date,
    isActive: !!row.is_active,
  };
}

const TEMPLATE_SELECT = `
  SELECT t.id, t.category_id, c.name AS category_name, t.payer_id, v.name AS payer_name,
         t.title, t.frequency, t.next_due_date, t.is_active
  FROM dbo.income_recurring_templates t
  JOIN dbo.income_categories c ON c.id = t.category_id
  LEFT JOIN dbo.vendors v ON v.id = t.payer_id
`;

async function listTemplates(lodgeId, { includeInactive = false } = {}) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      ${TEMPLATE_SELECT}
      WHERE t.lodge_id = @lodgeId ${includeInactive ? '' : 'AND t.is_active = 1'}
      ORDER BY t.next_due_date ASC
    `);
  return result.recordset.map(mapTemplate);
}

async function createTemplate(lodgeId, input) {
  const pool = await getPool();
  await assertCategory(pool, lodgeId, input.categoryId);

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, input.categoryId)
    .input('payerId', sql.BigInt, input.payerId ?? null)
    .input('title', sql.NVarChar, input.title)
    .input('frequency', sql.NVarChar, input.frequency)
    .input('nextDueDate', sql.Date, input.nextDueDate)
    .query(`
      INSERT INTO dbo.income_recurring_templates
        (lodge_id, category_id, payer_id, title, frequency, next_due_date)
      OUTPUT inserted.id
      VALUES
        (@lodgeId, @categoryId, @payerId, @title, @frequency, @nextDueDate)
    `);

  const templates = await listTemplates(lodgeId, { includeInactive: true });
  return templates.find((t) => t.id === result.recordset[0].id);
}

async function updateTemplate(lodgeId, templateId, input) {
  const pool = await getPool();

  const current = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('templateId', sql.BigInt, templateId)
    .query(`${TEMPLATE_SELECT} WHERE t.id = @templateId AND t.lodge_id = @lodgeId`);
  if (current.recordset.length === 0) {
    throw new ApiError('Recurring income not found.', 404);
  }
  const existing = mapTemplate(current.recordset[0]);

  if (input.categoryId !== undefined) {
    await assertCategory(pool, lodgeId, input.categoryId);
  }

  const next = {
    categoryId: input.categoryId !== undefined ? input.categoryId : existing.categoryId,
    payerId: input.payerId !== undefined ? input.payerId : existing.payerId,
    title: input.title !== undefined ? input.title : existing.title,
    frequency: input.frequency !== undefined ? input.frequency : existing.frequency,
    nextDueDate: input.nextDueDate !== undefined ? input.nextDueDate : existing.nextDueDate,
    isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
  };

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('templateId', sql.BigInt, templateId)
    .input('categoryId', sql.BigInt, next.categoryId)
    .input('payerId', sql.BigInt, next.payerId ?? null)
    .input('title', sql.NVarChar, next.title)
    .input('frequency', sql.NVarChar, next.frequency)
    .input('nextDueDate', sql.Date, next.nextDueDate)
    .input('isActive', sql.Bit, next.isActive)
    .query(`
      UPDATE dbo.income_recurring_templates
      SET category_id = @categoryId, payer_id = @payerId, title = @title,
          frequency = @frequency, next_due_date = @nextDueDate, is_active = @isActive
      OUTPUT inserted.id
      WHERE id = @templateId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Recurring income not found.', 404);
  }

  const templates = await listTemplates(lodgeId, { includeInactive: true });
  return templates.find((t) => t.id === templateId);
}

function frequencyToSqlUnit(frequency) {
  if (frequency === 'MONTHLY') return 'month';
  if (frequency === 'QUARTERLY') return 'quarter';
  return 'year';
}

// The desk's own "log this month" action — nothing generates on its own.
// Creates a normal income entry (same shape/validation as the plain "New
// income" form) linked back via recurring_template_id, then advances
// next_due_date by the template's frequency. One transaction-equivalent:
// a due-date advance with no entry behind it (or the reverse) is worse than
// the whole thing failing together — mirrors logRecurringOccurrence.
async function logRecurringOccurrence(lodgeId, templateId, input, userId, receiptFilename) {
  const pool = await getPool();
  const template = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('templateId', sql.BigInt, templateId)
    .query('SELECT id, frequency, next_due_date FROM dbo.income_recurring_templates WHERE id = @templateId AND lodge_id = @lodgeId');
  if (template.recordset.length === 0) {
    throw new ApiError('Recurring income not found.', 404);
  }

  const income = await createIncome(lodgeId, { ...input, recurringTemplateId: templateId }, userId, receiptFilename);

  await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('templateId', sql.BigInt, templateId)
    .input('unit', sql.NVarChar, frequencyToSqlUnit(template.recordset[0].frequency))
    .query(`
      UPDATE dbo.income_recurring_templates
      SET next_due_date = DATEADD(month, CASE @unit WHEN 'month' THEN 1 WHEN 'quarter' THEN 3 ELSE 12 END, next_due_date)
      WHERE id = @templateId AND lodge_id = @lodgeId
    `);

  return income;
}

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  listIncome,
  getIncome,
  createIncome,
  updateIncome,
  deleteIncome,
  listReceipts,
  addReceipt,
  deleteReceipt,
  receiptExists,
  getReceiptFilename,
  getMonthlySummary,
  listTemplates,
  createTemplate,
  updateTemplate,
  logRecurringOccurrence,
};
