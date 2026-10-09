const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');

async function listCategories(lodgeId) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT c.id, c.name, c.base_price, c.is_active, c.tape_order, c.created_at,
             -- Sold by the bed: the category has rooms, and every one is a dormitory.
             -- Dormitory is set on the room, so the category takes it from them.
             CASE WHEN EXISTS (SELECT 1 FROM dbo.rooms r WHERE r.category_id = c.id AND r.is_dormitory = 1)
                   AND NOT EXISTS (SELECT 1 FROM dbo.rooms r WHERE r.category_id = c.id AND r.is_dormitory = 0)
                  THEN 1 ELSE 0 END AS is_dormitory
      FROM dbo.room_categories c
      WHERE c.lodge_id = @lodgeId
      ORDER BY CASE WHEN c.tape_order IS NULL THEN 1 ELSE 0 END, c.tape_order ASC, c.id ASC
    `);

  return result.recordset.map((row) => ({
    id: row.id,
    name: row.name,
    basePrice: Number(row.base_price),
    isActive: !!row.is_active,
    tapeOrder: row.tape_order,
    isDormitory: !!row.is_dormitory,
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

  // tapeOrder is optional — when the owner doesn't set one, the category is
  // appended after whatever is already ordered (MAX + 1), so it behaves as
  // "add to the end" rather than tying for first place at NULL. A position
  // that is already taken is not refused: the new category takes it and the
  // rest shift down (renumberTapeOrder).
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await transaction
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('name', sql.NVarChar, input.name)
      .input('basePrice', sql.Decimal(10, 2), input.basePrice)
      .input('tapeOrder', sql.Int, input.tapeOrder ?? null)
      .query(`
        INSERT INTO dbo.room_categories (lodge_id, name, base_price, tape_order)
        OUTPUT inserted.id
        VALUES (
          @lodgeId, @name, @basePrice,
          COALESCE(@tapeOrder, (SELECT MAX(tape_order) + 1 FROM dbo.room_categories WHERE lodge_id = @lodgeId))
        )
      `);
    const { id } = result.recordset[0];

    await renumberTapeOrder(transaction, lodgeId, id, false);

    await transaction.commit();
    return { id };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

// Rewrites a lodge's categories to positions 1..n, in their current order, so
// no two ever share a place and there are no gaps. pinnedId is the category
// just saved: where it ties with another it goes first — it takes the place
// it asked for and the others move down — unless it was moved to a later
// position (pinLast), where going first would leave it one short of it.
async function renumberTapeOrder(transaction, lodgeId, pinnedId, pinLast) {
  await transaction
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('pinnedId', sql.BigInt, pinnedId)
    .input('pinRank', sql.Int, pinLast ? 2 : 0)
    .query(`
      WITH ordered AS (
        SELECT tape_order,
               ROW_NUMBER() OVER (
                 ORDER BY CASE WHEN tape_order IS NULL THEN 1 ELSE 0 END,
                          tape_order,
                          CASE WHEN id = @pinnedId THEN @pinRank ELSE 1 END,
                          id
               ) AS pos
        FROM dbo.room_categories
        WHERE lodge_id = @lodgeId
      )
      UPDATE ordered SET tape_order = pos WHERE tape_order IS NULL OR tape_order <> pos
    `);
}

async function updateCategory(lodgeId, categoryId, input) {
  const pool = await getPool();

  const existing = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, categoryId)
    .query('SELECT id, tape_order FROM dbo.room_categories WHERE id = @categoryId AND lodge_id = @lodgeId');
  if (existing.recordset.length === 0) {
    throw new ApiError('Category not found.', 404);
  }
  const oldOrder = existing.recordset[0].tape_order;
  const newOrder = input.tapeOrder ?? null;

  const nameConflict = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, categoryId)
    .input('name', sql.NVarChar, input.name)
    .query('SELECT id FROM dbo.room_categories WHERE lodge_id = @lodgeId AND name = @name AND id <> @categoryId');
  if (nameConflict.recordset.length > 0) {
    throw new ApiError('A category with that name already exists.', 409, 'categoryName');
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await transaction
      .request()
      .input('categoryId', sql.BigInt, categoryId)
      .input('name', sql.NVarChar, input.name)
      .input('basePrice', sql.Decimal(10, 2), input.basePrice)
      .input('tapeOrder', sql.Int, newOrder)
      .query(
        'UPDATE dbo.room_categories SET name = @name, base_price = @basePrice, tape_order = @tapeOrder WHERE id = @categoryId'
      );

    // A blank position sends the category to the end, as it does on create.
    await renumberTapeOrder(transaction, lodgeId, categoryId, oldOrder != null && newOrder != null && newOrder > oldOrder);

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

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
