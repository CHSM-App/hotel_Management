const { Router } = require('express');
const { authenticate, requireLodgeUser } = require('../../middleware/authenticate');
const { getMeHandler, changePasswordHandler } = require('./me.controller');

const router = Router();

// Any lodge login, whatever its role — SUPERADMIN has no lodge_id, so this
// route doesn't apply to them.
const staff = requireLodgeUser;

router.get('/', authenticate, staff, getMeHandler);
router.patch('/password', authenticate, staff, changePasswordHandler);

module.exports = router;
