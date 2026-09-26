const { Router } = require('express');
const { authenticate, requireRole } = require('../../middleware/authenticate');
const { logoUpload } = require('../../middleware/logoUpload');
const {
  createLodgeHandler,
  listLodgesHandler,
  getLodgeHandler,
  updateLodgeHandler,
  updateLodgeLogoHandler,
  removeLodgeLogoHandler,
  importLodgeMenuHandler,
} = require('./lodges.controller');

const router = Router();

// SUPERADMIN only — this is the internal, unlinked lodge management flow.
router.get('/', authenticate, requireRole('SUPERADMIN'), listLodgesHandler);
router.post('/', authenticate, requireRole('SUPERADMIN'), createLodgeHandler);
router.get('/:id', authenticate, requireRole('SUPERADMIN'), getLodgeHandler);
router.patch('/:id', authenticate, requireRole('SUPERADMIN'), updateLodgeHandler);
router.put('/:id/logo', authenticate, requireRole('SUPERADMIN'), logoUpload, updateLodgeLogoHandler);
router.delete('/:id/logo', authenticate, requireRole('SUPERADMIN'), removeLodgeLogoHandler);

// Same spreadsheet import a lodge owner has on their own menu screen, run here
// against whichever lodge id is in the URL — see importLodgeMenuHandler.
router.post('/:id/menu/import', authenticate, requireRole('SUPERADMIN'), importLodgeMenuHandler);

module.exports = router;
