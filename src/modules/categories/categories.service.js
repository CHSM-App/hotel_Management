const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');

async function listCategories(lodgeId) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT id, name, base_price, is_active, created_at
      FROM dbo.room_categories
      WHERE lodge_id = @lodgeId
      ORDER BY base_price ASC
    `);

  return result.recordset.map((row) => ({
    id: row.id,
    name: row.name,
    basePrice: Number(row.base_price),
    isActive: !!row.is_active,
    createdAt: row.created_at,
  }));
}

async function createCategory(lodgeId, input) {
  const pool = await getPool();

  const existing = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, input.name)
    .query('SELECT id FROM dbo.room_categories WHERE lodge_id = @lodgeId AND name = @name');

  if (existing.recordset.length > 0) {
    throw new ApiError('A category with that name already exists.', 409, 'categoryName');
  }

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, input.name)
    .input('basePrice', sql.Decimal(10, 2), input.basePrice)
    .query(`
      INSERT INTO dbo.room_categories (lodge_id, name, base_price)
      OUTPUT inserted.id
      VALUES (@lodgeId, @name, @basePrice)
    `);

  return { id: result.recordset[0].id };
}

async function updateCategory(lodgeId, categoryId, input) {
  const pool = await getPool();

  const existing = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, categoryId)
    .query('SELECT id FROM dbo.room_categories WHERE id = @categoryId AND lodge_id = @lodgeId');
  if (existing.recordset.length === 0) {
    throw new ApiError('Category not found.', 404);
  }

  const nameConflict = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, categoryId)
    .input('name', sql.NVarChar, input.name)
    .query('SELECT id FROM dbo.room_categories WHERE lodge_id = @lodgeId AND name = @name AND id <> @categoryId');
  if (nameConflict.recordset.length > 0) {
    throw new ApiError('A category with that name already exists.', 409, 'categoryName');
  }

  await pool
    .request()
    .input('categoryId', sql.BigInt, categoryId)
    .input('name', sql.NVarChar, input.name)
    .input('basePrice', sql.Decimal(10, 2), input.basePrice)
    .query('UPDATE dbo.room_categories SET name = @name, base_price = @basePrice WHERE id = @categoryId');

  return { id: categoryId };
}

// A category can't be hard-deleted once any room references it
// (rooms.category_id is NOT NULL), so "delete" deactivates instead — it
// drops out of the "Add room" picker without breaking existing rooms.
async function setCategoryActive(lodgeId, categoryId, isActive) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, categoryId)
    .input('isActive', sql.Bit, isActive)
    .query(`
      UPDATE dbo.room_categories SET is_active = @isActive
      OUTPUT inserted.id
      WHERE id = @categoryId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Category not found.', 404);
  }
  return { id: categoryId };
}

// True delete, for a category that was never actually used by a room —
// blocked once any room references it (rooms.category_id is NOT NULL, so
// deactivating is the only option once that's the case).
async function deleteCategory(lodgeId, categoryId) {
  const pool = await getPool();

  const existing = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, categoryId)
    .query('SELECT id FROM dbo.room_categories WHERE id = @categoryId AND lodge_id = @lodgeId');
  if (existing.recordset.length === 0) {
    throw new ApiError('Category not found.', 404);
  }

  const roomsResult = await pool
    .request()
    .input('categoryId', sql.BigInt, categoryId)
    .query('SELECT TOP 1 id FROM dbo.rooms WHERE category_id = @categoryId');
  if (roomsResult.recordset.length > 0) {
    throw new ApiError(
      'Rooms are using this category and it can’t be permanently deleted — deactivate it instead.',
      409
    );
  }

  await pool
    .request()
    .input('categoryId', sql.BigInt, categoryId)
    .query('DELETE FROM dbo.room_categories WHERE id = @categoryId');
}

module.exports = { listCategories, createCategory, updateCategory, setCategoryActive, deleteCategory };
