const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const { normaliseFoodType } = require('../menu/menu.schema');

// DECIMAL(12,3) in the schema, so every quantity that leaves JavaScript rounds
// to the same place the column would round it to. Doing it here rather than
// letting the driver truncate keeps the number the caller is told about equal
// to the number that was stored.
function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function mapMaterial(row) {
  const quantity = Number(row.quantity);
  const threshold = Number(row.low_stock_threshold);
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    category: row.category || 'OTHER',
    quantity,
    lowStockThreshold: threshold,
    isActive: !!row.is_active,
    // Worked out here so the screen, the low-stock count and any future alert
    // all agree on what "running out" means instead of each re-deriving it.
    // Negative is its own state: it isn't "low", it's "the count is wrong".
    isNegative: quantity < 0,
    isLow: quantity >= 0 && threshold > 0 && quantity <= threshold,
    usedByDishes: row.used_by_dishes ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Raw materials
// ---------------------------------------------------------------------------

async function listMaterials(lodgeId, { includeInactive = true } = {}) {
  const pool = await getPool();

  // The dish count is what makes "delete" explainable — an owner who can't
  // remove a material is told how many dishes are holding on to it.
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT m.id, m.name, m.unit, m.category, m.quantity, m.low_stock_threshold, m.is_active,
             (SELECT COUNT(DISTINCT r.item_id) FROM dbo.menu_item_recipes r WHERE r.material_id = m.id) AS used_by_dishes
      FROM dbo.raw_materials m
      WHERE m.lodge_id = @lodgeId ${includeInactive ? '' : 'AND m.is_active = 1'}
      ORDER BY m.name ASC
    `);

  return result.recordset.map(mapMaterial);
}

async function getMaterial(lodgeId, materialId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('materialId', sql.BigInt, materialId)
    .query(`
      SELECT m.id, m.name, m.unit, m.category, m.quantity, m.low_stock_threshold, m.is_active,
             (SELECT COUNT(DISTINCT r.item_id) FROM dbo.menu_item_recipes r WHERE r.material_id = m.id) AS used_by_dishes
      FROM dbo.raw_materials m
      WHERE m.id = @materialId AND m.lodge_id = @lodgeId
    `);

  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('Raw material not found.', 404);
  }
  return mapMaterial(row);
}

async function createMaterial(lodgeId, input, userId) {
  const pool = await getPool();

  const existing = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, input.name)
    .query('SELECT id FROM dbo.raw_materials WHERE lodge_id = @lodgeId AND name = @name');
  if (existing.recordset.length > 0) {
    throw new ApiError('A raw material with that name already exists.', 409, 'name');
  }

  const opening = round3(input.quantity);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('name', sql.NVarChar, input.name)
      .input('unit', sql.NVarChar, input.unit)
      .input('category', sql.NVarChar, input.category)
      .input('quantity', sql.Decimal(12, 3), opening)
      .input('lowStockThreshold', sql.Decimal(12, 3), round3(input.lowStockThreshold))
      .query(`
        INSERT INTO dbo.raw_materials (lodge_id, name, unit, category, quantity, low_stock_threshold)
        OUTPUT inserted.id
        VALUES (@lodgeId, @name, @unit, @category, @quantity, @lowStockThreshold)
      `);

    const materialId = result.recordset[0].id;

    // An opening count is a movement like any other. Without this row the
    // ledger for a material would start mid-story and never add up to the
    // quantity sitting on the row.
    if (opening !== 0) {
      await writeMovement(new sql.Request(transaction), {
        lodgeId,
        materialId,
        changeQty: opening,
        balanceAfter: opening,
        reason: 'OPENING',
        note: 'Opening stock',
        createdBy: userId,
      });
    }

    await transaction.commit();
    return { id: materialId };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function updateMaterial(lodgeId, materialId, input) {
  const pool = await getPool();

  const conflict = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, input.name)
    .input('materialId', sql.BigInt, materialId)
    .query('SELECT id FROM dbo.raw_materials WHERE lodge_id = @lodgeId AND name = @name AND id <> @materialId');
  if (conflict.recordset.length > 0) {
    throw new ApiError('A raw material with that name already exists.', 409, 'name');
  }

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('materialId', sql.BigInt, materialId)
    .input('name', sql.NVarChar, input.name)
    .input('category', sql.NVarChar, input.category)
    .input('lowStockThreshold', sql.Decimal(12, 3), round3(input.lowStockThreshold))
    .query(`
      UPDATE dbo.raw_materials
      SET name = @name, category = @category, low_stock_threshold = @lowStockThreshold
      OUTPUT inserted.id
      WHERE id = @materialId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Raw material not found.', 404);
  }

  return getMaterial(lodgeId, materialId);
}

