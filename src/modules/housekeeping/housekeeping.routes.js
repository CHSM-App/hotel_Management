const { Router } = require('express');
const { authenticate, requirePermission, requireCapability } = require('../../middleware/authenticate');
const c = require('./housekeeping.controller');

const router = Router();

// Two add-ons share this module and are switched on separately: room cleaning
// (lodges.has_housekeeping) and laundry (lodges.has_laundry). Reception and the
// owner already hold bookings.manage / rooms.manage, so they can use both
// without any role being edited; the Housekeeping role holds
// housekeeping.manage and the Laundry role laundry.manage.
const enabled = requireCapability('hasHousekeeping');
const desk = requirePermission('housekeeping.manage', 'bookings.manage', 'rooms.manage');
const laundry = requireCapability('hasLaundry');
const laundryDesk = requirePermission('laundry.manage', 'bookings.manage', 'rooms.manage');
// A cleaner counts the linen changed in a room, so reading the list is open to
// housekeeping too. Everything that moves linen needs laundryDesk.
const linenReader = requirePermission('laundry.manage', 'housekeeping.manage', 'bookings.manage', 'rooms.manage');
// Guest laundry bills through Other services, so it needs that add-on too.
const guestLaundry = requireCapability('hasOtherServices');

router.get('/rooms', authenticate, enabled, desk, c.listRooms);
router.post('/rooms/:id/start', authenticate, enabled, desk, c.startCleaning);
router.post('/rooms/:id/release', authenticate, enabled, desk, c.releaseRoom);
router.post('/rooms/:id/done', authenticate, enabled, desk, c.finishCleaning);
router.post('/rooms/:id/dirty', authenticate, enabled, desk, c.markDirty);
router.post('/rooms/:id/out-of-order', authenticate, enabled, desk, c.setOutOfOrder);

// Event venues on the same board. Reading the list is also open to the events
// desk, which shows a venue's state when a function is being booked; changing
// anything stays with housekeeping and the front desk.
const venueReader = requirePermission('housekeeping.manage', 'bookings.manage', 'rooms.manage', 'events.manage');
router.get('/venues', authenticate, enabled, venueReader, c.listVenues);
router.post('/venues/:id/start', authenticate, enabled, desk, c.startVenueCleaning);
router.post('/venues/:id/release', authenticate, enabled, desk, c.releaseVenue);
router.post('/venues/:id/done', authenticate, enabled, desk, c.finishVenueCleaning);
router.post('/venues/:id/dirty', authenticate, enabled, desk, c.markVenueDirty);
router.post('/venues/:id/out-of-order', authenticate, enabled, desk, c.setVenueOutOfOrder);

// What cleaners reported when finishing a room: problems and found items. The
// desk sees them here and closes them; /count feeds its badge and alert.
router.get('/issues', authenticate, enabled, desk, c.listIssues);
router.get('/issues/count', authenticate, enabled, desk, c.openIssueSummary);
router.post('/issues/:id/close', authenticate, enabled, desk, c.closeIssue);

router.get('/linen', authenticate, laundry, linenReader, c.listLinen);
router.post('/linen/items', authenticate, laundry, laundryDesk, c.createLinenItem);
router.patch('/linen/items/:id', authenticate, laundry, laundryDesk, c.updateLinenItem);
// Linen changed in rooms, handed over by housekeeping and received here.
router.post('/linen/handovers/receive', authenticate, laundry, laundryDesk, c.receiveHandovers);
router.post('/linen/send', authenticate, laundry, laundryDesk, c.sendToLaundry);
router.post('/linen/receive', authenticate, laundry, laundryDesk, c.receiveFromLaundry);
router.post('/linen/loss', authenticate, laundry, laundryDesk, c.recordLoss);

// Garments and prices used on earlier orders, so the form can offer them again.
router.get('/laundry/garments', authenticate, laundry, guestLaundry, laundryDesk, c.listRecentGarments);
router.get('/laundry/in-house', authenticate, laundry, guestLaundry, laundryDesk, c.listInHouse);
router.get('/laundry/orders', authenticate, laundry, guestLaundry, laundryDesk, c.listLaundryOrders);
router.post('/laundry/orders', authenticate, laundry, guestLaundry, laundryDesk, c.createLaundryOrder);
router.post('/laundry/orders/:id/status', authenticate, laundry, guestLaundry, laundryDesk, c.setLaundryStatus);

module.exports = router;
