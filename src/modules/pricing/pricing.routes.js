const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const { simulateHandler } = require('./pricing.controller');

const router = Router();

router.get('/simulate', authenticate, requirePermission('rooms.manage'), simulateHandler);

module.exports = router;
