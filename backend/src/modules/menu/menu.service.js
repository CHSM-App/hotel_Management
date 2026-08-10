const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');

function mapItem(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    foodType: row.food_type,
    isAvailable: !!row.is_available,
    sortOrder: row.sort_order,
    isActive: !!row.is_active,
  };
}

// The whole menu in one call — sections with their items nested. Both the
// owner's editor and the kitchen's availability toggle read this, and the
// public page reads the same shape through a filtered variant below, so a
// section that looks empty to staff looks empty to a guest for the same reason.
async function getMenu(lodgeId, { activeOnly = false } = {}) {
  const pool = await getPool();

  const categoriesResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT id, name, sort_order, is_active
      FROM dbo.menu_categories
      WHERE lodge_id = @lodgeId ${activeOnly ? 'AND is_active = 1' : ''}
      ORDER BY sort_order ASC, name ASC
    `);

  const itemsResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT id, category_id, name, description, price, food_type, is_available, sort_order, is_active
      FROM dbo.menu_items
      WHERE lodge_id = @lodgeId ${activeOnly ? 'AND is_active = 1' : ''}
      ORDER BY sort_order ASC, name ASC
    `);

  const itemsByCategory = new Map();
  for (const row of itemsResult.recordset) {
    const list = itemsByCategory.get(row.category_id) || [];
    list.push(mapItem(row));
    itemsByCategory.set(row.category_id, list);
  }

  return categoriesResult.recordset.map((row) => ({
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    isActive: !!row.is_active,
    items: itemsByCategory.get(row.id) || [],
  }));
}

async function createCategory(lodgeId, input) {
  const pool = await getPool();

  const existing = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, input.name)
    .query('SELECT id FROM dbo.menu_categories WHERE lodge_id = @lodgeId AND name = @name');
  if (existing.recordset.length > 0) {
    throw new ApiError('A menu section with that name already exists.', 409);
  }

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, input.name)
    .input('sortOrder', sql.Int, input.sortOrder)
    .query(`
      INSERT INTO dbo.menu_categories (lodge_id, name, sort_order)
      OUTPUT inserted.id
      VALUES (@lodgeId, @name, @sortOrder)
    `);

  return { id: result.recordset[0].id };
}

async function updateCategory(lodgeId, categoryId, input) {
  const pool = await getPool();

  const conflict = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, categoryId)
    .input('name', sql.NVarChar, input.name)
    .query('SELECT id FROM dbo.menu_categories WHERE lodge_id = @lodgeId AND name = @name AND id <> @categoryId');
  if (conflict.recordset.length > 0) {
    throw new ApiError('A menu section with that name already exists.', 409);
  }

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, categoryId)
    .input('name', sql.NVarChar, input.name)
    .input('sortOrder', sql.Int, input.sortOrder)
    .query(`
      UPDATE dbo.menu_categories SET name = @name, sort_order = @sortOrder
      OUTPUT inserted.id
      WHERE id = @categoryId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Menu section not found.', 404);
  }

  return { id: categoryId };
}

async function setCategoryActive(lodgeId, categoryId, isActive) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, categoryId)
    .input('isActive', sql.Bit, isActive)
    .query(`
      UPDATE dbo.menu_categories SET is_active = @isActive
      OUTPUT inserted.id
      WHERE id = @categoryId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Menu section not found.', 404);
  }
  return { id: categoryId };
}

// Mirrors the room-category rule: a section holding items can't be hard
// deleted (menu_items.category_id is NOT NULL), so it's deactivated instead.
async function deleteCategory(lodgeId, categoryId) {
  const pool = await getPool();

  const existing = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, categoryId)
    .query('SELECT id FROM dbo.menu_categories WHERE id = @categoryId AND lodge_id = @lodgeId');
  if (existing.recordset.length === 0) {
    throw new ApiError('Menu section not found.', 404);
  }

  const itemsResult = await pool
    .request()
    .input('categoryId', sql.BigInt, categoryId)
    .query('SELECT TOP 1 id FROM dbo.menu_items WHERE category_id = @categoryId');
  if (itemsResult.recordset.length > 0) {
    throw new ApiError(
      'This section still has items and can’t be permanently deleted — hide it instead.',
      409
    );
  }

  await pool
    .request()
    .input('categoryId', sql.BigInt, categoryId)
    .query('DELETE FROM dbo.menu_categories WHERE id = @categoryId');
}

async function assertCategoryBelongsToLodge(pool, lodgeId, categoryId) {
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, categoryId)
    .query('SELECT id FROM dbo.menu_categories WHERE id = @categoryId AND lodge_id = @lodgeId');
  if (result.recordset.length === 0) {
    throw new ApiError('Menu section not found.', 404);
  }
}

async function createItem(lodgeId, input) {
  const pool = await getPool();
  await assertCategoryBelongsToLodge(pool, lodgeId, input.categoryId);

  const existing = await pool
    .request()
    .input('categoryId', sql.BigInt, input.categoryId)
    .input('name', sql.NVarChar, input.name)
    .query('SELECT id FROM dbo.menu_items WHERE category_id = @categoryId AND name = @name');
  if (existing.recordset.length > 0) {
    throw new ApiError('That section already has an item with this name.', 409);
  }

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, input.categoryId)
    .input('name', sql.NVarChar, input.name)
    .input('description', sql.NVarChar, input.description || null)
    .input('price', sql.Decimal(10, 2), input.price)
    .input('foodType', sql.NVarChar, input.foodType)
    .input('sortOrder', sql.Int, input.sortOrder)
    .query(`
      INSERT INTO dbo.menu_items (lodge_id, category_id, name, description, price, food_type, sort_order)
      OUTPUT inserted.id
      VALUES (@lodgeId, @categoryId, @name, @description, @price, @foodType, @sortOrder)
    `);

  return { id: result.recordset[0].id };
}

