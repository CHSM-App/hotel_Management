const sql = require('mssql');
const { logger } = require('./logger');

// TLS certificate validation.
//
// `encrypt: true` encrypts the connection; without validating the certificate
// it is encrypted but *unauthenticated*, so anything able to sit between the
// app and SQL Server can present its own certificate and read the traffic —
// including credentials and every guest record that crosses it.
//
// When the database is on the same host (the usual cPanel setup) there is no
// network to intercept and a self-signed certificate is normal, so trusting it
// is reasonable. When the database is remote it is not. Defaulting to the old
// permissive behaviour keeps existing deployments working; set
// DB_TRUST_SERVER_CERT=false once the server has a certificate the app trusts.
const trustServerCertificate = process.env.DB_TRUST_SERVER_CERT !== 'false';

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  options: {
    encrypt: true,
    trustServerCertificate,
  },
  // Both were previously undeclared and running on driver defaults (15s each).
  // Stated explicitly so they are a decision rather than an accident, and so
  // the reports page — the one query here that can legitimately run long — has
  // somewhere obvious to be tuned.
  connectionTimeout: Number(process.env.DB_CONNECTION_TIMEOUT_MS) || 15000,
  requestTimeout: Number(process.env.DB_REQUEST_TIMEOUT_MS) || 30000,
  pool: {
    max: Number(process.env.DB_POOL_MAX) || 10,
    min: 0,
    idleTimeoutMillis: 30000,
    // Without this a request waiting for a free connection waits forever when
    // the pool is exhausted, so a slow query stops being a slow page and
    // becomes a hung one. Failing at 15s surfaces the real problem instead.
    acquireTimeoutMillis: 15000,
  },
};

let poolPromise = null;

// Reconnection backoff.
//
// Clearing poolPromise on failure means the next request retries — which is
// right, but on its own it means *every* request retries, immediately. With the
// database down and traffic arriving, the app opens a connection attempt per
// request against a server that is already struggling, and each one occupies a
// socket for the full connection timeout. The app turns an outage into a
// heavier outage.
//
// So after a failure, further attempts are refused outright for a short window
// and callers get the cached error instead. One connection attempt is made per
// window no matter how much traffic arrives, and the window grows as failures
// repeat so a long outage is not hammered.
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30000;

let consecutiveFailures = 0;
let retryBlockedUntil = 0;
let lastConnectionError = null;

function backoffMs() {
  // 1s, 2s, 4s ... capped. Full jitter, so several workers restarting together
  // don't line up and retry in lockstep.
  const ceiling = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (consecutiveFailures - 1));
  return Math.round(Math.random() * ceiling);
}

function getPool() {
  if (!poolPromise) {
    // Inside the backoff window: fail fast with the reason the last attempt
    // failed, rather than queueing behind another doomed connection.
    if (Date.now() < retryBlockedUntil) {
      return Promise.reject(lastConnectionError || new Error('SQL Server unavailable.'));
    }

    const pool = new sql.ConnectionPool(config);

    // Without this, a connection lost *after* a successful connect is never
    // noticed: the resolved promise stays cached and every later request is
    // handed a pool that can no longer talk to anything. Clearing the cache on
    // error means the next request builds a fresh one.
    //
    // Also required because an 'error' event with no listener is thrown as an
    // uncaught exception, which would take the whole process down.
    pool.on('error', (err) => {
      logger.error({ err }, 'SQL Server pool error');
      if (poolPromise) poolPromise = null;
    });

    poolPromise = pool
      .connect()
      .then((connected) => {
        consecutiveFailures = 0;
        retryBlockedUntil = 0;
        lastConnectionError = null;
        logger.info(
          { database: config.database, server: config.server, port: config.port },
          'Connected to SQL Server'
        );
        return connected;
      })
      .catch((err) => {
        poolPromise = null;
        consecutiveFailures += 1;
        lastConnectionError = err;
        const wait = backoffMs();
        retryBlockedUntil = Date.now() + wait;
        logger.error(
          { err, consecutiveFailures, retryInMs: wait },
          'SQL Server connection failed'
        );
        throw err;
      });
  }
  return poolPromise;
}

// Closes the pool on shutdown so in-flight transactions are settled rather than
// severed. Tolerant of being called when nothing was ever opened — shutdown
// shouldn't fail because the app is stopping before its first request.
async function closePool() {
  if (!poolPromise) return;
  const pending = poolPromise;
  poolPromise = null;
  try {
    const pool = await pending;
    await pool.close();
  } catch {
    // The pool never connected, or is already gone. Either way there is
    // nothing left to close and nothing useful to report during shutdown.
  }
}

module.exports = { sql, getPool, closePool };
