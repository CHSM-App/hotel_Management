// A request the app may send twice must not happen twice.
//
// The desk app saves what it does while offline and replays it when the network
// is back. A request can reach this server, be completed, and have its reply
// lost on the way back — the app then cannot know, and sends it again. For a
// check-in or a bill the state guards refuse the repeat; for a new booking they
// do not, and a second copy would take another booking number.
//
// So the app sends `Idempotency-Key: <uuid>` with each such request, and this
// remembers the answer: a repeat of a key that finished gets the same answer
// back without doing the work again, and a repeat of one still running is told
// to wait. Only successful answers are remembered — a request the server
// refused did nothing, so asking again is a new question.
//
// In memory, per process. That covers the failure it exists for (a lost reply,
// retried minutes later) and needs no migration. It does not survive a server
// restart, and it is wrong if there are ever several server processes.
// ponytail: a dbo.idempotency_keys table when the server restarts mid-request
// matters or a second process appears; the key and the replay logic stay the same.
//
// Fails open: no key, a malformed one, or no signed-in user means the request
// simply goes through as it always has.

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 5000;
const KEY_RE = /^[A-Za-z0-9-]{8,64}$/;

const seen = new Map();

function prune(now) {
  for (const [k, v] of seen) {
    if (now - v.at > TTL_MS) seen.delete(k);
  }
  // Oldest first (Map keeps insertion order), so a flood cannot grow it forever.
  while (seen.size > MAX_ENTRIES) seen.delete(seen.keys().next().value);
}

function idempotent(req, res, next) {
  const key = req.get('Idempotency-Key');
  const lodgeId = req.user?.lodgeId;
  if (!key || !KEY_RE.test(key) || lodgeId == null) return next();

  const now = Date.now();
  prune(now);
  const id = `${lodgeId}:${key}`;
  const hit = seen.get(id);

  if (hit?.state === 'done') {
    res.set('Idempotent-Replay', 'true');
    return res.status(hit.status).json(hit.body);
  }
  if (hit?.state === 'pending') {
    return res
      .status(409)
      .json({ success: false, error: 'This request is still being processed. Try again in a moment.', code: 'IN_PROGRESS' });
  }

  seen.set(id, { state: 'pending', at: now });

  let captured;
  const json = res.json.bind(res);
  res.json = (body) => {
    captured = body;
    return json(body);
  };
  res.on('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      seen.set(id, { state: 'done', status: res.statusCode, body: captured, at: Date.now() });
    } else {
      seen.delete(id);
    }
  });
  // The connection dropped before an answer was written: nothing was recorded.
  res.on('close', () => {
    if (seen.get(id)?.state === 'pending') seen.delete(id);
  });
  return next();
}

module.exports = { idempotent, _seen: seen };
