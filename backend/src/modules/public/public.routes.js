const { Router } = require('express');
const { pinAttemptLimiter } = require('../../middleware/rateLimit');
const {
  getLodgePageHandler,
  getMenuPageHandler,
  getTableOrderPageHandler,
  openSessionHandler,
  listGuestOrdersHandler,
  updateGuestOrderHandler,
  cancelGuestOrderHandler,
  placeRoomOrderHandler,
  placeTableOrderHandler,
  getOrderStatusHandler,
  getSharedBillHandler,
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

// The guest side of a stay's food. Every one of these carries the room number
// and PIN in its body and is checked afresh — there is still no session issued
// here, only a phone that remembers the pair and re-sends it. So every one gets
// the same limiter as placement: they are all PIN attempts, and a route that
// only *reads* would otherwise be the cheap way to guess.
//
// /session exists so a wrong PIN is caught at sign-in rather than at the end of
// a cart the guest has spent five minutes filling.
router.post('/lodges/:slug/session', pinAttemptLimiter, openSessionHandler);
router.post('/lodges/:slug/my-orders', pinAttemptLimiter, listGuestOrdersHandler);
router.patch('/lodges/:slug/orders/:token', pinAttemptLimiter, updateGuestOrderHandler);
// POST rather than DELETE: cancelling is a status the order keeps, not a row
// that goes away, and the identity has to travel in a body.
router.post('/lodges/:slug/orders/:token/cancel', pinAttemptLimiter, cancelGuestOrderHandler);

// No PIN limiter on the table route: a table order has no secret to guess, and
// throttling it by IP would punish a restaurant whose diners all sit behind one
// NATed guest network. Table orders are guarded by the kitchen having to accept
// them before anything is cooked.
router.get('/tables/:token', getTableOrderPageHandler);
router.post('/tables/:token/orders', placeTableOrderHandler);

// One status route for both, keyed on the opaque token returned at placement.
router.get('/orders/:token', getOrderStatusHandler);

// A bill the desk sent to a guest on WhatsApp. Unauthenticated like everything
// else here, and for the same kind of reason: the guest has no account, and the
// random token in the link they were sent is the whole of the credential.
//
// Not rate limited, unlike the PIN routes above. There is no secret to guess at
// a useful rate — the token is 32 hex characters — and a guest re-opening their
// own bill from a chat several times is ordinary, not an attack.
router.get('/bills/:token', getSharedBillHandler);

module.exports = router;