// Retiring rather than deleting: the material stops being offered when a recipe
// is edited, but every movement written against it still reads correctly. This
// is the answer for anything that has history, which after the first purchase
// is everything.
async function setMaterialActive(lodgeId, materialId, isActive) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('materialId', sql.BigInt, materialId)
    .input('isActive', sql.Bit, isActive)
    .query(`
      UPDATE dbo.raw_materials SET is_active = @isActive
      OUTPUT inserted.id
      WHERE id = @materialId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Raw material not found.', 404);
  }
  return getMaterial(lodgeId, materialId);
}

// A real delete, for a material added by mistake. Refused while any dish still
// lists it, because that would quietly stop those dishes deducting anything —
// the failure would show up weeks later as stock that never moves.
//
// The movement rows go with it. They only ever describe this one material, and
// a ledger for something that no longer exists answers no question anyone asks.
async function deleteMaterial(lodgeId, materialId) {
  const pool = await getPool();

  const material = await getMaterial(lodgeId, materialId);
  if (material.usedByDishes > 0) {
    throw new ApiError(
      `“${material.name}” is used by ${material.usedByDishes} ${
        material.usedByDishes === 1 ? 'dish' : 'dishes'
      }. Remove it from them first, or retire it instead.`,
      409
    );
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction)
      .input('materialId', sql.BigInt, materialId)
      .query('DELETE FROM dbo.stock_movements WHERE material_id = @materialId');

    await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('materialId', sql.BigInt, materialId)
      .query('DELETE FROM dbo.raw_materials WHERE id = @materialId AND lodge_id = @lodgeId');

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Stock movements
// ---------------------------------------------------------------------------

// Every path that moves stock writes one of these, so the ledger is complete by
// construction rather than by everyone remembering to log. Takes a Request
// rather than making one: the caller is always inside a transaction that the
// movement has to share, or the quantity and its explanation could part ways.
async function writeMovement(request, { lodgeId, materialId, changeQty, balanceAfter, reason, orderId, orderItemId, note, createdBy }) {
  await request
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('materialId', sql.BigInt, materialId)
    .input('changeQty', sql.Decimal(12, 3), round3(changeQty))
    .input('balanceAfter', sql.Decimal(12, 3), round3(balanceAfter))
    .input('reason', sql.NVarChar, reason)
    .input('orderId', sql.BigInt, orderId ?? null)
    .input('orderItemId', sql.BigInt, orderItemId ?? null)
    .input('note', sql.NVarChar, note || null)
    .input('createdBy', sql.BigInt, createdBy ?? null)
    .query(`
      INSERT INTO dbo.stock_movements
        (lodge_id, material_id, change_qty, balance_after, reason, order_id, order_item_id, note, created_by)
      VALUES
        (@lodgeId, @materialId, @changeQty, @balanceAfter, @reason, @orderId, @orderItemId, @note, @createdBy)
    `);
}

// Moves one material by a signed amount and returns where it landed. The
// balance is read back out of the UPDATE rather than selected first and added
// to: two cooks tick dishes off at the same second, and a read-then-write would
// lose one of them.
async function moveStock(request, lodgeId, materialId, changeQty) {
  const result = await request
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('materialId', sql.BigInt, materialId)
    .input('changeQty', sql.Decimal(12, 3), round3(changeQty))
    .query(`
      UPDATE dbo.raw_materials
      SET quantity = quantity + @changeQty
      OUTPUT inserted.quantity AS balance_after
      WHERE id = @materialId AND lodge_id = @lodgeId
    `);

  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('Raw material not found.', 404);
  }
  return Number(row.balance_after);
}

// Stock arriving, or a shelf count that disagrees with the book. SET works out
// its own delta from the live quantity inside the transaction, so correcting to
// a counted total is safe even if an order deducts from the same material
// between the screen loading and the button being pressed.
async function adjustStock(lodgeId, materialId, input, userId) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    let changeQty;

    if (input.mode === 'SET') {
      const currentResult = await new sql.Request(transaction)
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('materialId', sql.BigInt, materialId)
        .query(`
          SELECT quantity FROM dbo.raw_materials WITH (UPDLOCK, ROWLOCK)
          WHERE id = @materialId AND lodge_id = @lodgeId
        `);
      const current = currentResult.recordset[0];
      if (!current) {
        throw new ApiError('Raw material not found.', 404);
      }
      changeQty = round3(input.quantity - Number(current.quantity));
    } else {
      changeQty = round3(input.quantity);
    }

    // A recount that agrees with the book is a real answer, and writing a zero
    // row for it would only pad the ledger.
    if (changeQty !== 0) {
      const balanceAfter = await moveStock(new sql.Request(transaction), lodgeId, materialId, changeQty);
      await writeMovement(new sql.Request(transaction), {
        lodgeId,
        materialId,
        changeQty,
        balanceAfter,
        // ADD is stock arriving; SET is the book being corrected to the shelf.
        // Kept apart so a purchase total can be read off the ledger later
        // without a recount being counted as a delivery.
        reason: input.mode === 'ADD' ? 'PURCHASE' : 'ADJUSTMENT',
        note: input.note,
        createdBy: userId,
      });
    }

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  return getMaterial(lodgeId, materialId);
}

function mapMovement(row) {
  return {
    id: row.id,
    materialId: row.material_id,
    materialName: row.material_name,
    unit: row.unit,
    changeQty: Number(row.change_qty),
    balanceAfter: Number(row.balance_after),
    reason: row.reason,
    orderId: row.order_id,
    orderNumber: row.order_number ?? null,
    itemName: row.item_name ?? null,
    note: row.note,
    byName: row.by_name ?? null,
    createdAt: row.created_at,
  };
}

async function listMovements(lodgeId, { materialId, limit = 100 } = {}) {
  const pool = await getPool();

  const request = pool.request().input('lodgeId', sql.BigInt, lodgeId).input('limit', sql.Int, limit);
  let materialFilter = '';
  if (materialId) {
    request.input('materialId', sql.BigInt, materialId);
    materialFilter = 'AND s.material_id = @materialId';
  }

  const result = await request.query(`
    SELECT TOP (@limit)
           s.id, s.material_id, s.change_qty, s.balance_after, s.reason, s.order_id,
           s.note, s.created_at,
           m.name AS material_name, m.unit,
           o.order_number, oi.item_name, u.name AS by_name
    FROM dbo.stock_movements s
    JOIN dbo.raw_materials m ON m.id = s.material_id
    LEFT JOIN dbo.food_orders o ON o.id = s.order_id
    LEFT JOIN dbo.food_order_items oi ON oi.id = s.order_item_id
    LEFT JOIN dbo.users u ON u.id = s.created_by
    WHERE s.lodge_id = @lodgeId ${materialFilter}
    ORDER BY s.id DESC
  `);

  return result.recordset.map(mapMovement);
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

// One dish with its sizes and its ingredient lines — everything the recipe
// editor needs in a single call, so it never has to cross-reference the menu
// response to find out which sizes it should be offering.
async function getItemRecipe(lodgeId, itemId) {
  const pool = await getPool();

  const itemResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('itemId', sql.BigInt, itemId)
    .query(`
      SELECT id, name, food_type FROM dbo.menu_items
      WHERE id = @itemId AND lodge_id = @lodgeId
    `);
  const item = itemResult.recordset[0];
  if (!item) {
    throw new ApiError('Menu item not found.', 404);
  }

  const portionsResult = await pool
    .request()
    .input('itemId', sql.BigInt, itemId)
    .query(`
      SELECT id, label FROM dbo.menu_item_portions
      WHERE item_id = @itemId ORDER BY sort_order ASC, id ASC
    `);

  const linesResult = await pool
    .request()
    .input('itemId', sql.BigInt, itemId)
    .query(`
      SELECT r.id, r.portion_id, r.material_id, r.quantity, m.name AS material_name, m.unit
      FROM dbo.menu_item_recipes r
      JOIN dbo.raw_materials m ON m.id = r.material_id
      WHERE r.item_id = @itemId
      ORDER BY r.portion_id ASC, m.name ASC
    `);

  return {
    itemId: item.id,
    name: item.name,
    foodType: normaliseFoodType(item.food_type),
    portions: portionsResult.recordset.map((row) => ({ id: row.id, label: row.label })),
    lines: linesResult.recordset.map((row) => ({
      id: row.id,
      portionId: row.portion_id ?? null,
      materialId: row.material_id,
      materialName: row.material_name,
      unit: row.unit,
      quantity: Number(row.quantity),
    })),
  };
}

// Which dishes have been described and which haven't. The gap matters more than
// the detail: a dish with no recipe deducts nothing when it's cooked, silently,
// and this is the only place that fact is visible.
async function listRecipeSummary(lodgeId) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT i.id, i.name, i.category_id, i.food_type, i.is_active,
             c.name AS category_name,
             (SELECT COUNT(*) FROM dbo.menu_item_portions p WHERE p.item_id = i.id) AS portion_count,
             (SELECT COUNT(*) FROM dbo.menu_item_recipes r WHERE r.item_id = i.id) AS line_count,
             (SELECT COUNT(DISTINCT r.portion_id) FROM dbo.menu_item_recipes r
               WHERE r.item_id = i.id AND r.portion_id IS NOT NULL) AS sized_count,
             (SELECT COUNT(*) FROM dbo.menu_item_recipes r
               WHERE r.item_id = i.id AND r.portion_id IS NULL) AS shared_count
      FROM dbo.menu_items i
      JOIN dbo.menu_categories c ON c.id = i.category_id
      WHERE i.lodge_id = @lodgeId
      ORDER BY c.sort_order ASC, c.name ASC, i.sort_order ASC, i.name ASC
    `);

  return result.recordset.map((row) => ({
    itemId: row.id,
    name: row.name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    foodType: normaliseFoodType(row.food_type),
    isActive: !!row.is_active,
    portionCount: row.portion_count,
    lineCount: row.line_count,
    // A dish with sizes and only dish-level lines is fine — the same recipe is
    // used for every size. What's flagged is a dish with sizes where *some*
    // sizes were described and others were left with nothing to fall back on.
    partialSizes:
      row.portion_count > 0 && row.shared_count === 0 && row.sized_count > 0 && row.sized_count < row.portion_count,
  }));
}

