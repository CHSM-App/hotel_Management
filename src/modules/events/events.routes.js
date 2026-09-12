const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const { venueImageUpload } = require('../../middleware/venueImageUpload');
const {
  listVenuesHandler,
  createVenueHandler,
  updateVenueHandler,
  deleteVenueImageHandler,
  listAddonsHandler,
  createAddonHandler,
  updateAddonHandler,
  availabilityHandler,
  quoteHandler,
  listEventsHandler,
  getEventHandler,
  createEventHandler,
  updateEventHandler,
  addExtraHandler,
  priceExtraHandler,
  removeExtraHandler,
  holdEventHandler,
  confirmEventHandler,
  releaseEventHandler,
  cancelEventHandler,
} = require('./events.controller');

const router = Router();

// One permission for the whole section, the same granularity as bookings:
// whoever takes a function also sets up the hall it is taken in.
const staff = requirePermission('events.manage');

// Static segments ahead of /:id, or "venues" is parsed as a booking id.
router.get('/venues', authenticate, staff, listVenuesHandler);
// Venue fields may arrive as multipart with up to six photos under "images";
// a plain JSON body (the activate toggle) passes through the upload untouched.
router.post('/venues', authenticate, staff, venueImageUpload, createVenueHandler);
router.patch('/venues/:id', authenticate, staff, venueImageUpload, updateVenueHandler);
router.delete('/venues/:id/images/:imageId', authenticate, staff, deleteVenueImageHandler);

router.get('/addons', authenticate, staff, listAddonsHandler);
router.post('/addons', authenticate, staff, createAddonHandler);
router.patch('/addons/:id', authenticate, staff, updateAddonHandler);

router.get('/availability', authenticate, staff, availabilityHandler);
router.post('/quote', authenticate, staff, quoteHandler);

router.get('/', authenticate, staff, listEventsHandler);
router.post('/', authenticate, staff, createEventHandler);
router.get('/:id', authenticate, staff, getEventHandler);
router.patch('/:id', authenticate, staff, updateEventHandler);
router.post('/:id/extras', authenticate, staff, addExtraHandler);
router.patch('/:id/extras/:lineId', authenticate, staff, priceExtraHandler);
router.delete('/:id/extras/:lineId', authenticate, staff, removeExtraHandler);
router.patch('/:id/hold', authenticate, staff, holdEventHandler);
router.patch('/:id/confirm', authenticate, staff, confirmEventHandler);
router.patch('/:id/release', authenticate, staff, releaseEventHandler);
router.patch('/:id/cancel', authenticate, staff, cancelEventHandler);

module.exports = router;
