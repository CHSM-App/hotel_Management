const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const { getBootstrap } = require('./sync.service');

const router = Router();

// Anyone who can take a booking can run the desk offline, so anyone who can
// take a booking can download what that needs.
router.get('/bootstrap', authenticate, requirePermission('bookings.manage'), async (req, res, next) => {
  try {
    res.json(await getBootstrap(req.user.lodgeId));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