// Saved as the complete ingredient list the dish should end up with, so
// removing a line is sending it without that line. Same replace-don't-diff rule
// as the portions editor, and for the same reason: the editor holds the whole
// list on screen anyway.
async function setItemRecipe(lodgeId, itemId, input) {
  const pool = await getPool();

  const itemResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('itemId', sql.BigInt, itemId)
    .query('SELECT id, name FROM dbo.menu_items WHERE id = @itemId AND lodge_id = @lodgeId');
  const item = itemResult.recordset[0];
  if (!item) {
    throw new ApiError('Menu item not found.', 404);
  }

  const lines = input.lines;

  if (lines.length > 0) {
    // A portion id from another dish would otherwise write a recipe line that
    // can never be reached, because resolution only ever looks at this dish's
    // sizes. Checked against the dish rather than the lodge for that reason.
    const portionResult = await pool
      .request()
      .input('itemId', sql.BigInt, itemId)
      .query('SELECT id FROM dbo.menu_item_portions WHERE item_id = @itemId');
    const validPortions = new Set(portionResult.recordset.map((row) => String(row.id)));

    const materialIds = [...new Set(lines.map((l) => l.materialId))];
    const materialRequest = pool.request().input('lodgeId', sql.BigInt, lodgeId);
    materialIds.forEach((id, index) => materialRequest.input(`m${index}`, sql.BigInt, id));
    const materialResult = await materialRequest.query(`
      SELECT id, name FROM dbo.raw_materials
      WHERE lodge_id = @lodgeId AND id IN (${materialIds.map((_, i) => `@m${i}`).join(', ')})
    `);
    const validMaterials = new Map(materialResult.recordset.map((row) => [String(row.id), row.name]));

    const seen = new Set();
    for (const line of lines) {
      if (line.portionId !== null && !validPortions.has(String(line.portionId))) {
        throw new ApiError('One of those sizes is no longer on this dish. Reopen the recipe and try again.', 409);
      }
      if (!validMaterials.has(String(line.materialId))) {
        throw new ApiError('One of those raw materials no longer exists. Reopen the recipe and try again.', 409);
      }

      // The unique constraint would catch this, but as a duplicate-key error
      // that names a constraint rather than the ingredient the owner typed
      // twice.
      const key = `${line.portionId ?? 'all'}:${line.materialId}`;
      if (seen.has(key)) {
        throw new ApiError(`“${validMaterials.get(String(line.materialId))}” is listed twice for the same size.`, 409);
      }
      seen.add(key);
    }
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction)
      .input('itemId', sql.BigInt, itemId)
      .query('DELETE FROM dbo.menu_item_recipes WHERE item_id = @itemId');

    for (const line of lines) {
      await new sql.Request(transaction)
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('itemId', sql.BigInt, itemId)
        .input('portionId', sql.BigInt, line.portionId ?? null)
        .input('materialId', sql.BigInt, line.materialId)
        .input('quantity', sql.Decimal(12, 3), round3(line.quantity))
        .query(`
          INSERT INTO dbo.menu_item_recipes (lodge_id, item_id, portion_id, material_id, quantity)
          VALUES (@lodgeId, @itemId, @portionId, @materialId, @quantity)
        `);
    }

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  return getItemRecipe(lodgeId, itemId);
}

