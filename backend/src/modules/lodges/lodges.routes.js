const { Router } = require('express');
const { authenticate, requireRole } = require('../../middleware/authenticate');
const { createLodgeHandler, listLodgesHandler, getLodgeHandler } = require('./lodges.controller');

const router = Router();

// SUPERADMIN only — this is the internal, unlinked lodge management flow.
router.get('/', authenticate, requireRole('SUPERADMIN'), listLodgesHandler);
router.post('/', authenticate, requireRole('SUPERADMIN'), createLodgeHandler);
router.get('/:id', authenticate, requireRole('SUPERADMIN'), getLodgeHandler);

module.exports = router;
