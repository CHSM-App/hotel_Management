const { Router } = require('express');
const { authenticate, requireLodgeUser, requireRole } = require('../../middleware/authenticate');
const { otpSendLimiter } = require('../../middleware/rateLimit');
const { logoUpload } = require('../../middleware/logoUpload');
const {
  getMeHandler,
  sendPasswordOtpHandler,
  changePasswordHandler,
  updateMyLodgeHandler,
  updateMyLodgeLogoHandler,
  removeMyLodgeLogoHandler,
} = require('./me.controller');

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

// The property's own contact/location details, edited from the profile menu.
// Owner-only rather than gated by a permission key: this isn't a section a
// lodge-defined role is ever handed, it's the account holder correcting their
// own listing.
router.patch('/lodge', authenticate, requireRole('OWNER'), updateMyLodgeHandler);

// The property's logo — a separate multipart endpoint from the JSON PATCH
// above, matching the room/venue image upload pattern.
router.put('/lodge/logo', authenticate, requireRole('OWNER'), logoUpload, updateMyLodgeLogoHandler);
router.delete('/lodge/logo', authenticate, requireRole('OWNER'), removeMyLodgeLogoHandler);

module.exports = router;
