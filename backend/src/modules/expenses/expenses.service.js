const fs = require('fs/promises');
const path = require('path');
const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const { UPLOAD_DIR: BILL_UPLOAD_DIR } = require('../../middleware/expenseBillUpload');

function toNullable(value) {
  return value === '' || value === undefined ? null : value;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
//
// No defaults are seeded — same as asset_categories. A category only exists
// once an owner has typed or picked it in the expense form (see
// SUGGESTED_CATEGORIES in ExpensesPanel.jsx for the suggestion list offered
// there); this table starts empty for every lodge.

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
      FROM dbo.expense_categories
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
    .query('SELECT id FROM dbo.expense_categories WHERE lodge_id = @lodgeId AND name = @name');
  if (existing.recordset.length > 0) {
    throw new ApiError('A category with that name already exists.', 409, 'name');
  }

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, input.name)
    .query(`
      INSERT INTO dbo.expense_categories (lodge_id, name)
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
      .query('SELECT id FROM dbo.expense_categories WHERE lodge_id = @lodgeId AND name = @name AND id <> @categoryId');
    if (conflict.recordset.length > 0) {
      throw new ApiError('A category with that name already exists.', 409, 'name');
    }
  }

  const current = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, categoryId)
    .query('SELECT name, is_active FROM dbo.expense_categories WHERE id = @categoryId AND lodge_id = @lodgeId');
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
      UPDATE dbo.expense_categories
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
// Expenses
// ---------------------------------------------------------------------------

// A bill can be settled in more than one payment — part cash today, the rest
// by UPI next week (dbo.expense_payments, migration 080). amount_paid on the
// expense itself is a running total kept in sync here rather than typed
// directly, and payment_status is derived from it: >= amount is PAID, >0 is
// PARTIAL, 0 is PENDING. Called after every payment add/delete.
async function recalcExpensePaymentStatus(pool, expenseId) {
  const totals = await pool
    .request()
    .input('expenseId', sql.BigInt, expenseId)
    .query(`
      SELECT e.amount, ISNULL(SUM(p.amount), 0) AS paid
      FROM dbo.expenses e
      LEFT JOIN dbo.expense_payments p ON p.expense_id = e.id
      WHERE e.id = @expenseId
      GROUP BY e.amount
    `);
  const row = totals.recordset[0];
  if (!row) return;
  const amount = Number(row.amount);
  const paid = Number(row.paid);
  const status = paid <= 0 ? 'PENDING' : paid >= amount ? 'PAID' : 'PARTIAL';

  await pool
    .request()
    .input('expenseId', sql.BigInt, expenseId)
    .input('amountPaid', sql.Decimal(12, 2), paid)
    .input('paymentStatus', sql.NVarChar, status)
    .query(`
      UPDATE dbo.expenses SET amount_paid = @amountPaid, payment_status = @paymentStatus,
          updated_at = SYSDATETIMEOFFSET()
      WHERE id = @expenseId
    `);
}

function mapPayment(row) {
  return {
    id: row.id,
    expenseId: row.expense_id,
    amount: Number(row.amount),
    paymentMethod: row.payment_method,
    referenceNumber: row.reference_number,
    paidDate: row.paid_date,
    createdAt: row.created_at,
  };
}

async function listPayments(lodgeId, expenseId) {
  const pool = await getPool();
  await getExpense(lodgeId, expenseId); // 404s if the expense isn't this lodge's
  const result = await pool
    .request()
    .input('expenseId', sql.BigInt, expenseId)
    .query('SELECT * FROM dbo.expense_payments WHERE expense_id = @expenseId ORDER BY paid_date DESC, id DESC');
  return result.recordset.map(mapPayment);
}

// Adding a payment can't push amount_paid past the bill — same reasoning as
// the old resolveAmountPaid clamp, now enforced against the running total
// instead of a single typed value.
async function addPayment(lodgeId, expenseId, input) {
  const pool = await getPool();
  const expense = await getExpense(lodgeId, expenseId);
  const remaining = expense.amount - expense.amountPaid;
  if (Number(input.amount) > remaining + 0.01) {
    throw new ApiError(`That's more than the ₹${remaining.toFixed(2)} left on this bill.`, 400, 'amount');
  }

  const result = await pool
    .request()
    .input('expenseId', sql.BigInt, expenseId)
    .input('amount', sql.Decimal(12, 2), input.amount)
    .input('paymentMethod', sql.NVarChar, input.paymentMethod)
    .input('referenceNumber', sql.NVarChar, toNullable(input.referenceNumber))
    .input('paidDate', sql.Date, input.paidDate)
    .query(`
      INSERT INTO dbo.expense_payments (expense_id, amount, payment_method, reference_number, paid_date)
      OUTPUT inserted.id
      VALUES (@expenseId, @amount, @paymentMethod, @referenceNumber, @paidDate)
    `);

  await recalcExpensePaymentStatus(pool, expenseId);
  return getExpense(lodgeId, expenseId);
}

