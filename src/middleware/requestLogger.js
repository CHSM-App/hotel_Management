const crypto = require('crypto');
const pinoHttp = require('pino-http');
const { logger } = require('../config/logger');

// One log line per request, carrying who made it.
//
// The "who" is the point. An access log of paths and status codes says the
// system was used; it does not say who voided the invoice. req.user is set by
// the authenticate middleware, so by the time a response finishes this can name
// the acting account — and because it reads req.user at *serialise* time rather
// than on the way in, it works for every route without each one opting in.
//
// This is the application-side half of the audit story. The database triggers
// in config/audit.sql record what changed at the row level; this records the
// request that caused it, including the ones that changed nothing because they
// were rejected. Neither replaces the other: a 403 leaves no trace in the
// database, and a direct edit in SSMS leaves none here.

// Correlates every line belonging to one request, and is returned to the client
// so a user reporting "it failed at 3pm" hands you the exact identifier.
function requestId(req) {
  // Honour an id from the proxy when there is one, so a trace spans the whole
  // path rather than restarting at this process.
  const existing = req.headers['x-request-id'];
  if (typeof existing === 'string' && /^[\w-]{1,64}$/.test(existing)) return existing;
  return crypto.randomUUID();
}

const requestLogger = pinoHttp({
  logger,
  genReqId: requestId,

  // Health checks are the majority of traffic on a monitored deployment and
  // say nothing. Silencing them at 200 keeps the log readable, while a failing
  // health check still logs at warn — which is the case anyone cares about.
  autoLogging: {
    ignore: (req) => req.url === '/health/live' || req.url === '/health',
  },

  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    // 4xx is the client being told no. Worth seeing, not worth alerting on —
    // except 401 and 403, which in bulk are what an attack looks like.
    if (res.statusCode === 401 || res.statusCode === 403) return 'warn';
    if (res.statusCode >= 400) return 'info';
    return 'info';
  },

  customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
  customErrorMessage: (req, res, err) => `${req.method} ${req.url} ${res.statusCode} — ${err.message}`,

  // What each line carries. Deliberately narrow: enough to reconstruct who did
  // what from where, and nothing more. Request bodies are never logged — they
  // hold guest names, phone numbers and ID proof references, and a body that
  // must be inspected can be recovered from the audit trail instead.
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.url,
        // req.ip is only the real client when trust proxy is configured — see
        // app.js. Behind an unconfigured proxy this is the proxy's address.
        ip: req.raw?.ip ?? req.ip,
        // The acting user, read off the verified JWT. Absent on public and
        // unauthenticated routes, which is itself informative.
        userId: req.raw?.user?.sub ?? null,
        role: req.raw?.user?.role ?? null,
        lodgeId: req.raw?.user?.lodgeId ?? null,
      };
    },
    res(res) {
      return { statusCode: res.statusCode };
    },
    // Message and stack only. The full driver error object is what carried SQL
    // and bound parameters into the log; see config/logger.js.
    err(err) {
      return {
        type: err.name,
        message: err.message,
        stack: err.stack,
        statusCode: err.statusCode,
        // mssql surfaces the useful part of a DB failure here, and it is a
        // short code rather than anything containing data.
        code: err.code,
      };
    },
  },
});

module.exports = { requestLogger };
