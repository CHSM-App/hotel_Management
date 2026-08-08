const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const {
  listCategoriesHandler,
  createCategoryHandler,
  updateCategoryHandler,
  updateCategoryStatusHandler,
  deleteCategoryHandler,
} = require('./categories.controller');

const router = Router();

router.get('/', authenticate, requirePermission('rooms.manage'), listCategoriesHandler);
router.post('/', authenticate, requirePermission('rooms.manage'), createCategoryHandler);
router.patch('/:id', authenticate, requirePermission('rooms.manage'), updateCategoryHandler);
router.patch('/:id/status', authenticate, requirePermission('rooms.manage'), updateCategoryStatusHandler);
router.delete('/:id', authenticate, requirePermission('rooms.manage'), deleteCategoryHandler);

module.exports = router;