async function deletePayment(lodgeId, expenseId, paymentId) {
  const pool = await getPool();
  await getExpense(lodgeId, expenseId);

  const result = await pool
    .request()
    .input('expenseId', sql.BigInt, expenseId)
    .input('paymentId', sql.BigInt, paymentId)
    .query('DELETE FROM dbo.expense_payments OUTPUT deleted.id WHERE id = @paymentId AND expense_id = @expenseId');
  if (result.recordset.length === 0) {
    throw new ApiError('Payment not found.', 404);
  }

  await recalcExpensePaymentStatus(pool, expenseId);
  return getExpense(lodgeId, expenseId);
}

function mapExpense(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    vendorId: row.vendor_id,
    vendorName: row.vendor_name ?? null,
    recurringTemplateId: row.recurring_template_id,
    assetId: row.asset_id,
    title: row.title,
    description: row.description,
    amount: Number(row.amount),
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    amountPaid: row.amount_paid == null ? null : Number(row.amount_paid),
    expenseDate: row.expense_date,
    // Only whether a receipt is on file, never the stored filename — same
    // reasoning as assets.service.js's mapAsset. The frontend always reaches
    // the file through GET /expenses/:id/bill on the expense's own id.
    hasBillDocument: !!row.bill_document,
    createdAt: row.created_at,
  };
}

const EXPENSE_SELECT = `
  SELECT e.id, e.category_id, c.name AS category_name, e.vendor_id, v.name AS vendor_name,
         e.recurring_template_id, e.asset_id, e.title, e.description, e.amount, e.payment_method,
         e.payment_status, e.amount_paid, e.expense_date, e.bill_document, e.created_at
  FROM dbo.expenses e
  JOIN dbo.expense_categories c ON c.id = e.category_id
  LEFT JOIN dbo.vendors v ON v.id = e.vendor_id
`;

async function listExpenses(lodgeId, { categoryId, vendorId, assetId, from, to } = {}) {
  const pool = await getPool();
  const request = pool.request().input('lodgeId', sql.BigInt, lodgeId);
  let filter = '';
  if (categoryId) {
    request.input('categoryId', sql.BigInt, categoryId);
    filter += ' AND e.category_id = @categoryId';
  }
  if (vendorId) {
    request.input('vendorId', sql.BigInt, vendorId);
    filter += ' AND e.vendor_id = @vendorId';
  }
  // The Asset detail view's own Payments section — every expense this asset's
  // purchase/repairs/AMC auto-generated (see asset_id, migration 078).
  if (assetId) {
    request.input('assetId', sql.BigInt, assetId);
    filter += ' AND e.asset_id = @assetId';
  }
  if (from) {
    request.input('from', sql.Date, from);
    filter += ' AND e.expense_date >= @from';
  }
  if (to) {
    request.input('to', sql.Date, to);
    filter += ' AND e.expense_date <= @to';
  }

  const result = await request.query(`
    ${EXPENSE_SELECT}
    WHERE e.lodge_id = @lodgeId ${filter}
    ORDER BY e.expense_date DESC, e.id DESC
  `);
  return result.recordset.map(mapExpense);
}

async function getExpense(lodgeId, expenseId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('expenseId', sql.BigInt, expenseId)
    .query(`${EXPENSE_SELECT} WHERE e.id = @expenseId AND e.lodge_id = @lodgeId`);

  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('Expense not found.', 404);
  }
  return mapExpense(row);
}

async function assertCategory(pool, lodgeId, categoryId) {
  const category = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, categoryId)
    .query('SELECT id FROM dbo.expense_categories WHERE id = @categoryId AND lodge_id = @lodgeId');
  if (category.recordset.length === 0) {
    throw new ApiError('Choose a valid category.', 400, 'categoryId');
  }
}