// ---------------------------------------------------------------------------
// Consumption
// ---------------------------------------------------------------------------

// The ingredient lines that apply to one cooked dish, in one query.
//
// The rule is "the size's own lines if this size has any, otherwise the dish's
// shared lines". The NOT EXISTS is what makes the fallback exclusive: without
// it a dish described both ways would deduct twice over.
//
// ORDER BY material_id is not cosmetic. Two cooks ticking off dishes that share
// ingredients take locks on the same rows, and taking them in a consistent
// order across every caller is what stops the pair deadlocking.
async function resolveRecipeLines(request, itemId, portionId) {
  const result = await request
    .input('itemId', sql.BigInt, itemId)
    .input('portionId', sql.BigInt, portionId ?? null)
    .query(`
      SELECT r.material_id, r.quantity, m.name AS material_name, m.unit
      FROM dbo.menu_item_recipes r
      JOIN dbo.raw_materials m ON m.id = r.material_id
      WHERE r.item_id = @itemId
        AND (
          (@portionId IS NOT NULL AND r.portion_id = @portionId)
          OR (
            r.portion_id IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM dbo.menu_item_recipes r2
              WHERE r2.item_id = @itemId AND r2.portion_id = @portionId
            )
          )
        )
      ORDER BY r.material_id ASC
    `);

  return result.recordset;
}

