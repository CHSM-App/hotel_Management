const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const { idProofUpload } = require('../../middleware/idProofUpload');
const {
  listAvailableRoomsHandler,
  listAvailableRoomsForBookingHandler,
  listBookingsHandler,
  searchGuestsHandler,
  priceQuoteHandler,
  getTapeChartHandler,
  getBookingHandler,
  getIdProofHandler,
  getGuestIdProofHandler,
  createBookingHandler,
  checkInHandler,
  updateBookingHandler,
  getLateCheckoutHandler,
  checkOutHandler,
  cancelBookingHandler,
  listDraftsHandler,
  getDraftHandler,
  createDraftHandler,
  updateDraftHandler,
  deleteDraftHandler,
} = require('./bookings.controller');

const router = Router();

const staff = requirePermission('bookings.manage');
// The guest & ID register reads this same list, so a role granted only
// guests.view can reach it without being able to touch the tape chart.
const canSeeRegister = requirePermission('bookings.manage', 'guests.view');

router.get('/', authenticate, canSeeRegister, listBookingsHandler);
// Ahead of /:id, or "drafts" is parsed as a booking id.
router.get('/drafts', authenticate, staff, listDraftsHandler);
router.post('/drafts', authenticate, staff, createDraftHandler);
router.get('/drafts/:id', authenticate, staff, getDraftHandler);
router.put('/drafts/:id', authenticate, staff, updateDraftHandler);
router.delete('/drafts/:id', authenticate, staff, deleteDraftHandler);
// Answers the same question the register does — who has stayed here — so it
// takes the same permission, and reveals nothing a register reader can't
// already page through.
router.get('/guest-search', authenticate, canSeeRegister, searchGuestsHandler);
router.get('/available-rooms', authenticate, staff, listAvailableRoomsHandler);
router.get('/price-quote', authenticate, staff, priceQuoteHandler);
router.get('/tape-chart', authenticate, staff, getTapeChartHandler);
router.get('/:id', authenticate, staff, getBookingHandler);
router.get('/:id/available-rooms', authenticate, staff, listAvailableRoomsForBookingHandler);
router.get('/:id/late-checkout', authenticate, staff, getLateCheckoutHandler);
router.get('/:id/id-proof', authenticate, canSeeRegister, getIdProofHandler);
router.get('/:id/guests/:guestId/id-proof', authenticate, canSeeRegister, getGuestIdProofHandler);
router.post('/', authenticate, staff, idProofUpload, createBookingHandler);
router.patch('/:id', authenticate, staff, idProofUpload, updateBookingHandler);
router.patch('/:id/check-in', authenticate, staff, idProofUpload, checkInHandler);
router.patch('/:id/check-out', authenticate, staff, checkOutHandler);
router.patch('/:id/cancel', authenticate, staff, cancelBookingHandler);

module.exports = router;
