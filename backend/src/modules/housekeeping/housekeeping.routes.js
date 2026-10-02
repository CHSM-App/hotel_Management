const { Router } = require('express');
const { authenticate, requirePermission, requireCapability } = require('../../middleware/authenticate');
const c = require('./housekeeping.controller');

const router = Router();

// Only properties with the add-on on (lodges.has_housekeeping). Reception and
// the owner already hold bookings.manage / rooms.manage, so they can use it
// without any role being edited; the Housekeeping role holds housekeeping.manage.
const enabled = requireCapability('hasHousekeeping');
const desk = requirePermission('housekeeping.manage', 'bookings.manage', 'rooms.manage');
// Guest laundry bills through Other services, so it needs that add-on too.
const guestLaundry = requireCapability('hasOtherServices');

router.get('/rooms', authenticate, enabled, desk, c.listRooms);
router.post('/rooms/:id/start', authenticate, enabled, desk, c.startCleaning);
router.post('/rooms/:id/release', authenticate, enabled, desk, c.releaseRoom);
router.post('/rooms/:id/done', authenticate, enabled, desk, c.finishCleaning);
router.post('/rooms/:id/dirty', authenticate, enabled, desk, c.markDirty);
router.post('/rooms/:id/out-of-order', authenticate, enabled, desk, c.setOutOfOrder);

router.get('/linen', authenticate, enabled, desk, c.listLinen);
router.post('/linen/items', authenticate, enabled, desk, c.createLinenItem);
router.patch('/linen/items/:id', authenticate, enabled, desk, c.updateLinenItem);
router.post('/linen/send', authenticate, enabled, desk, c.sendToLaundry);
router.post('/linen/receive', authenticate, enabled, desk, c.receiveFromLaundry);
router.post('/linen/loss', authenticate, enabled, desk, c.recordLoss);

// Garments and prices used on earlier orders, so the form can offer them again.
router.get('/laundry/garments', authenticate, enabled, guestLaundry, desk, c.listRecentGarments);
router.get('/laundry/in-house', authenticate, enabled, guestLaundry, desk, c.listInHouse);
router.get('/laundry/orders', authenticate, enabled, guestLaundry, desk, c.listLaundryOrders);
router.post('/laundry/orders', authenticate, enabled, guestLaundry, desk, c.createLaundryOrder);
router.post('/laundry/orders/:id/status', authenticate, enabled, guestLaundry, desk, c.setLaundryStatus);

module.exports = router;
