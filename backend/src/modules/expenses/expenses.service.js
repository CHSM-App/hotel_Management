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

function mapExpense(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    vendorId: row.vendor_id,
    vendorName: row.vendor_name ?? null,
    recurringTemplateId: row.recurring_template_id,
    title: row.title,
    description: row.description,
    amount: Number(row.amount),
    paymentMethod: row.payment_method,
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
         e.recurring_template_id, e.title, e.description, e.amount, e.payment_method,
         e.expense_date, e.bill_document, e.created_at
  FROM dbo.expenses e
  JOIN dbo.expense_categories c ON c.id = e.category_id
  LEFT JOIN dbo.vendors v ON v.id = e.vendor_id
`;

async function listExpenses(lodgeId, { categoryId, vendorId, from, to } = {}) {
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
    .input('paymentMethod', sql.NVarChar, input.paymentMethod)
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

  return getExpense(lodgeId, result.recordset[0].id);
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
    .input('paymentMethod', sql.NVarChar, input.paymentMethod)
    .input('expenseDate', sql.Date, input.expenseDate);

  const setBillDocument = billFilename ? ', bill_document = @billDocument' : '';
  if (billFilename) request.input('billDocument', sql.NVarChar, billFilename);

  const result = await request.query(`
      UPDATE dbo.expenses
      SET category_id = @categoryId, vendor_id = @vendorId, title = @title,
          description = @description, amount = @amount, payment_method = @paymentMethod,
          expense_date = @expenseDate ${setBillDocument}, updated_at = SYSDATETIMEOFFSET()
      OUTPUT inserted.id
      WHERE id = @expenseId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Expense not found.', 404);
  }

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
  billExists,
  getBillFilename,
  getMonthlySummary,
  listTemplates,
  createTemplate,
  updateTemplate,
  generateDueExpenses,
};
