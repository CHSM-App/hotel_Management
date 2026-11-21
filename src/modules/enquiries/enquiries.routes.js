const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const { listEnquiriesHandler, summaryHandler, catalogueHandler, updateEnquiryHandler } = require('./enquiries.controller');

const router = Router();

const canManage = requirePermission('enquiries.manage');

router.get('/', authenticate, canManage, listEnquiriesHandler);
// Before /:id so "summary"/"catalogue" aren't read as an id — there's no
// GET /:id today, but kept ahead of the PATCH for the same reason.
router.get('/summary', authenticate, canManage, summaryHandler);
router.get('/catalogue', authenticate, canManage, catalogueHandler);
router.patch('/:id', authenticate, canManage, updateEnquiryHandler);

module.exports = router;
