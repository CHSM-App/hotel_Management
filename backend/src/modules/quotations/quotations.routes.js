const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const { createHandler, listHandler, getHandler, updateHandler, deleteHandler, shareHandler, shareWhatsAppHandler } = require('./quotations.controller');
const { quotationShareUpload } = require('../../middleware/quotationShareUpload');

const router = Router();

// The Quotation tool sits on the Room Chart, so the front desk (bookings.manage)
// uses it as much as the owner (rooms.manage) — same pair /pricing/simulate takes.
// Events, food and bar quotations ride the same routes: the gate lets in anyone who holds a
// permission for some kind, and the handlers check the kind they touch (see KIND_PERMISSIONS).
const { KIND_PERMISSIONS } = require('./quotations.service');
const canQuote = requirePermission(...new Set(Object.values(KIND_PERMISSIONS).flat()));

router.post('/', authenticate, canQuote, createHandler);
router.get('/', authenticate, canQuote, listHandler);
router.get('/:id', authenticate, canQuote, getHandler);
router.patch('/:id', authenticate, canQuote, updateHandler);
router.post('/:id/share', authenticate, canQuote, quotationShareUpload, shareHandler);
router.post('/:id/share/whatsapp', authenticate, canQuote, quotationShareUpload, shareWhatsAppHandler);
router.delete('/:id', authenticate, canQuote, deleteHandler);

module.exports = router;
