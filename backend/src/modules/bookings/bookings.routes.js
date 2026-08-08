const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const { idProofUpload } = require('../../middleware/idProofUpload');
const {
  listAvailableRoomsHandler,
  listAvailableRoomsForBookingHandler,
  listBookingsHandler,
  priceQuoteHandler,
  getTapeChartHandler,
  getBookingHandler,
  getIdProofHandler,
  getGuestIdProofHandler,
  createBookingHandler,
  checkInHandler,
  updateBookingHandler,
  checkOutHandler,
  cancelBookingHandler,
} = require('./bookings.controller');

const router = Router();

const staff = requirePermission('bookings.manage');
// The guest & ID register reads this same list, so a role granted only
// guests.view can reach it without being able to touch the tape chart.
const canSeeRegister = requirePermission('bookings.manage', 'guests.view');

router.get('/', authenticate, canSeeRegister, listBookingsHandler);
router.get('/available-rooms', authenticate, staff, listAvailableRoomsHandler);
router.get('/price-quote', authenticate, staff, priceQuoteHandler);
router.get('/tape-chart', authenticate, staff, getTapeChartHandler);
router.get('/:id', authenticate, staff, getBookingHandler);
router.get('/:id/available-rooms', authenticate, staff, listAvailableRoomsForBookingHandler);
router.get('/:id/id-proof', authenticate, canSeeRegister, getIdProofHandler);
router.get('/:id/guests/:guestId/id-proof', authenticate, canSeeRegister, getGuestIdProofHandler);
router.post('/', authenticate, staff, idProofUpload, createBookingHandler);
router.patch('/:id', authenticate, staff, updateBookingHandler);
router.patch('/:id/check-in', authenticate, staff, idProofUpload, checkInHandler);
router.patch('/:id/check-out', authenticate, staff, checkOutHandler);
router.patch('/:id/cancel', authenticate, staff, cancelBookingHandler);

module.exports = router;
