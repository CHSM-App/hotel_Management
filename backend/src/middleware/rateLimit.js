const { ApiError } = require('./errorHandler');

// A sliding-window limiter held in memory. Deliberately not a dependency: the
// whole thing is thirty lines, and the durable half of the PIN defence lives in
// dbo.food_pin_lockouts where reception can see and clear it.
//
// What this adds on top of that table is breadth. The per-room lockout stops
// someone hammering one room; this stops them sweeping every room in the
// property at one guess each, which the per-room counter would never notice.
//
// Trade-offs, stated because they matter at deploy time:
//   - State is per process and resets on restart. Fine for the single-process
//     deployment this runs in; if it ever runs multiple workers, this becomes a
//     per-worker limit and wants moving to the database or Redis.
//   - Behind a reverse proxy, every request carries the proxy's IP unless
//     `app.set('trust proxy', ...)` is configured. Without it this limiter sees
//     one client and throttles the whole property — see app.js.
// `countWhen` decides which responses consume budget, and defaults to all of
// them. The PIN limiter passes a predicate so that only *rejected* attempts are
// charged — see the note on why that matters below.
function createRateLimiter({ windowMs, max, message, countWhen = () => true }) {
  const hits = new Map();

  // Sweeping on write keeps this from growing without bound. There's no timer,
  // so an idle process holds nothing and nothing keeps the event loop alive.
  function sweep(now) {
    for (const [key, timestamps] of hits) {
      const live = timestamps.filter((t) => now - t < windowMs);
      if (live.length === 0) hits.delete(key);
      else hits.set(key, live);
    }
  }

  return function rateLimit(req, res, next) {
    const now = Date.now();
    if (hits.size > 500) sweep(now);

    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const timestamps = (hits.get(key) || []).filter((t) => now - t < windowMs);

    if (timestamps.length >= max) {
      const retryAfterSec = Math.ceil((windowMs - (now - timestamps[0])) / 1000);
      res.set('Retry-After', String(retryAfterSec));
      return next(new ApiError(message, 429));
    }

    // Charged after the fact, once the outcome is known, rather than on the way
    // in — so a guest ordering dinner never spends budget that exists to stop
    // someone guessing PINs.
    res.on('finish', () => {
      if (!countWhen(res)) return;
      const list = (hits.get(key) || []).filter((t) => Date.now() - t < windowMs);
      list.push(Date.now());
      hits.set(key, list);
    });

    next();
  };
}

// Guards the room-ordering endpoint, which is the only public route that checks
// a secret. Counts **only rejected attempts** (401), which is load-bearing
// rather than a nicety: guest Wi-Fi is behind NAT, so on a busy evening every
// diner and every guest in the building shares one public IP. Charging for
// successful orders would let a full restaurant lock itself out — the limit has
// to be reachable only by someone actually guessing.
//
// This is the *second* line of defence and deliberately the looser one. The
// per-room lockout in public.service.js is what makes brute force impractical:
// it caps any single room at 5 guesses per 15 minutes no matter where they come
// from, which is ~20 days to walk a 4-digit PIN. What this adds is a ceiling on
// sweeping many rooms at once from one machine.
//
// Hence 50 rather than something tight. Everyone in the building shares this
// budget, so a low limit hands any guest on the Wi-Fi a way to block food
// ordering for the whole property by failing on purpose. 50 failed attempts in
// 15 minutes is far past anyone fumbling a PIN, while still cutting off a
// script — and the per-room ceiling holds regardless of what happens here.
const pinAttemptLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'Too many failed attempts from this network. Please wait a few minutes, or call the front desk.',
  countWhen: (res) => res.statusCode === 401,
});

module.exports = { createRateLimiter, pinAttemptLimiter };
