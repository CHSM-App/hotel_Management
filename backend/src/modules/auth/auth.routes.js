const { Router } = require('express');
const { loginHandler, adminLoginHandler } = require('./auth.controller');

const router = Router();

router.post('/login', loginHandler);
router.post('/admin-login', adminLoginHandler);

module.exports = router;
