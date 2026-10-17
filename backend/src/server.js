// The .env path is pinned to this file's location rather than left to resolve
// from process.cwd(). Passenger starts the app with cwd set to the application
// directory, so a bare config() finds backend/.env; IIS/iisnode makes no such
// guarantee, and when cwd is the site root or inetsrv the file is silently not
// found — every DB_* var is then undefined and validateEnv() below exits the
// process, which the browser sees as a bare 500 on every request.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { validateEnv } = require('./config/env');
const { logger } = require('./config/logger');

// Before anything else, and before the port is bound: a process that can't work
// should fail visibly at boot rather than accept traffic it will 500 on.
try {
  validateEnv();
} catch (err) {
  // console, deliberately, and the only one left in the backend: this is a
  // multi-line list of what an operator must fix, read off a terminal during a
  // failed deploy. pino would render it as a single escaped JSON string, which
  // is exactly the wrong format for the one message that has to be readable by
  // a human under pressure.
  console.error(`\n${err.message}\n`);
  process.exit(1);
}

const app = require('./app');
const { getPool, closePool } = require('./config/connection');
const { drift } = require('./config/migrations');
const cron = require('node-cron');
const { sendDueStayReminders } = require('./modules/bookings/stayReminders.service');
const { sendDueFeedbackRequests } = require('./modules/bookings/feedbackRequests.service');
const { sendDueBirthdayWishes } = require('./modules/customers/birthdayWishes.service');
const { sendDueEventReminders } = require('./modules/events/eventReminders.service');
const { sendDueEventFeedbackRequests } = require('./modules/events/eventFeedbackRequests.service');

const port = process.env.PORT || 5000;

const server = app.listen(port, () => {
  logger.info({ port }, 'API listening');
});

// A failed bind arrives as an 'error' event, not a thrown exception. Without a
// listener Node re-throws it as an uncaughtException, which the handler at the
// bottom of this file turns into server.close() on a server that never opened -
// so the callback never fires and the real reason is buried under a shutdown
// that cannot complete.
//
// It matters most under IIS/iisnode, where `port` is not a number but a named
// pipe supplied by the host. EACCES or EADDRINUSE on that pipe is a hosting
// misconfiguration, and the operator sees only a blank 500 unless the reason is
// written somewhere first.
server.on('error', (err) => {
  logger.fatal({ err, port }, 'Could not bind - the server is not accepting requests');
  // Same reasoning as the env check above: this is an operator-facing message on
  // a process that is about to die, and it has to survive without a log reader.
  console.error(`\nFailed to listen on ${port}: ${err.message}\n`);
  process.exit(1);
});

// Schema drift check — advisory, after the port is bound. A database that is
// behind the code is worth a loud log line at every boot, but not a refusal to
// start: the app already tolerates the database being down entirely at boot
// (requests fail until it returns), and a deploy pipeline that runs
// `npm run migrate` before restarting will simply log nothing here.
(async () => {
  try {
    const { tracked, pending, modified } = await drift(await getPool());
    if (!tracked && pending.length > 0) {
      logger.warn(
        { pending },
        'Database has no schema_migrations table — run `npm run migrate` (or `npm run migrate -- --baseline` if the schema is already current)'
      );
    } else if (modified.length > 0) {
      logger.error(
        { modified },
        'Applied migrations differ from their files — the database and repository disagree'
      );
    } else if (pending.length > 0) {
      logger.warn({ pending }, 'Database is behind the code — run `npm run migrate`');
    } else {
      logger.info('Database schema is up to date');
    }
  } catch (err) {
    // The connection layer already logged the failure; the drift check just
    // didn't get to run. It is a boot-time convenience, not a gate.
    logger.debug({ err }, 'Schema drift check skipped — database unreachable');
  }
})();

// ---------------------------------------------------------------------------
// Scheduled jobs
// ---------------------------------------------------------------------------

// The only timers in this backend — everything else either rides along with
// a request (see otp.service.js's sweep-on-write) or is a plain unscheduled
// best-effort send triggered by a user action (bookingConfirmation.js,
// cancellationNotice.js, checkinWelcome.js). A "the stay is coming up"
// reminder and a "how was your stay" feedback ask both have no such request
// to ride along with; each has to notice something about a date on its own,
// which is what these two are for.
//
// 9 AM IST, fixed: every lodge is in India, and a reminder landing at 9 AM
// local reads as the desk thinking of the guest, not a 3 AM notification
// buzzing their phone because the server happened to be on UTC.
cron.schedule(
  '0 9 * * *',
  () => {
    sendDueStayReminders().catch((err) => logger.error({ err }, 'Stay reminder sweep failed'));
  },
  { timezone: 'Asia/Kolkata' }
);

