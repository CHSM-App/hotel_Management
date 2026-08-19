require('dotenv').config();

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

const port = process.env.PORT || 5000;

const server = app.listen(port, () => {
  logger.info({ port }, 'API listening');
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
