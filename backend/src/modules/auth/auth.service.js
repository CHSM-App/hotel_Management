const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const loginLockout = require('./loginLockout');

const LODGE_ROLES = ['OWNER', 'RECEPTION', 'KITCHEN'];

// A real bcrypt hash of a value nobody can supply, compared against when the
// identifier matched no account. Its only job is to make the failing path cost
// the same as the succeeding one — see the note in loginWithRoles. Generated at
// cost 10 to match the hashes the app writes, so the timing lines up.
const DUMMY_HASH = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

async function findUserByIdentifier(identifier) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('identifier', sql.NVarChar, identifier)
    .query(`
      SELECT id, lodge_id, name, email, phone, password_hash, role, is_active, must_reset_password
      FROM dbo.users
      WHERE email = @identifier OR phone = @identifier
    `);

  return result.recordset[0];
}

function issueToken(user) {
  const token = jwt.sign(
    { sub: user.id, role: user.role, lodgeId: user.lodge_id ?? null },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  return {
    token,
    role: user.role,
    name: user.name,
    lodgeId: user.lodge_id ?? null,
    mustResetPassword: !!user.must_reset_password,
  };
}

async function loginWithRoles({ identifier, password }, allowedRoles, door) {
  // Checked before the account is looked up, so a locked identifier behaves the
  // same whether or not it names a real account.
  await loginLockout.assertNotLockedOut(identifier, door);

  const user = await findUserByIdentifier(identifier);

  // Same message for "no such account", "wrong password" and "wrong
  // login door" — don't tell an attacker which one it was.
  const rejected = !user || !user.is_active || !allowedRoles.includes(user.role);

  // The comparison runs even when the account was already rejected, against a
  // dummy hash. Short-circuiting here would leak by timing what the identical
  // error message is careful not to say: bcrypt at cost 10 takes ~100ms, so
  // "no such account" would return almost instantly while a real account with
  // the wrong password would not, and the difference is measurable over a few
  // requests. Doing the work regardless keeps both paths the same shape.
  const hashToCheck = user ? user.password_hash : DUMMY_HASH;
  const passwordMatches = await bcrypt.compare(password, hashToCheck);

  if (rejected || !passwordMatches) {
    // Counted against the identifier as typed, so guessing at an address that
    // does not exist costs the same as guessing at one that does.
    await loginLockout.recordFailure(identifier, door);

    // Re-read rather than assume: this attempt may have been the one that
    // tripped the lock, and the person should be told to stop now rather than
    // discover it on their next try.
    await loginLockout.assertNotLockedOut(identifier, door);

    throw new ApiError('Incorrect phone/email or password.', 401);
  }

  await loginLockout.clearFailures(identifier, door);

  return issueToken(user);
}

// Lodge staff only — the public-facing /login page.
function login(credentials) {
  return loginWithRoles(credentials, LODGE_ROLES, 'STAFF');
}

// Forgot-password, reached from the same login page by someone who cannot
// sign in at all — so unlike me.service.js's changePassword, nothing proves
// this is the account owner beyond knowing the phone or email on file. Takes
// the same identifier shape as login() (phone or email), scoped to the same
// lodge-only roles, so this can never touch a SUPERADMIN account.
//
// Same "don't say which part failed" shape as loginWithRoles: whether the
// identifier matched no account or an inactive/wrong-role one, the caller
// sees one generic error either way.
async function resetPasswordByIdentifier(identifier, newPassword) {
  // Same durable per-identifier lockout the login doors use, on its own
  // "door" name — this is the only check standing between knowing a phone
  // or email and taking over that account, so it gets the same defence a
  // wrong password would.
  await loginLockout.assertNotLockedOut(identifier, 'FORGOT');

  const user = await findUserByIdentifier(identifier);
  if (!user || !user.is_active || !LODGE_ROLES.includes(user.role)) {
    await loginLockout.recordFailure(identifier, 'FORGOT');
    throw new ApiError('No account found for that phone or email.', 404);
  }

  const pool = await getPool();
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await pool
    .request()
    .input('userId', sql.BigInt, user.id)
    .input('passwordHash', sql.NVarChar, passwordHash)
    .query('UPDATE dbo.users SET password_hash = @passwordHash, must_reset_password = 0 WHERE id = @userId');

  await loginLockout.clearFailures(identifier, 'FORGOT');
}

// Vengurla Tech only — the hidden /vtadmin page. Counted separately from the
// staff door: the two have different budgets, and this one opens every property
// rather than one.
function adminLogin(credentials) {
  return loginWithRoles(credentials, ['SUPERADMIN'], 'ADMIN');
}

module.exports = { login, adminLogin, resetPasswordByIdentifier };
