const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const {
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
} = require('./inventory.controller');

const router = Router();

// Inventory rides on food.manage rather than a permission of its own. It is the
// same job as building the menu — deciding what the kitchen sells and what goes
// into it — and a new permission would have to be back-filled onto every role
// every lodge has already customised.
//
// Reading is widened to orders.manage. The kitchen is the side that watches
// stock run down during service, and the store cupboard is not a secret from
// the people cooking out of it. Writing stays with food.manage: a recount is
// the owner's call, and the kitchen already moves stock by cooking.
const canRead = requirePermission('food.manage', 'orders.manage');
const canWrite = requirePermission('food.manage');

router.get('/materials', authenticate, canRead, listMaterialsHandler);
router.post('/materials', authenticate, canWrite, createMaterialHandler);
router.patch('/materials/:id', authenticate, canWrite, updateMaterialHandler);
router.patch('/materials/:id/status', authenticate, canWrite, updateMaterialStatusHandler);
router.delete('/materials/:id', authenticate, canWrite, deleteMaterialHandler);

// Stock arriving, or the book being corrected to a shelf count. Separate from
// the material's own fields because it writes a ledger row and they don't.
router.post('/materials/:id/adjust', authenticate, canWrite, adjustStockHandler);

router.get('/movements', authenticate, canRead, listMovementsHandler);

router.get('/recipes', authenticate, canRead, listRecipesHandler);
router.get('/recipes/:itemId', authenticate, canRead, getItemRecipeHandler);
router.put('/recipes/:itemId', authenticate, canWrite, setItemRecipeHandler);

module.exports = router;
