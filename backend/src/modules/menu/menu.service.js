const fs = require('fs');
const path = require('path');
const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const { UPLOAD_DIR: MENU_IMAGE_DIR } = require('../../middleware/menuImageUpload');
const inventoryService = require('../inventory/inventory.service');

// A dish photo the property uploaded, or nothing. The filename alone travels —
// the browser builds the URL against the /menu-images static mount, the same
// way it does for room photos.
function mapItem(row, portions = []) {
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
    image: row.image_filename ?? null,
    portions,
  };
}

// A dish photo that is no longer referenced by any row. Deleted best-effort:
// an orphaned file wastes a few hundred kilobytes, while a failed unlink that
// took the whole request down would lose the menu edit the user actually
// asked for.
function removeMenuImage(filename) {
  if (!filename) return;
  fs.unlink(path.join(MENU_IMAGE_DIR, path.basename(filename)), () => {});
}

function mapPortion(row) {
  return {
    id: row.id,
    label: row.label,
    price: Number(row.price),
    isAvailable: !!row.is_available,
    sortOrder: row.sort_order,
  };
}

// The sizes of every dish in one lodge, keyed by item id.
async function getPortionsByItem(pool, lodgeId) {
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT id, item_id, label, price, is_available, sort_order
      FROM dbo.menu_item_portions
      WHERE lodge_id = @lodgeId
      ORDER BY sort_order ASC, id ASC
    `);

  const byItem = new Map();
  for (const row of result.recordset) {
    const list = byItem.get(String(row.item_id)) || [];
    list.push(mapPortion(row));
    byItem.set(String(row.item_id), list);
  }
  return byItem;
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
      SELECT id, category_id, name, description, price, food_type, is_available,
             sort_order, is_active, image_filename
      FROM dbo.menu_items
      WHERE lodge_id = @lodgeId ${activeOnly ? 'AND is_active = 1' : ''}
      ORDER BY sort_order ASC, name ASC
    `);

  const portionsByItem = await getPortionsByItem(pool, lodgeId);

  const itemsByCategory = new Map();
  for (const row of itemsResult.recordset) {
    const list = itemsByCategory.get(row.category_id) || [];
    list.push(mapItem(row, portionsByItem.get(String(row.id)) || []));
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
    .input('imageFilename', sql.NVarChar, input.imageFilename ?? null)
    .query(`
      INSERT INTO dbo.menu_items
        (lodge_id, category_id, name, description, price, food_type, sort_order, image_filename)
      OUTPUT inserted.id
      VALUES (@lodgeId, @categoryId, @name, @description, @price, @foodType, @sortOrder, @imageFilename)
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

  // The photo has three fates on a save, and the form has to be able to say
  // which: a new file replaces it, "remove" clears it, and sending neither
  // leaves whatever is on file alone. That last case is the common one — most
  // edits are a price change — so it can't be expressed by absence meaning
  // "clear", the way a text field would.
  const currentResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('itemId', sql.BigInt, itemId)
    .query('SELECT image_filename FROM dbo.menu_items WHERE id = @itemId AND lodge_id = @lodgeId');
  if (currentResult.recordset.length === 0) {
    throw new ApiError('Menu item not found.', 404);
  }
  const currentImage = currentResult.recordset[0].image_filename;

  let nextImage = currentImage;
  if (input.imageFilename) nextImage = input.imageFilename;
  else if (input.removeImage) nextImage = null;

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
    .input('imageFilename', sql.NVarChar, nextImage)
    .query(`
      UPDATE dbo.menu_items
      SET category_id = @categoryId, name = @name, description = @description,
          price = @price, food_type = @foodType, sort_order = @sortOrder,
          image_filename = @imageFilename
      OUTPUT inserted.id
      WHERE id = @itemId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Menu item not found.', 404);
  }

  // Only once the row has stopped pointing at it. The other order would leave
  // the menu naming a file that had already gone if the update then failed.
  if (currentImage && currentImage !== nextImage) removeMenuImage(currentImage);

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

// The same switch as setItemAvailable, thrown over a whole section at once.
// This is a real kitchen action rather than a convenience: the fish runs out
// and every fish dish has to come off the guest's menu in one go, at eight in
// the evening, on a phone. Twenty separate requests would half-succeed often
// enough to matter, and each one would be a separate row in anyone's mind.
//
// Returns how many rows actually changed, so the screen can say "9 dishes
// marked out" rather than claiming it did something to a section that was
// already entirely out.
async function setCategoryItemsAvailable(lodgeId, categoryId, isAvailable) {
  const pool = await getPool();

  const category = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, categoryId)
    .query('SELECT id, name FROM dbo.menu_categories WHERE id = @categoryId AND lodge_id = @lodgeId');
  if (category.recordset.length === 0) {
    throw new ApiError('Menu section not found.', 404);
  }

  // is_available is matched on its previous value so the count is of dishes
  // that moved, not of dishes in the section.
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, categoryId)
    .input('isAvailable', sql.Bit, isAvailable)
    .query(`
      UPDATE dbo.menu_items
      SET is_available = @isAvailable
      OUTPUT inserted.id
      WHERE lodge_id = @lodgeId AND category_id = @categoryId
        AND is_available <> @isAvailable
    `);

  return { changed: result.recordset.length, name: category.recordset[0].name };
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
    .query('SELECT id, image_filename FROM dbo.menu_items WHERE id = @itemId AND lodge_id = @lodgeId');
  if (existing.recordset.length === 0) {
    throw new ApiError('Menu item not found.', 404);
  }
  const { image_filename: imageFilename } = existing.recordset[0];

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction)
      .input('itemId', sql.BigInt, itemId)
      .query('UPDATE dbo.food_order_items SET menu_item_id = NULL WHERE menu_item_id = @itemId');

    // The portion rows go with the dish, so the lines that pointed at them
    // lose their soft link the same way they lose menu_item_id — the label and
    // the price they were charged stay snapshotted on the line either way.
    await new sql.Request(transaction)
      .input('itemId', sql.BigInt, itemId)
      .query(`
        UPDATE dbo.food_order_items SET menu_item_portion_id = NULL
        WHERE menu_item_portion_id IN (SELECT id FROM dbo.menu_item_portions WHERE item_id = @itemId)
      `);

    // What the dish was made of has to go before the rows it names do — the
    // recipe points at both this item and its sizes with real foreign keys.
    await inventoryService.deleteItemRecipes(transaction, itemId);

    await new sql.Request(transaction)
      .input('itemId', sql.BigInt, itemId)
      .query('DELETE FROM dbo.menu_item_portions WHERE item_id = @itemId');

    await new sql.Request(transaction)
      .input('itemId', sql.BigInt, itemId)
      .query('DELETE FROM dbo.menu_items WHERE id = @itemId');

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  // After the commit, never before: a rolled-back delete must leave the dish
  // and its photo exactly as they were.
  removeMenuImage(imageFilename);
}

