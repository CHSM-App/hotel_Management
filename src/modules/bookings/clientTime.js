const { ApiError } = require('../../middleware/errorHandler');

// When a guest really arrived or left, as the device that was there recorded it.
//
// The desk app keeps working with no network and sends what it did when the
// connection is back — maybe hours later. Stamping the server's clock then
// would record a guest as leaving at the moment their bill reached this server,
// not when they walked out, and would misstate the late-checkout minutes that
// follow from it. So the check-in, check-out and invoice endpoints accept the
// moment the action happened.
//
// A device clock is not trusted blindly. A time further ahead than a few
// minutes of drift cannot have happened yet, and one more than 30 days old is
// not a desk working offline for a while but something else (a wrong clock, a
// replayed request) and is refused with a plain message.
//
// Sent as an ISO instant ("2026-11-17T08:10:00.000Z"). A string with no offset
// would be read in the server's own zone, so the app always sends UTC.

const FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function parseClientTime(raw, label = 'The time', now = Date.now()) {
  if (raw == null || raw === '') return null;
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) {
    throw new ApiError(`${label} is not a valid date and time.`, 400);
  }
  if (at.getTime() > now + FUTURE_SKEW_MS) {
    throw new ApiError(`${label} is in the future — check the clock on the device.`, 400);
  }
  if (at.getTime() < now - MAX_AGE_MS) {
    throw new ApiError(`${label} is more than 30 days old.`, 400);
  }
  return at;
}

module.exports = { parseClientTime, FUTURE_SKEW_MS, MAX_AGE_MS };
