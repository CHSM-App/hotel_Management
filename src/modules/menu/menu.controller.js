const fs = require('fs');
const {
  createMenuCategorySchema,
  updateMenuCategorySchema,
  createMenuItemSchema,
  updateMenuItemSchema,
  itemPortionsSchema,
  availabilitySchema,
  statusSchema,
  foodSettingsSchema,
} = require('./menu.schema');
const menuService = require('./menu.service');
const { ApiError } = require('../../middleware/errorHandler');

function parse(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // Only the first path segment: the form has one control per top-level
    // field, so a nested failure like portions.2.price belongs on the portions
    // block — there is no input named "2" to point at.
    throw new ApiError(issue.message, 400, issue.path[0] ? String(issue.path[0]) : null);
  }
  return parsed.data;
}

async function getMenuHandler(req, res, next) {
  try {
    const sections = await menuService.getMenu(req.user.lodgeId);
    res.json({ sections });
  } catch (err) {
    next(err);
  }
}

async function createCategoryHandler(req, res, next) {
  try {
    const result = await menuService.createCategory(req.user.lodgeId, parse(createMenuCategorySchema, req.body));
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function updateCategoryHandler(req, res, next) {
  try {
    const result = await menuService.updateCategory(
      req.user.lodgeId,
      Number(req.params.id),
      parse(updateMenuCategorySchema, req.body)
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function updateCategoryStatusHandler(req, res, next) {
  try {
    const { isActive } = parse(statusSchema, req.body);
    const result = await menuService.setCategoryActive(req.user.lodgeId, Number(req.params.id), isActive);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// Carries the kitchen's permission as well as the owner's, same as the
// single-item toggle it wraps — see menu.routes.js.
async function updateCategoryAvailabilityHandler(req, res, next) {
  try {
    const { isAvailable } = parse(availabilitySchema, req.body);
    const result = await menuService.setCategoryItemsAvailable(
      req.user.lodgeId,
      Number(req.params.id),
      isAvailable
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function deleteCategoryHandler(req, res, next) {
  try {
    await menuService.deleteCategory(req.user.lodgeId, Number(req.params.id));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

// A dish photo that arrived on a request that then failed. Multer has already
// written it to disk by the time the handler runs, so a rejected save would
// otherwise leave the file behind with nothing pointing at it.
function discardUpload(req) {
  if (req.file) fs.unlink(req.file.path, () => {});
}

async function createItemHandler(req, res, next) {
  try {
    const result = await menuService.createItem(req.user.lodgeId, {
      ...parse(createMenuItemSchema, req.body),
      imageFilename: req.file ? req.file.filename : null,
    });
    res.status(201).json(result);
  } catch (err) {
    discardUpload(req);
    next(err);
  }
}

async function updateItemHandler(req, res, next) {
  try {
    const result = await menuService.updateItem(req.user.lodgeId, Number(req.params.id), {
      ...parse(updateMenuItemSchema, req.body),
      imageFilename: req.file ? req.file.filename : null,
    });
    res.json(result);
  } catch (err) {
    discardUpload(req);
    next(err);
  }
}

async function updateItemAvailabilityHandler(req, res, next) {
  try {
    const { isAvailable } = parse(availabilitySchema, req.body);
    const result = await menuService.setItemAvailable(req.user.lodgeId, Number(req.params.id), isAvailable);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function updateItemStatusHandler(req, res, next) {
  try {
    const { isActive } = parse(statusSchema, req.body);
    const result = await menuService.setItemActive(req.user.lodgeId, Number(req.params.id), isActive);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function deleteItemHandler(req, res, next) {
  try {
    await menuService.deleteItem(req.user.lodgeId, Number(req.params.id));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

async function getFoodSettingsHandler(req, res, next) {
  try {
    const settings = await menuService.getFoodSettings(req.user.lodgeId);
    res.json({ settings });
  } catch (err) {
    next(err);
  }
}

async function updateFoodSettingsHandler(req, res, next) {
  try {
    const settings = await menuService.updateFoodSettings(req.user.lodgeId, parse(foodSettingsSchema, req.body));
    res.json({ settings });
  } catch (err) {
    next(err);
  }
}

async function updateItemPortionsHandler(req, res, next) {
  try {
    const result = await menuService.setItemPortions(
      req.user.lodgeId,
      Number(req.params.id),
      parse(itemPortionsSchema, req.body)
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getMenuHandler,
  updateItemPortionsHandler,
  createCategoryHandler,
  updateCategoryHandler,
  updateCategoryStatusHandler,
  updateCategoryAvailabilityHandler,
  deleteCategoryHandler,
  createItemHandler,
  updateItemHandler,
  updateItemAvailabilityHandler,
  updateItemStatusHandler,
  deleteItemHandler,
  getFoodSettingsHandler,
  updateFoodSettingsHandler,
};
