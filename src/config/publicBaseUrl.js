const { ApiError } = require('../middleware/errorHandler');

// The address guests reach this site at from their own phones — not the LAN
// address the desk's browser uses, and not derivable from a request: behind
// a proxy, Host is whatever the proxy was asked for, so a guest-facing link
// built from it can point somewhere a phone on mobile data cannot reach.
// Configured instead, once, here.
//
// Extracted out of billShare.service.js (its original, only caller) once a
// second feature — the post-checkout feedback link — needed the exact same
// thing: same env var, same trailing-slash trim, same 503 when it's unset.
function publicBaseUrl() {
  const base = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!base) {
    throw new ApiError(
      'This feature needs PUBLIC_BASE_URL set to the address guests reach this site at.',
      503
    );
  }
  return base;
}

module.exports = { publicBaseUrl };