async function updateItem(lodgeId, itemId, input) {
  const pool = await getPool();
  await assertCategoryBelongsToLodge(pool, lodgeId, input.categoryId);

  const conflict = await pool
    .request()
    .input('categoryId', sql.BigInt, input.categoryId)
    .input('name', sql.NVarChar, input.name)
    .input('itemId', sql.BigInt, itemId)
    .query('SELECT id FROM dbo.menu_items WHERE category_id = @categoryId AND name = @name AND id <> @itemId');
  if (conflict.recordset.length > 0) {
    throw new ApiError('That section already has an item with this name.', 409);
  }

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('itemId', sql.BigInt, itemId)
    .input('categoryId', sql.BigInt, input.categoryId)
    .input('name', sql.NVarChar, input.name)
    .input('description', sql.NVarChar, input.description || null)
    .input('price', sql.Decimal(10, 2), input.price)
    .input('foodType', sql.NVarChar, input.foodType)
    .input('sortOrder', sql.Int, input.sortOrder)
    .query(`
      UPDATE dbo.menu_items
      SET category_id = @categoryId, name = @name, description = @description,
          price = @price, food_type = @foodType, sort_order = @sortOrder
      OUTPUT inserted.id
      WHERE id = @itemId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Menu item not found.', 404);
  }

  return { id: itemId };
}

// The kitchen's "we're out of this" switch. Separate from setItemActive so it
// can carry the looser permission — see menu.routes.js.
async function setItemAvailable(lodgeId, itemId, isAvailable) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('itemId', sql.BigInt, itemId)
    .input('isAvailable', sql.Bit, isAvailable)
    .query(`
      UPDATE dbo.menu_items SET is_available = @isAvailable
      OUTPUT inserted.id
      WHERE id = @itemId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Menu item not found.', 404);
  }
  return { id: itemId };
}

async function setItemActive(lodgeId, itemId, isActive) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('itemId', sql.BigInt, itemId)
    .input('isActive', sql.Bit, isActive)
    .query(`
      UPDATE dbo.menu_items SET is_active = @isActive
      OUTPUT inserted.id
      WHERE id = @itemId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Menu item not found.', 404);
  }
  return { id: itemId };
}

// Past orders keep the item's name and price on their own lines, so deleting
// an item can't rewrite history — the order line's menu_item_id just goes
// NULL. That's why this is a real delete and not a soft one.
async function deleteItem(lodgeId, itemId) {
  const pool = await getPool();

  const existing = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('itemId', sql.BigInt, itemId)
    .query('SELECT id FROM dbo.menu_items WHERE id = @itemId AND lodge_id = @lodgeId');
  if (existing.recordset.length === 0) {
    throw new ApiError('Menu item not found.', 404);
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction)
      .input('itemId', sql.BigInt, itemId)
      .query('UPDATE dbo.food_order_items SET menu_item_id = NULL WHERE menu_item_id = @itemId');

    await new sql.Request(transaction)
      .input('itemId', sql.BigInt, itemId)
      .query('DELETE FROM dbo.menu_items WHERE id = @itemId');

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function getFoodSettings(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT has_rooms, serves_food, food_room_service, food_table_service
      FROM dbo.lodges WHERE id = @lodgeId
    `);
  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('Lodge not found.', 404);
  }
  return {
    hasRooms: !!row.has_rooms,
    servesFood: !!row.serves_food,
    foodRoomService: !!row.food_room_service,
    foodTableService: !!row.food_table_service,
  };
}

async function updateFoodSettings(lodgeId, input) {
  const pool = await getPool();
  const current = await getFoodSettings(lodgeId);

  // Room service needs rooms to serve. A restaurant has none, so the flag
  // would produce a QR section that could never be filled.
  if (input.foodRoomService && !current.hasRooms) {
    throw new ApiError('This property has no rooms, so in-room ordering can’t be switched on.', 400);
  }

  // Both delivery styles hang off serves_food; letting one survive it off
  // would leave live QR codes pointing at a menu the property doesn't serve.
  const roomService = input.servesFood ? input.foodRoomService : false;
  const tableService = input.servesFood ? input.foodTableService : false;

  await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('servesFood', sql.Bit, input.servesFood)
    .input('foodRoomService', sql.Bit, roomService)
    .input('foodTableService', sql.Bit, tableService)
    .query(`
      UPDATE dbo.lodges
      SET serves_food = @servesFood, food_room_service = @foodRoomService, food_table_service = @foodTableService
      WHERE id = @lodgeId
    `);

  return getFoodSettings(lodgeId);
}

module.exports = {
  getMenu,
  createCategory,
  updateCategory,
  setCategoryActive,
  deleteCategory,
  createItem,
  updateItem,
  setItemAvailable,
  setItemActive,
  deleteItem,
  getFoodSettings,
  updateFoodSettings,
};