// paymentMethod/amount on input here seed one initial expense_payments row
// (the common "log it, already paid" case) rather than being stored directly
// on the expense — see recalcExpensePaymentStatus. Leaving amount unsent (or
// 0) creates the expense as PENDING with no payments yet; more can be added
// with addPayment.
async function createExpense(lodgeId, input, userId, billFilename) {
  const pool = await getPool();
  await assertCategory(pool, lodgeId, input.categoryId);

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, input.categoryId)
    .input('vendorId', sql.BigInt, input.vendorId ?? null)
    .input('title', sql.NVarChar, input.title)
    .input('description', sql.NVarChar, toNullable(input.description))
    .input('amount', sql.Decimal(12, 2), input.amount)
    .input('paymentMethod', sql.NVarChar, input.paymentMethod || 'CASH')
    .input('expenseDate', sql.Date, input.expenseDate)
    .input('billDocument', sql.NVarChar, billFilename ?? null)
    .input('createdBy', sql.BigInt, userId ?? null)
    .query(`
      INSERT INTO dbo.expenses
        (lodge_id, category_id, vendor_id, title, description, amount, payment_method,
         expense_date, bill_document, created_by)
      OUTPUT inserted.id
      VALUES
        (@lodgeId, @categoryId, @vendorId, @title, @description, @amount, @paymentMethod,
         @expenseDate, @billDocument, @createdBy)
    `);

  const expenseId = result.recordset[0].id;
  // PAID -> the full amount as one payment; PARTIAL -> whatever was given,
  // clamped; PENDING (or no status sent) -> no payment row at all. Always
  // recalculating afterward (not just when a payment was seeded) is what
  // makes a PENDING expense actually land as PENDING instead of sitting at
  // the payment_status column's PAID default with no payment behind it.
  const status = input.paymentStatus || 'PAID';
  const initialPaid = status === 'PENDING' ? 0 : status === 'PARTIAL' ? Math.min(Number(input.amountPaid) || 0, Number(input.amount)) : Number(input.amount);
  if (initialPaid > 0) {
    await pool
      .request()
      .input('expenseId', sql.BigInt, expenseId)
      .input('amount', sql.Decimal(12, 2), initialPaid)
      .input('paymentMethod', sql.NVarChar, input.paymentMethod || 'CASH')
      .input('referenceNumber', sql.NVarChar, toNullable(input.referenceNumber))
      .input('paidDate', sql.Date, input.expenseDate)
      .query(`
        INSERT INTO dbo.expense_payments (expense_id, amount, payment_method, reference_number, paid_date)
        VALUES (@expenseId, @amount, @paymentMethod, @referenceNumber, @paidDate)
      `);
  }
  await recalcExpensePaymentStatus(pool, expenseId);

  return getExpense(lodgeId, expenseId);
}

