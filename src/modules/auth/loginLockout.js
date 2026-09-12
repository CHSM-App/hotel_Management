const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');

// The durable half of the login defence.
//
// The IP limiter in middleware/rateLimit.js is the broad one: it stops a single
// machine sweeping many accounts, and it is cheap. What it cannot do is survive
// a restart, and the app now exits on an uncaught exception while Passenger
// recycles idle processes on its own schedule — so on its own, patience or a
// deliberate crash resets the budget.
//
// This is the per-identifier half, held in SQL so it outlives the process. The
// two are complementary and neither replaces the other:
//
//   IP limiter      one source, many accounts   in memory, resets on restart
//   this            one account, many sources   durable, survives everything
//
// It mirrors dbo.food_pin_lockouts, which does the same job for guest PINs, so
// there is one pattern here rather than two.

const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

// Higher than the IP budget on purpose. This counts failures against ONE
// identifier from anywhere, so it should only be reachable by someone
// deliberately working through passwords for a specific account — not by a
// receptionist who has forgotten theirs and is trying variations.
const MAX_FAILURES = 10;

const LOCKOUT_MESSAGE =
  'Too many failed attempts for this account. Please wait 15 minutes, or ask the owner to reset your password.';

// Case-insensitive: an email typed with a capital should not get its own fresh
// budget. Phone numbers are unaffected by lowercasing.
function normalise(identifier) {
  return String(identifier || '').trim().toLowerCase().slice(0, 255);
}

async function assertNotLockedOut(identifier, door) {
  const key = normalise(identifier);
  if (!key) return;

  const pool = await getPool();
  const result = await pool
    .request()
    .input('identifier', sql.NVarChar, key)
    .input('door', sql.NVarChar, door)
    .query(`
      SELECT locked_until FROM dbo.login_attempts
      WHERE identifier = @identifier AND door = @door
        AND locked_until IS NOT NULL AND locked_until > SYSDATETIMEOFFSET()
    `);

  if (result.recordset[0]) {
    throw new ApiError(LOCKOUT_MESSAGE, 429);
  }
}

// Recorded against the identifier as typed, so an attacker guessing at an
// address that does not exist is counted exactly like one guessing at a real
// account. Doing otherwise would turn the lockout into a way to discover which
// accounts exist — the same reasoning as the uniform error message in
// auth.service.js.
async function recordFailure(identifier, door) {
  const key = normalise(identifier);
  if (!key) return;

  const pool = await getPool();
  await pool
    .request()
    .input('identifier', sql.NVarChar, key)
    .input('door', sql.NVarChar, door)
    .input('windowMs', sql.Int, WINDOW_MS)
    .input('maxFailures', sql.Int, MAX_FAILURES)
    .input('lockMs', sql.Int, LOCK_MS)
    .query(`
      MERGE dbo.login_attempts WITH (HOLDLOCK) AS t
      USING (SELECT @identifier AS identifier, @door AS door) AS s
        ON t.identifier = s.identifier AND t.door = s.door
      WHEN MATCHED THEN UPDATE SET
        -- A burst of failures long ago should not add to one happening now, so
        -- an expired window resets the count to this single attempt.
        failed_count = CASE
          WHEN DATEDIFF(SECOND, t.first_failed_at, SYSDATETIMEOFFSET()) * 1000 > @windowMs THEN 1
          ELSE t.failed_count + 1
        END,
        first_failed_at = CASE
          WHEN DATEDIFF(SECOND, t.first_failed_at, SYSDATETIMEOFFSET()) * 1000 > @windowMs THEN SYSDATETIMEOFFSET()
          ELSE t.first_failed_at
        END,
        last_failed_at = SYSDATETIMEOFFSET(),
        locked_until = CASE
          WHEN DATEDIFF(SECOND, t.first_failed_at, SYSDATETIMEOFFSET()) * 1000 <= @windowMs
               AND t.failed_count + 1 >= @maxFailures
            THEN DATEADD(MILLISECOND, @lockMs, SYSDATETIMEOFFSET())
          ELSE t.locked_until
        END
      WHEN NOT MATCHED THEN
        INSERT (identifier, door, failed_count) VALUES (s.identifier, s.door, 1);
    `);
}

// A correct password clears the slate: someone who fumbled it three times and
// then got it right should not be closer to a lockout next time.
async function clearFailures(identifier, door) {
  const key = normalise(identifier);
  if (!key) return;

  const pool = await getPool();
  await pool
    .request()
    .input('identifier', sql.NVarChar, key)
    .input('door', sql.NVarChar, door)
    .query('DELETE FROM dbo.login_attempts WHERE identifier = @identifier AND door = @door');
}

module.exports = { assertNotLockedOut, recordFailure, clearFailures, MAX_FAILURES };