// ---------------------------------------------------------------------------
// Portions
// ---------------------------------------------------------------------------

// A dish's sizes are saved as the complete list they should end up as, so an
// empty list is the way back to a single-price dish. Rows are replaced rather
// than diffed, so a size gets a new id every time anything on the dish is
// saved. Order lines don't care — they keep their own snapshot of the label and
// the price they charged.
//
// Recipes do care, and are carried across by label rather than by id: a size
// that was only re-priced keeps its ingredients, a size that was renamed loses
// them. See detachPortionRecipes in inventory.service.js.
async function setItemPortions(lodgeId, itemId, input) {
  const pool = await getPool();

  const item = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('itemId', sql.BigInt, itemId)
    .query('SELECT id FROM dbo.menu_items WHERE id = @itemId AND lodge_id = @lodgeId');
  if (item.recordset.length === 0) {
    throw new ApiError('Menu item not found.', 404);
  }

  const seen = new Set();
  for (const portion of input.portions) {
    const key = portion.label.trim().toLowerCase();
    if (seen.has(key)) {
      throw new ApiError(`This dish already has a size called “${portion.label}”.`, 409);
    }
    seen.add(key);
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    // Order lines keep the label and price they were charged, so all they lose
    // here is the soft link back to a row that is about to be replaced.
    await new sql.Request(transaction)
      .input('itemId', sql.BigInt, itemId)
      .query(`
        UPDATE dbo.food_order_items SET menu_item_portion_id = NULL
        WHERE menu_item_portion_id IN (SELECT id FROM dbo.menu_item_portions WHERE item_id = @itemId)
      `);

    // Lifted out against the label each was written for, so they can be put
    // back on the far side of the replace. Dish-level lines aren't touched:
    // they don't name a size, so nothing about them changes here.
    const detachedRecipes = await inventoryService.detachPortionRecipes(transaction, itemId);

    await new sql.Request(transaction)
      .input('itemId', sql.BigInt, itemId)
      .query('DELETE FROM dbo.menu_item_portions WHERE item_id = @itemId');

    for (const [index, portion] of input.portions.entries()) {
      await new sql.Request(transaction)
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('itemId', sql.BigInt, itemId)
        .input('label', sql.NVarChar, portion.label.trim())
        .input('price', sql.Decimal(10, 2), portion.price)
        .input('isAvailable', sql.Bit, portion.isAvailable !== false)
        .input('sortOrder', sql.Int, index)
        .query(`
          INSERT INTO dbo.menu_item_portions (lodge_id, item_id, label, price, is_available, sort_order)
          VALUES (@lodgeId, @itemId, @label, @price, @isAvailable, @sortOrder)
        `);
    }

    await inventoryService.reattachPortionRecipes(transaction, lodgeId, itemId, detachedRecipes);

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  return { id: itemId };
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
  setCategoryItemsAvailable,
  setItemActive,
  deleteItem,
  setItemPortions,
  getFoodSettings,
  updateFoodSettings,
};
