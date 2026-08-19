const { Router } = require('express');
const { loginHandler, adminLoginHandler } = require('./auth.controller');
const { loginAttemptLimiter, adminLoginAttemptLimiter } = require('../../middleware/rateLimit');

const router = Router();

// Both doors are rate limited on failed attempts only, so a busy shift change
// never spends budget and a password guesser always does. The admin door gets
// the tighter budget — it opens every property, not one. See rateLimit.js.
router.post('/login', loginAttemptLimiter, loginHandler);
router.post('/admin-login', adminLoginAttemptLimiter, adminLoginHandler);

module.exports = router;