async function updateExpense(lodgeId, expenseId, input, billFilename) {
  const pool = await getPool();
  await assertCategory(pool, lodgeId, input.categoryId);

  // A new receipt replaces the old one — the previous file is deleted once
  // the row commits to the new filename, so a crash between the two never
  // loses the only copy on file. Same pattern as assets.service.js.
  let previousBill = null;
  if (billFilename) {
    const current = await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('expenseId', sql.BigInt, expenseId)
      .query('SELECT bill_document FROM dbo.expenses WHERE id = @expenseId AND lodge_id = @lodgeId');
    previousBill = current.recordset[0]?.bill_document || null;
  }

  const request = pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('expenseId', sql.BigInt, expenseId)
    .input('categoryId', sql.BigInt, input.categoryId)
    .input('vendorId', sql.BigInt, input.vendorId ?? null)
    .input('title', sql.NVarChar, input.title)
    .input('description', sql.NVarChar, toNullable(input.description))
    .input('amount', sql.Decimal(12, 2), input.amount)
    .input('expenseDate', sql.Date, input.expenseDate);

  const setBillDocument = billFilename ? ', bill_document = @billDocument' : '';
  if (billFilename) request.input('billDocument', sql.NVarChar, billFilename);

  // payment_method/payment_status/amount_paid are deliberately untouched
  // here — they're either the method of the last payment or a running total
  // over dbo.expense_payments (see recalcExpensePaymentStatus), never a
  // value this form edits directly. Changing amount can shift PAID back to
  // PARTIAL/PENDING though, so status is recalculated against the new
  // amount after the update.
  const result = await request.query(`
      UPDATE dbo.expenses
      SET category_id = @categoryId, vendor_id = @vendorId, title = @title,
          description = @description, amount = @amount,
          expense_date = @expenseDate ${setBillDocument}, updated_at = SYSDATETIMEOFFSET()
      OUTPUT inserted.id
      WHERE id = @expenseId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Expense not found.', 404);
  }

  await recalcExpensePaymentStatus(pool, expenseId);

  if (previousBill) {
    fs.unlink(path.join(BILL_UPLOAD_DIR, path.basename(previousBill))).catch(() => {});
  }

  return getExpense(lodgeId, expenseId);
}

async function deleteExpense(lodgeId, expenseId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('expenseId', sql.BigInt, expenseId)
    .query('DELETE FROM dbo.expenses OUTPUT deleted.bill_document WHERE id = @expenseId AND lodge_id = @lodgeId');
  if (result.recordset.length === 0) {
    throw new ApiError('Expense not found.', 404);
  }
  const billDocument = result.recordset[0].bill_document;
  if (billDocument) {
    fs.unlink(path.join(BILL_UPLOAD_DIR, path.basename(billDocument))).catch(() => {});
  }
}

async function billExists(filename) {
  if (!filename) return false;
  try {
    await fs.access(path.join(BILL_UPLOAD_DIR, path.basename(filename)));
    return true;
  } catch {
    return false;
  }
}

async function getBillFilename(lodgeId, expenseId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('expenseId', sql.BigInt, expenseId)
    .query('SELECT bill_document FROM dbo.expenses WHERE id = @expenseId AND lodge_id = @lodgeId');
  const row = result.recordset[0];
  if (!row || !row.bill_document) {
    throw new ApiError('No receipt on file for this expense.', 404);
  }
  return row.bill_document;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

// Two aggregations the dashboard needs — spend by category (this year, to
// answer "what are we spending the most on") and spend by month (to answer
// "is this trending up") — done in the database rather than pulled row by
// row into the frontend to sum, since a year of expenses can be sizeable.
async function getMonthlySummary(lodgeId, year) {
  const pool = await getPool();
  const request = pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('year', sql.Int, year);

  const byMonth = await request.query(`
    SELECT MONTH(expense_date) AS month, SUM(amount) AS total
    FROM dbo.expenses
    WHERE lodge_id = @lodgeId AND YEAR(expense_date) = @year
    GROUP BY MONTH(expense_date)
    ORDER BY month ASC
  `);

  const byCategory = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('year', sql.Int, year)
    .query(`
      SELECT c.id AS category_id, c.name AS category_name, SUM(e.amount) AS total
      FROM dbo.expenses e
      JOIN dbo.expense_categories c ON c.id = e.category_id
      WHERE e.lodge_id = @lodgeId AND YEAR(e.expense_date) = @year
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
// Asset-generated expenses
// ---------------------------------------------------------------------------
//
// Called from assets.service.js when an asset purchase, a work order close,
// or a coverage/AMC renewal carries a cost — so that spend logged in the
// Assets tab shows up in the Expenses tab without being typed twice. Same
// "auto-generate a real expenses row" model as generateDueExpenses(), with
// asset_id as the origin marker instead of recurring_template_id.
//
// Never throws: a lodge mid-transaction in assets.service.js shouldn't fail
// to save the asset/work order because expense-logging hit a snag. Errors
// are swallowed by the caller (see logAssetExpense call sites).
async function resolveAssetExpenseCategoryId(pool, lodgeId) {
  const name = 'Asset & Maintenance';
  const existing = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, name)
    .query('SELECT id FROM dbo.expense_categories WHERE lodge_id = @lodgeId AND name = @name');
  if (existing.recordset.length > 0) return existing.recordset[0].id;

  const created = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, name)
    .query(`
      INSERT INTO dbo.expense_categories (lodge_id, name)
      OUTPUT inserted.id
      VALUES (@lodgeId, @name)
    `);
  return created.recordset[0].id;
}

