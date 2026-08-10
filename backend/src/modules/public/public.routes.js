const { Router } = require('express');
const { pinAttemptLimiter } = require('../../middleware/rateLimit');
const {
  getLodgePageHandler,
  getMenuPageHandler,
  getTableOrderPageHandler,
  placeRoomOrderHandler,
  placeTableOrderHandler,
  getOrderStatusHandler,
} = require('./public.controller');

const router = Router();

// No authenticate/requireRole anywhere in this file — these are the
// customer-facing surfaces, reached by anyone with the lodge's public link or a
// QR code off a table. What guards each one is described at the service it
// calls: a room order needs the PIN issued at check-in (rate limited, and the
// room locks after repeated failures), a table order waits for the kitchen to
// accept it.
//
// There is deliberately no per-room GET here. Ordering is one link for the
// whole property now, and an endpoint that reported whether a given room could
// order would tell anyone holding that link which rooms are occupied.
router.get('/lodges/:slug', getLodgePageHandler);

router.get('/lodges/:slug/menu', getMenuPageHandler);
router.post('/lodges/:slug/orders', pinAttemptLimiter, placeRoomOrderHandler);

// No PIN limiter on the table route: a table order has no secret to guess, and
// throttling it by IP would punish a restaurant whose diners all sit behind one
// NATed guest network. Table orders are guarded by the kitchen having to accept
// them before anything is cooked.
router.get('/tables/:token', getTableOrderPageHandler);
router.post('/tables/:token/orders', placeTableOrderHandler);

// One status route for both, keyed on the opaque token returned at placement.
router.get('/orders/:token', getOrderStatusHandler);

module.exports = router;
