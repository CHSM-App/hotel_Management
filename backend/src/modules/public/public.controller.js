const publicService = require('./public.service');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function getLodgePageHandler(req, res, next) {
  try {
    const lodge = await publicService.getLodgeBySlug(String(req.params.slug || ''));

    const checkInDate = String(req.query.checkInDate || '');
    const checkOutDate = String(req.query.checkOutDate || '');
    // Malformed or missing dates just fall back to the plain rate-card view
    // (no availability column) rather than erroring the whole page.
    const hasValidRange =
      DATE_RE.test(checkInDate) && DATE_RE.test(checkOutDate) && checkOutDate > checkInDate;

    const rooms = await publicService.listPublicRooms(
      lodge.id,
      hasValidRange ? checkInDate : null,
      hasValidRange ? checkOutDate : null
    );
    res.json({ lodge, rooms });
  } catch (err) {
    next(err);
  }
}

module.exports = { getLodgePageHandler };
