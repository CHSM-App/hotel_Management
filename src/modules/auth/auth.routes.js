const { Router } = require('express');
const {
  loginHandler,
  adminLoginHandler,
  refreshHandler,
  sendForgotPasswordOtpHandler,
  forgotPasswordHandler,
  sendAdminForgotPasswordOtpHandler,
  adminForgotPasswordHandler,
} = require('./auth.controller');
const { authenticate } = require('../../middleware/authenticate');
const {
  loginAttemptLimiter,
  adminLoginAttemptLimiter,
  forgotPasswordOtpSendLimiter,
  forgotPasswordLimiter,
  adminForgotPasswordOtpSendLimiter,
  adminForgotPasswordLimiter,
  refreshLimiter,
} = require('../../middleware/rateLimit');

const router = Router();

// Both doors are rate limited on failed attempts only, so a busy shift change
// never spends budget and a password guesser always does. The admin door gets
// the tighter budget — it opens every property, not one. See rateLimit.js.
router.post('/login', loginAttemptLimiter, loginHandler);
router.post('/admin-login', adminLoginAttemptLimiter, adminLoginHandler);

// Trades a still-valid token for a fresh one, 8 hours out from now. Behind
// `authenticate`, so an already-expired token can't use this to get back in —
// only an active session can extend itself. Rate limited too, so a stolen
// token can't be replayed in a loop.
router.post('/refresh', refreshLimiter, authenticate, refreshHandler);

// Forgot-password, split the same way /me/password is: the first sends a
// code to the account's own phone, the second spends it. Knowing a phone or
// email is no longer enough on its own to reset that account's password —
// see auth.service.js.
router.post('/forgot-password/send-otp', forgotPasswordOtpSendLimiter, sendForgotPasswordOtpHandler);
router.post('/forgot-password', forgotPasswordLimiter, forgotPasswordHandler);

// Same split, for the SUPERADMIN door — see auth.service.js's
// sendAdminForgotPasswordOtp/resetAdminPasswordByIdentifier. Its own limiters
// so a busy night on the lodge side never spends the admin door's budget.
router.post('/admin-forgot-password/send-otp', adminForgotPasswordOtpSendLimiter, sendAdminForgotPasswordOtpHandler);
router.post('/admin-forgot-password', adminForgotPasswordLimiter, adminForgotPasswordHandler);

module.exports = router;
