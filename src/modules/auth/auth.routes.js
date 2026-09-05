const { Router } = require('express');
const { loginHandler, adminLoginHandler, forgotPasswordHandler } = require('./auth.controller');
const {
  loginAttemptLimiter,
  adminLoginAttemptLimiter,
  forgotPasswordLimiter,
} = require('../../middleware/rateLimit');

const router = Router();

// Both doors are rate limited on failed attempts only, so a busy shift change
// never spends budget and a password guesser always does. The admin door gets
// the tighter budget — it opens every property, not one. See rateLimit.js.
router.post('/login', loginAttemptLimiter, loginHandler);
router.post('/admin-login', adminLoginAttemptLimiter, adminLoginHandler);

// No OTP — resets the password for whoever's phone or email is given. Charged
// on every attempt, not just failures, and backed by the same durable
// per-identifier lockout the login doors use. See auth.service.js.
router.post('/forgot-password', forgotPasswordLimiter, forgotPasswordHandler);

module.exports = router;
