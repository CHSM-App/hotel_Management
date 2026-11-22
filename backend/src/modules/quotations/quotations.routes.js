const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const { createHandler, listHandler, getHandler, updateHandler, deleteHandler } = require('./quotations.controller');

const router = Router();

// The Quotation tool sits on the Room Chart, so the front desk (bookings.manage)
// uses it as much as the owner (rooms.manage) — same pair /pricing/simulate takes.
const canQuote = requirePermission('rooms.manage', 'bookings.manage');

router.post('/', authenticate, canQuote, createHandler);
router.get('/', authenticate, canQuote, listHandler);
router.get('/:id', authenticate, canQuote, getHandler);
router.patch('/:id', authenticate, canQuote, updateHandler);
router.delete('/:id', authenticate, canQuote, deleteHandler);

module.exports = router;