// Deducts (or gives back) everything one order line eats, and writes the ledger
// rows that explain it. Called from orders.service the moment a cook ticks a
// dish off, inside that tick's own transaction — the stock move and the tick
// have to land together or a crash between them would leave the kitchen screen
// disagreeing with the shelf.
//
// Callers guarantee this runs once per tick: the UPDATE that sets ready_at is
// guarded on its previous value, so a double-tap moves no rows and never
// reaches here. That guard is the whole idempotency story, which is why there
// is no second one on this side.
//
// Never throws for want of stock. A dish being ticked off has already been
// cooked, so refusing here would only leave the screen lying about the kitchen;
// the shortfall is recorded as a negative balance and surfaced to the owner.
async function applyOrderItemStock(transaction, lodgeId, { orderId, orderItemId, reverse = false, userId = null }) {
  const lineResult = await new sql.Request(transaction)
    .input('orderItemId', sql.BigInt, orderItemId)
    .query(`
      SELECT menu_item_id, menu_item_portion_id, quantity
      FROM dbo.food_order_items WHERE id = @orderItemId
    `);
  const line = lineResult.recordset[0];

  // The dish was deleted from the menu after the order was placed, which nulls
  // the soft link. Nothing left to say what it was made of.
  if (!line || line.menu_item_id == null) {
    return [];
  }

  const recipeLines = await resolveRecipeLines(
    new sql.Request(transaction),
    line.menu_item_id,
    line.menu_item_portion_id
  );
  if (recipeLines.length === 0) {
    return [];
  }

  const sign = reverse ? 1 : -1;
  const moved = [];

  for (const recipe of recipeLines) {
    const changeQty = round3(sign * Number(recipe.quantity) * line.quantity);
    const balanceAfter = await moveStock(new sql.Request(transaction), lodgeId, recipe.material_id, changeQty);

    await writeMovement(new sql.Request(transaction), {
      lodgeId,
      materialId: recipe.material_id,
      changeQty,
      balanceAfter,
      reason: reverse ? 'REVERSAL' : 'CONSUMPTION',
      orderId,
      orderItemId,
      createdBy: userId,
    });

    moved.push({
      materialId: recipe.material_id,
      materialName: recipe.material_name,
      unit: recipe.unit,
      changeQty,
      balanceAfter,
    });
  }

  return moved;
}