async function logAssetExpense(
  lodgeId,
  { assetId, vendorId, title, amount, paymentMethod, paymentStatus, amountPaid, referenceNumber, expenseDate }
) {
  if (!amount || Number(amount) <= 0) return;
  const pool = await getPool();
  const categoryId = await resolveAssetExpenseCategoryId(pool, lodgeId);
  const method = paymentMethod || 'CASH';

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, categoryId)
    .input('vendorId', sql.BigInt, vendorId ?? null)
    .input('assetId', sql.BigInt, assetId)
    .input('title', sql.NVarChar, title)
    .input('amount', sql.Decimal(12, 2), amount)
    .input('paymentMethod', sql.NVarChar, method)
    .input('expenseDate', sql.Date, expenseDate)
    .query(`
      INSERT INTO dbo.expenses
        (lodge_id, category_id, vendor_id, asset_id, title, amount, payment_method, expense_date)
      OUTPUT inserted.id
      VALUES
        (@lodgeId, @categoryId, @vendorId, @assetId, @title, @amount, @paymentMethod, @expenseDate)
    `);

  const expenseId = result.recordset[0].id;
  // PAID -> the full amount as one payment; PARTIAL -> whatever was given,
  // clamped; PENDING (or unset) -> no payment row, the expense sits at 0
  // paid until one is added by hand.
  const status = paymentStatus || 'PAID';
  const initialPaid = status === 'PENDING' ? 0 : status === 'PARTIAL' ? Math.min(Number(amountPaid) || 0, Number(amount)) : Number(amount);
  if (initialPaid > 0) {
    await pool
      .request()
      .input('expenseId', sql.BigInt, expenseId)
      .input('amount', sql.Decimal(12, 2), initialPaid)
      .input('paymentMethod', sql.NVarChar, method)
      .input('referenceNumber', sql.NVarChar, toNullable(referenceNumber))
      .input('paidDate', sql.Date, expenseDate)
      .query(`
        INSERT INTO dbo.expense_payments (expense_id, amount, payment_method, reference_number, paid_date)
        VALUES (@expenseId, @amount, @paymentMethod, @referenceNumber, @paidDate)
      `);
  }
  await recalcExpensePaymentStatus(pool, expenseId);
}

// ---------------------------------------------------------------------------
// Recurring templates
// ---------------------------------------------------------------------------

function mapTemplate(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    vendorId: row.vendor_id,
    vendorName: row.vendor_name ?? null,
    title: row.title,
    amount: Number(row.amount),
    frequency: row.frequency,
    nextDueDate: row.next_due_date,
    isActive: !!row.is_active,
  };
}

