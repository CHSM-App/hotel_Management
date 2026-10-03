const {
  createMaterialSchema,
  updateMaterialSchema,
  adjustStockSchema,
  itemRecipeSchema,
  statusSchema,
} = require('./inventory.schema');
const inventoryService = require('./inventory.service');
const { ApiError } = require('../../middleware/errorHandler');

function parse(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0].message, 400);
  }
  return parsed.data;
}

async function listMaterialsHandler(req, res, next) {
  try {
    const materials = await inventoryService.listMaterials(req.user.lodgeId, {
      includeInactive: req.query.includeInactive !== 'false',
    });
    res.json({ materials });
  } catch (err) {
    next(err);
  }
}

async function createMaterialHandler(req, res, next) {
  try {
    const result = await inventoryService.createMaterial(
      req.user.lodgeId,
      parse(createMaterialSchema, req.body),
      req.user.sub
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function updateMaterialHandler(req, res, next) {
  try {
    const material = await inventoryService.updateMaterial(
      req.user.lodgeId,
      Number(req.params.id),
      parse(updateMaterialSchema, req.body)
    );
    res.json({ material });
  } catch (err) {
    next(err);
  }
}

async function updateMaterialStatusHandler(req, res, next) {
  try {
    const { isActive } = parse(statusSchema, req.body);
    const material = await inventoryService.setMaterialActive(req.user.lodgeId, Number(req.params.id), isActive);
    res.json({ material });
  } catch (err) {
    next(err);
  }
}

async function deleteMaterialHandler(req, res, next) {
  try {
    await inventoryService.deleteMaterial(req.user.lodgeId, Number(req.params.id));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

async function adjustStockHandler(req, res, next) {
  try {
    const material = await inventoryService.adjustStock(
      req.user.lodgeId,
      Number(req.params.id),
      parse(adjustStockSchema, req.body),
      req.user.sub
    );
    res.json({ material });
  } catch (err) {
    next(err);
  }
}

async function listMovementsHandler(req, res, next) {
  try {
    // Capped rather than rejected: this is a "what happened lately" list, and a
    // silly limit should shorten the answer, not fail the screen.
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const movements = await inventoryService.listMovements(req.user.lodgeId, {
      materialId: req.query.materialId ? Number(req.query.materialId) : null,
      limit,
    });
    res.json({ movements });
  } catch (err) {
    next(err);
  }
}

async function listRecipesHandler(req, res, next) {
  try {
    const dishes = await inventoryService.listRecipeSummary(req.user.lodgeId);
    res.json({ dishes });
  } catch (err) {
    next(err);
  }
}

async function getItemRecipeHandler(req, res, next) {
  try {
    const recipe = await inventoryService.getItemRecipe(req.user.lodgeId, Number(req.params.itemId));
    res.json({ recipe });
  } catch (err) {
    next(err);
  }
}

async function setItemRecipeHandler(req, res, next) {
  try {
    const recipe = await inventoryService.setItemRecipe(
      req.user.lodgeId,
      Number(req.params.itemId),
      parse(itemRecipeSchema, req.body)
    );
    res.json({ recipe });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listMaterialsHandler,
  createMaterialHandler,
  updateMaterialHandler,
  updateMaterialStatusHandler,
  deleteMaterialHandler,
  adjustStockHandler,
  listMovementsHandler,
  listRecipesHandler,
  getItemRecipeHandler,
  setItemRecipeHandler,
};
