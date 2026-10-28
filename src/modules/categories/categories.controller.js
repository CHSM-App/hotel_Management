const { createCategorySchema, updateCategorySchema, statusSchema } = require('./categories.schema');
const categoriesService = require('./categories.service');
const { ApiError } = require('../../middleware/errorHandler');

async function listCategoriesHandler(req, res, next) {
  try {
    const categories = await categoriesService.listCategories(req.user.lodgeId);
    res.json({ categories });
  } catch (err) {
    next(err);
  }
}

async function createCategoryHandler(req, res, next) {
  try {
    const parsed = createCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }

    const result = await categoriesService.createCategory(req.user.lodgeId, parsed.data);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function updateCategoryHandler(req, res, next) {
  try {
    const parsed = updateCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }

    const result = await categoriesService.updateCategory(req.user.lodgeId, Number(req.params.id), parsed.data);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function updateCategoryStatusHandler(req, res, next) {
  try {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }

    const result = await categoriesService.setCategoryActive(
      req.user.lodgeId,
      Number(req.params.id),
      parsed.data.isActive
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function deleteCategoryHandler(req, res, next) {
  try {
    await categoriesService.deleteCategory(req.user.lodgeId, Number(req.params.id));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listCategoriesHandler,
  createCategoryHandler,
  updateCategoryHandler,
  updateCategoryStatusHandler,
  deleteCategoryHandler,
};
