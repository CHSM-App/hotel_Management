const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getPool, sql } = require('../../config/connection');

// Issue, check and burn the one-time codes in dbo.otp_store.
//
// The shape follows the college-admission backend's services/otpService.js —
// hash the code, expire it, invalidate the previous one, burn on use — with the
// differences described in migrations/003_otp_store.sql: codes are bound to a
// user id rather than a typed-in phone, and guesses are counted.

const OTP_TTL_MS = 10 * 60 * 1000;

// Six digits, to match what the WhatsApp template renders and what people are
// willing to retype. The strength of a six-digit code comes from MAX_ATTEMPTS
// and the expiry, not from its length — which is why both are enforced below.
const MAX_ATTEMPTS = 5;

// randomInt, not Math.random(): the codes guard a password change, and
// Math.random() is a predictable PRNG that is explicitly not for secrets. The
// college version uses Math.random() here; that is the one part of it not worth
// copying.
function generateOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

// Spent and expired rows serve no purpose and the table only grows. The college
// backend sweeps them with an hourly node-cron job; this backend has no cron
// dependency, so the sweep rides along with each newly issued code — the same
// "sweep on write" approach src/middleware/rateLimit.js already uses in memory.
async function sweepExpired(pool) {
  await pool.request().query(`
    DELETE FROM dbo.otp_store
    WHERE used = 1 OR expires_at < SYSDATETIMEOFFSET()
  `);
}

// Stores a fresh code and returns it in clear for immediate delivery. The clear
// value exists only in this return; the database keeps the hash.
async function issueOtp({ userId, phone, purpose }) {
  const pool = await getPool();
  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, 8);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await sweepExpired(pool);

  // Any code still outstanding for this account and purpose is retired first, so
  // "resend" cannot leave two live codes and double the guessing surface.
  await pool
    .request()
    .input('userId', sql.BigInt, userId)
    .input('purpose', sql.NVarChar, purpose)
    .query(`
      UPDATE dbo.otp_store SET used = 1
      WHERE user_id = @userId AND purpose = @purpose AND used = 0
    `);

  await pool
    .request()
    .input('userId', sql.BigInt, userId)
    .input('phone', sql.NVarChar, phone)
    .input('otpHash', sql.NVarChar, otpHash)
    .input('purpose', sql.NVarChar, purpose)
    .input('expiresAt', sql.DateTimeOffset, expiresAt)
    .query(`
      INSERT INTO dbo.otp_store (user_id, phone, otp_hash, purpose, expires_at)
      VALUES (@userId, @phone, @otpHash, @purpose, @expiresAt)
    `);

  return { otp, expiresAt };
}

// Verifies a code and burns it. There is no non-consuming variant here on
// purpose: the college backend needs one because its forgot-password flow gates
// an OTP screen before the reset screen, whereas this flow collects the code and
// the new password in a single request, so nothing has to survive the check.
//
// Returns { valid: true } or { valid: false, reason }.
async function verifyAndConsumeOtp({ userId, otp, purpose }) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('userId', sql.BigInt, userId)
    .input('purpose', sql.NVarChar, purpose)
    .query(`
      SELECT TOP 1 id, otp_hash, attempts, expires_at
      FROM dbo.otp_store
      WHERE user_id = @userId AND purpose = @purpose AND used = 0
      ORDER BY created_at DESC
    `);

  const row = result.recordset[0];
  if (!row) {
    return { valid: false, reason: 'No code is waiting. Please request a new one.' };
  }

  const burn = () =>
    pool.request().input('id', sql.BigInt, row.id).query('UPDATE dbo.otp_store SET used = 1 WHERE id = @id');

  if (Date.now() > new Date(row.expires_at).getTime()) {
    await burn();
    return { valid: false, reason: 'That code has expired. Please request a new one.' };
  }

  const matches = await bcrypt.compare(String(otp).trim(), row.otp_hash);
  if (!matches) {
    const attempts = row.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      // Burned rather than merely counted: leaving a code alive after its last
      // allowed guess would let the next request start the count again, which
      // is the whole loophole the counter exists to close.
      await burn();
      return { valid: false, reason: 'Too many incorrect codes. Please request a new one.' };
    }
    await pool
      .request()
      .input('id', sql.BigInt, row.id)
      .input('attempts', sql.Int, attempts)
      .query('UPDATE dbo.otp_store SET attempts = @attempts WHERE id = @id');
    return { valid: false, reason: 'That code is incorrect. Please try again.' };
  }

  await burn();
  return { valid: true };
}

module.exports = { issueOtp, verifyAndConsumeOtp, generateOtp, OTP_TTL_MS, MAX_ATTEMPTS };