// ---------------------------------------------------------------------------
// Keeping recipes attached across a portions edit
// ---------------------------------------------------------------------------

// setItemPortions replaces a dish's sizes wholesale, so their ids change every
// time a price is edited. These two are what stop that quietly wiping the
// recipe: the lines are lifted out against their size's *label* before the
// rows go, and put back against whatever id that label ends up with.
//
// A size that was renamed has no label to come back to and loses its lines,
// which is the same thing that happens to everything else keyed on a size's
// label. A size that was only re-priced keeps them.
async function detachPortionRecipes(transaction, itemId) {
  const result = await new sql.Request(transaction)
    .input('itemId', sql.BigInt, itemId)
    .query(`
      SELECT p.label, r.material_id, r.quantity
      FROM dbo.menu_item_recipes r
      JOIN dbo.menu_item_portions p ON p.id = r.portion_id
      WHERE r.item_id = @itemId AND r.portion_id IS NOT NULL
    `);

  if (result.recordset.length > 0) {
    await new sql.Request(transaction)
      .input('itemId', sql.BigInt, itemId)
      .query('DELETE FROM dbo.menu_item_recipes WHERE item_id = @itemId AND portion_id IS NOT NULL');
  }

  return result.recordset.map((row) => ({
    label: row.label,
    materialId: row.material_id,
    quantity: Number(row.quantity),
  }));
}

async function reattachPortionRecipes(transaction, lodgeId, itemId, detached) {
  if (detached.length === 0) {
    return;
  }

  const portionResult = await new sql.Request(transaction)
    .input('itemId', sql.BigInt, itemId)
    .query('SELECT id, label FROM dbo.menu_item_portions WHERE item_id = @itemId');
  const idByLabel = new Map(portionResult.recordset.map((row) => [row.label, row.id]));

  for (const line of detached) {
    const portionId = idByLabel.get(line.label);
    if (portionId == null) {
      continue;
    }
    await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('itemId', sql.BigInt, itemId)
      .input('portionId', sql.BigInt, portionId)
      .input('materialId', sql.BigInt, line.materialId)
      .input('quantity', sql.Decimal(12, 3), round3(line.quantity))
      .query(`
        INSERT INTO dbo.menu_item_recipes (lodge_id, item_id, portion_id, material_id, quantity)
        VALUES (@lodgeId, @itemId, @portionId, @materialId, @quantity)
      `);
  }
}

// A dish being deleted takes its recipe with it. Called from inside
// menu.service's delete transaction, before the rows it points at go.
async function deleteItemRecipes(transaction, itemId) {
  await new sql.Request(transaction)
    .input('itemId', sql.BigInt, itemId)
    .query('DELETE FROM dbo.menu_item_recipes WHERE item_id = @itemId');
}

module.exports = {
  listMaterials,
  getMaterial,
  createMaterial,
  updateMaterial,
  setMaterialActive,
  deleteMaterial,
  adjustStock,
  listMovements,
  getItemRecipe,
  listRecipeSummary,
  setItemRecipe,
  applyOrderItemStock,
  detachPortionRecipes,
  reattachPortionRecipes,
  deleteItemRecipes,
};