// Every 2 hours, not once a day: the feedback ask is meant to land a few
// hours after checkout (see feedbackRequests.service.js's DELAY_HOURS), and
// a guest who checks out at 10 AM shouldn't wait until the next morning's
// single daily tick to hear from the property. Its own schedule, not folded
// into the one above, because the two run for genuinely different reasons
// on genuinely different cadences.
cron.schedule(
  '0 */2 * * *',
  () => {
    sendDueFeedbackRequests().catch((err) => logger.error({ err }, 'Feedback request sweep failed'));
  },
  { timezone: 'Asia/Kolkata' }
);

// The event side of the same ask, off a function's completed_at instead of a
// stay's actual_check_out_at. Same 2-hour cadence as the stay sweep, its own
// cron.schedule call so a failure in either never stops the other.
cron.schedule(
  '0 */2 * * *',
  () => {
    sendDueEventFeedbackRequests().catch((err) => logger.error({ err }, 'Event feedback request sweep failed'));
  },
  { timezone: 'Asia/Kolkata' }
);

// Once a day, same 9 AM IST moment as the stay reminder above — a calendar
// check (is today someone's birthday) has no reason to run more often than
// once a day, same reasoning as the reminder sweep's own schedule. Its own
// cron.schedule call, not folded into that one, so a failure in either sweep
// never stops the other from running.
cron.schedule(
  '0 9 * * *',
  () => {
    sendDueBirthdayWishes().catch((err) => logger.error({ err }, 'Birthday wishes sweep failed'));
  },
  { timezone: 'Asia/Kolkata' }
);

// Same 9 AM IST moment as the stay reminder — one calendar check (is a
// function tomorrow), no reason to run more often. Its own cron.schedule
// call so a failure here never stops the stay-reminder or birthday sweeps.
cron.schedule(
  '0 9 * * *',
  () => {
    sendDueEventReminders().catch((err) => logger.error({ err }, 'Event reminder sweep failed'));
  },
  { timezone: 'Asia/Kolkata' }
);

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

// Passenger and most supervisors stop an app by sending SIGTERM and killing it
// if it hasn't gone in time. Without a handler, Node exits immediately: requests
// mid-flight are cut off, and — the part that matters — an open SQL transaction
// dies without committing or rolling back, holding locks until the server times
// it out. Draining first turns a deploy from a small burst of errors into none.
//
// The window is deliberately shorter than a typical supervisor's patience, so
// this finishes on its own terms rather than being killed part-way through.
const SHUTDOWN_GRACE_MS = 10000;

let shuttingDown = false;

async function shutdown(signal) {
  // A second Ctrl-C, or a supervisor sending TERM then INT, shouldn't restart
  // the sequence and reset the clock.
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, 'Shutdown signal received — finishing in-flight requests');

  // Stops accepting new connections; the callback fires once the existing ones
  // have finished.
  server.close(async () => {
    try {
      await closePool();
    } catch (err) {
      logger.error({ err }, 'Error while closing the SQL pool');
    }
    logger.info('Shutdown complete');
    process.exit(0);
  });

  // A request that never finishes — a hung query, a client that stopped
  // reading — must not hold the process open indefinitely.
  setTimeout(() => {
    logger.error({ graceMs: SHUTDOWN_GRACE_MS }, 'Still busy after grace period — forcing exit');
    process.exit(1);
  }, SHUTDOWN_GRACE_MS).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ---------------------------------------------------------------------------
// Last-resort crash handlers
// ---------------------------------------------------------------------------

// Node 20 terminates the process on an unhandled rejection, and an uncaught
// exception leaves the process in an undefined state. Neither is safe to
// continue from, so these don't try to: they exist so the crash is *recorded*
// before the process goes, instead of vanishing into a supervisor restart with
// nothing in the log to explain it.
//
// Exiting is the correct response — Passenger restarts the app, and a process
// that limps on after an uncaught exception can corrupt data in ways that are
// far harder to find than a restart. The drain gives an in-flight request a
// moment to land first.
function fatal(kind, err) {
  logger.fatal({ err }, kind);
  if (shuttingDown) process.exit(1);
  shuttingDown = true;
  server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
}

process.on('uncaughtException', (err) => fatal('Uncaught exception', err));
process.on('unhandledRejection', (reason) => fatal('Unhandled promise rejection', reason));

module.exports = server;
