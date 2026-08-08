const { Router } = require('express');
const { authenticate, requireRole } = require('../../middleware/authenticate');
const { createLodgeHandler, listLodgesHandler } = require('./lodges.controller');

const router = Router();

// SUPERADMIN only — this is the internal, unlinked lodge management flow.
router.get('/', authenticate, requireRole('SUPERADMIN'), listLodgesHandler);
router.post('/', authenticate, requireRole('SUPERADMIN'), createLodgeHandler);

module.exports = router;
