const { Router } = require('express');
const { authenticate, requireLodgeUser } = require('../../middleware/authenticate');
const { otpSendLimiter } = require('../../middleware/rateLimit');
const { getMeHandler, sendPasswordOtpHandler, changePasswordHandler } = require('./me.controller');

const router = Router();

// Any lodge login, whatever its role — SUPERADMIN has no lodge_id, so this
// route doesn't apply to them.
const staff = requireLodgeUser;

router.get('/', authenticate, staff, getMeHandler);

// Changing a password is two requests, not one: this sends a code to the
// account's own phone, and the PATCH below spends it. Splitting them is what
// makes the code a second factor — a session alone can no longer change the
// password it is signed in with. See me.service.js.
router.post('/password/otp', authenticate, staff, otpSendLimiter, sendPasswordOtpHandler);
router.patch('/password', authenticate, staff, changePasswordHandler);

module.exports = router;
