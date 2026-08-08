const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');

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

async function loginWithRoles({ identifier, password }, allowedRoles) {
  const user = await findUserByIdentifier(identifier);

  // Same message for "no such account", "wrong password" and "wrong
  // login door" — don't tell an attacker which one it was.
  if (!user || !user.is_active || !allowedRoles.includes(user.role)) {
    throw new ApiError('Incorrect phone/email or password.', 401);
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) {
    throw new ApiError('Incorrect phone/email or password.', 401);
  }

  return issueToken(user);
}

// Lodge staff only — the public-facing /login page.
function login(credentials) {
  return loginWithRoles(credentials, ['OWNER', 'RECEPTION', 'KITCHEN']);
}

// Vengurla Tech only — the hidden /vtadmin page.
function adminLogin(credentials) {
  return loginWithRoles(credentials, ['SUPERADMIN']);
}

module.exports = { login, adminLogin };
