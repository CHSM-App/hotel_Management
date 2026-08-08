const { Router } = require('express');
const { getLodgePageHandler } = require('./public.controller');

const router = Router();

// No authenticate/requireRole here — this is the customer-facing brochure
// page, reached by anyone with the lodge's public link.
router.get('/lodges/:slug', getLodgePageHandler);

module.exports = router;
