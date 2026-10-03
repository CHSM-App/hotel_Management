const pino = require('pino');

// Structured logging, replacing the four console calls the backend had.
//
// The thing this buys that console never did is the ability to answer a
// question after the fact. "Who voided that invoice?" and "what was the app
// doing when it fell over at 9pm?" both need records that carry a user, a
// request id and a timestamp, and that can be searched — not lines of prose
// interleaved from a dozen requests at once.
//
// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------
//
// This is the part to be careful with, and the reason the log goes through one
// module rather than being called ad hoc.
//
// The old errorHandler did `console.error(err)` on any 500. For an mssql driver
// error that object carries the failing statement and its bound parameters —
// which on this system means guest names, phone numbers and ID proof
// references, written into a file that is not rotated and not access
// controlled. The HTTP response was always sanitised; the log was not.
//
// So: an explicit allowlist of paths that are blanked wherever they appear.
// pino applies these to every log call, so a future caller cannot accidentally
// bypass them by logging a whole request or a whole error.
const REDACT_PATHS = [
  // Credentials, in every shape they arrive in.
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.newPassword',
  'req.body.currentPassword',
  'password',
  'newPassword',
  'currentPassword',
  'password_hash',
  'passwordHash',
  'token',
  'jwt',
  '*.password',
  '*.password_hash',
  '*.token',

  // The guest food PIN. Low value on its own, but it is the secret that
  // authorises room orders, and it appears in request bodies.
  'req.body.pin',
  'pin',
  'food_pin',
  '*.pin',
  '*.food_pin',

  // The one-time code that authorises a password change. It arrives in a
  // request body and is stored hashed, so the log is the one place it could
  // otherwise survive in clear — next to the account it belongs to.
  'req.body.otp',
  'otp',
  'otp_hash',
  '*.otp',
  '*.otp_hash',

  // Driver internals that carry query text and bound parameter values. This is
  // the specific leak described above.
  'err.precedingErrors',
  'err.originalError.info',
  'error.precedingErrors',
  'error.originalError.info',
];

const isProduction = process.env.NODE_ENV === 'production';

// Development gets human-readable lines on one line each; production gets JSON,
// which is what any log aggregator or `jq` expects. pino-pretty is deliberately
// not a dependency — it is a dev nicety that would otherwise ship to the
// server, and the JSON is perfectly readable when something goes wrong locally.
const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  redact: {
    paths: REDACT_PATHS,
    censor: '[redacted]',
    // Missing paths are ignored rather than erroring, which matters because
    // most of these appear on only a few of the objects logged.
    remove: false,
  },
  // ISO timestamps rather than epoch milliseconds: these get read by people.
  timestamp: pino.stdTimeFunctions.isoTime,
  base: { pid: process.pid },
  formatters: {
    // "level":"info" rather than "level":30. Costs nothing and stops every
    // reader having to memorise pino's numeric levels.
    level: (label) => ({ level: label }),
  },
});

module.exports = { logger, REDACT_PATHS };