const TEMPLATE_SELECT = `
  SELECT t.id, t.category_id, c.name AS category_name, t.vendor_id, v.name AS vendor_name,
         t.title, t.amount, t.frequency, t.next_due_date, t.is_active
  FROM dbo.expense_recurring_templates t
  JOIN dbo.expense_categories c ON c.id = t.category_id
  LEFT JOIN dbo.vendors v ON v.id = t.vendor_id
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
    .input('vendorId', sql.BigInt, input.vendorId ?? null)
    .input('title', sql.NVarChar, input.title)
    .input('amount', sql.Decimal(12, 2), input.amount)
    .input('frequency', sql.NVarChar, input.frequency)
    .input('nextDueDate', sql.Date, input.nextDueDate)
    .query(`
      INSERT INTO dbo.expense_recurring_templates
        (lodge_id, category_id, vendor_id, title, amount, frequency, next_due_date)
      OUTPUT inserted.id
      VALUES
        (@lodgeId, @categoryId, @vendorId, @title, @amount, @frequency, @nextDueDate)
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
    throw new ApiError('Recurring expense not found.', 404);
  }
  const existing = mapTemplate(current.recordset[0]);

  if (input.categoryId !== undefined) {
    await assertCategory(pool, lodgeId, input.categoryId);
  }

  const next = {
    categoryId: input.categoryId !== undefined ? input.categoryId : existing.categoryId,
    vendorId: input.vendorId !== undefined ? input.vendorId : existing.vendorId,
    title: input.title !== undefined ? input.title : existing.title,
    amount: input.amount !== undefined ? input.amount : existing.amount,
    frequency: input.frequency !== undefined ? input.frequency : existing.frequency,
    nextDueDate: input.nextDueDate !== undefined ? input.nextDueDate : existing.nextDueDate,
    isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
  };

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('templateId', sql.BigInt, templateId)
    .input('categoryId', sql.BigInt, next.categoryId)
    .input('vendorId', sql.BigInt, next.vendorId ?? null)
    .input('title', sql.NVarChar, next.title)
    .input('amount', sql.Decimal(12, 2), next.amount)
    .input('frequency', sql.NVarChar, next.frequency)
    .input('nextDueDate', sql.Date, next.nextDueDate)
    .input('isActive', sql.Bit, next.isActive)
    .query(`
      UPDATE dbo.expense_recurring_templates
      SET category_id = @categoryId, vendor_id = @vendorId, title = @title, amount = @amount,
          frequency = @frequency, next_due_date = @nextDueDate, is_active = @isActive
      OUTPUT inserted.id
      WHERE id = @templateId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Recurring expense not found.', 404);
  }

  const templates = await listTemplates(lodgeId, { includeInactive: true });
  return templates.find((t) => t.id === templateId);
}

// Advances a due date by the template's own frequency — calendar-aware
// (DATEADD handles month-end rollover), so a template due Jan 31 lands on
// Feb 28/29, not an invalid Feb 31.
function frequencyToSqlUnit(frequency) {
  if (frequency === 'MONTHLY') return 'month';
  if (frequency === 'QUARTERLY') return 'quarter';
  return 'year';
}

// Turns every template whose next_due_date has arrived into a logged
// expense, then advances it — called whenever the panel loads rather than
// on a schedule, since nothing in this codebase runs a background job today
// (see assets.service.js's allocateAssetTag comment on avoiding new
// infrastructure). One template at a time in its own transaction, so one bad
// row can't roll back the others.
async function generateDueExpenses(lodgeId) {
  const pool = await getPool();
  const due = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT id, category_id, vendor_id, title, amount, frequency, next_due_date
      FROM dbo.expense_recurring_templates
      WHERE lodge_id = @lodgeId AND is_active = 1 AND next_due_date <= CAST(SYSDATETIMEOFFSET() AS DATE)
    `);

  const generated = [];
  for (const row of due.recordset) {
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const insertResult = await new sql.Request(transaction)
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('categoryId', sql.BigInt, row.category_id)
        .input('vendorId', sql.BigInt, row.vendor_id)
        .input('templateId', sql.BigInt, row.id)
        .input('title', sql.NVarChar, row.title)
        .input('amount', sql.Decimal(12, 2), row.amount)
        .input('expenseDate', sql.Date, row.next_due_date)
        .query(`
          INSERT INTO dbo.expenses
            (lodge_id, category_id, vendor_id, recurring_template_id, title, amount,
             payment_method, expense_date)
          OUTPUT inserted.id
          VALUES
            (@lodgeId, @categoryId, @vendorId, @templateId, @title, @amount, 'CASH', @expenseDate)
        `);

      // Generated already paid, in full, by cash — same assumption the old
      // single-status model made for every auto-generated recurring row.
      // amount_paid/payment_status are written directly here (rather than
      // through recalcExpensePaymentStatus) because the values are already
      // known and this has to stay inside the one transaction.
      await new sql.Request(transaction)
        .input('expenseId', sql.BigInt, insertResult.recordset[0].id)
        .input('amount', sql.Decimal(12, 2), row.amount)
        .input('paidDate', sql.Date, row.next_due_date)
        .query(`
          INSERT INTO dbo.expense_payments (expense_id, amount, payment_method, paid_date)
          VALUES (@expenseId, @amount, 'CASH', @paidDate)
        `);
      await new sql.Request(transaction)
        .input('expenseId', sql.BigInt, insertResult.recordset[0].id)
        .input('amount', sql.Decimal(12, 2), row.amount)
        .query(`
          UPDATE dbo.expenses SET amount_paid = @amount, payment_status = 'PAID'
          WHERE id = @expenseId
        `);

      await new sql.Request(transaction)
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('templateId', sql.BigInt, row.id)
        .input('unit', sql.NVarChar, frequencyToSqlUnit(row.frequency))
        .query(`
          UPDATE dbo.expense_recurring_templates
          SET next_due_date = DATEADD(month, CASE @unit WHEN 'month' THEN 1 WHEN 'quarter' THEN 3 ELSE 12 END, next_due_date)
          WHERE id = @templateId AND lodge_id = @lodgeId
        `);

      await transaction.commit();
      generated.push(insertResult.recordset[0].id);
    } catch (err) {
      await transaction.rollback();
      // One template failing to generate (a category deleted out from under
      // it, say) shouldn't stop the rest from being logged.
    }
  }

  return Promise.all(generated.map((id) => getExpense(lodgeId, id)));
}

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  listExpenses,
  getExpense,
  createExpense,
  updateExpense,
  deleteExpense,
  listPayments,
  addPayment,
  deletePayment,
  billExists,
  getBillFilename,
  getMonthlySummary,
  listTemplates,
  createTemplate,
  updateTemplate,
  generateDueExpenses,
  logAssetExpense,
};
