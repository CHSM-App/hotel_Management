const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const {
  getMenuHandler,
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
  updateItemPortionsHandler,
  getFoodSettingsHandler,
  updateFoodSettingsHandler,
} = require('./menu.controller');

const router = Router();

// Reading the menu is also what the kitchen screen does to render its
// availability switches, so it takes either permission.
router.get('/', authenticate, requirePermission('food.manage', 'orders.manage'), getMenuHandler);

router.get('/settings', authenticate, requirePermission('food.manage'), getFoodSettingsHandler);
router.patch('/settings', authenticate, requirePermission('food.manage'), updateFoodSettingsHandler);

router.post('/categories', authenticate, requirePermission('food.manage'), createCategoryHandler);
router.patch('/categories/:id', authenticate, requirePermission('food.manage'), updateCategoryHandler);
router.patch('/categories/:id/status', authenticate, requirePermission('food.manage'), updateCategoryStatusHandler);

// "The fish is off" — every dish in a section, in one tap. Takes orders.manage
// as well as food.manage for exactly the reason the single-item toggle does:
// it happens mid-service, and the owner isn't always signed in.
router.patch(
  '/categories/:id/availability',
  authenticate,
  requirePermission('food.manage', 'orders.manage'),
  updateCategoryAvailabilityHandler
);
router.delete('/categories/:id', authenticate, requirePermission('food.manage'), deleteCategoryHandler);

router.post('/items', authenticate, requirePermission('food.manage'), createItemHandler);
router.patch('/items/:id', authenticate, requirePermission('food.manage'), updateItemHandler);

// The one menu write the kitchen can make. An item that runs out mid-service
// has to come off the guest's menu immediately, and the owner isn't always
// signed in — so this takes orders.manage as well as food.manage.
router.patch(
  '/items/:id/availability',
  authenticate,
  requirePermission('food.manage', 'orders.manage'),
  updateItemAvailabilityHandler
);

router.patch('/items/:id/status', authenticate, requirePermission('food.manage'), updateItemStatusHandler);
router.delete('/items/:id', authenticate, requirePermission('food.manage'), deleteItemHandler);

// Sizes are menu structure, so they stay on food.manage — the kitchen's one
// write is still the availability toggle and nothing else.
router.put('/items/:id/portions', authenticate, requirePermission('food.manage'), updateItemPortionsHandler);

module.exports = router;
