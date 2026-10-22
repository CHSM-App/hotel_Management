const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const { listEnquiriesHandler, summaryHandler, updateEnquiryHandler } = require('./enquiries.controller');

const router = Router();

const canManage = requirePermission('enquiries.manage');

router.get('/', authenticate, canManage, listEnquiriesHandler);
// Before /:id so "summary" isn't read as an id.
router.get('/summary', authenticate, canManage, summaryHandler);
router.patch('/:id', authenticate, canManage, updateEnquiryHandler);

module.exports = router;
