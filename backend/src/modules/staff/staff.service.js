const bcrypt = require('bcryptjs');
const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const rolesService = require('../roles/roles.service');

function mapUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    roleKey: row.role,
    roleName: row.role_name || row.role,
    isActive: !!row.is_active,
    mustResetPassword: !!row.must_reset_password,
    createdAt: row.created_at,
  };
}

// Joined against the lodge's effective role rows so the list shows the role's
// display name ("Night Manager") rather than the raw key stored on the user.
async function listStaff(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT u.id, u.name, u.email, u.phone, u.role, u.is_active, u.must_reset_password, u.created_at,
             r.name AS role_name
      FROM dbo.users u
      OUTER APPLY (
        SELECT TOP 1 name FROM dbo.roles
        WHERE role_key = u.role AND (lodge_id = u.lodge_id OR lodge_id IS NULL)
        ORDER BY CASE WHEN lodge_id IS NULL THEN 1 ELSE 0 END
      ) r
      WHERE u.lodge_id = @lodgeId
      ORDER BY u.is_active DESC, u.name ASC
    `);
  return result.recordset.map(mapUser);
}

async function assertRoleExists(lodgeId, roleKey) {
  const role = await rolesService.getEffectiveRole(lodgeId, roleKey);
  if (!role) {
    throw new ApiError('Choose a valid role.', 400);
  }
  return role;
}

async function createStaff(lodgeId, input) {
  const pool = await getPool();
  await assertRoleExists(lodgeId, input.roleKey);

  // phone is globally unique and email is too when present — check both up
  // front so the user gets a readable message instead of a constraint error.
  const clash = await pool
    .request()
    .input('phone', sql.NVarChar, input.phone)
    .input('email', sql.NVarChar, input.email || null)
    .query('SELECT id FROM dbo.users WHERE phone = @phone OR (@email IS NOT NULL AND email = @email)');
  if (clash.recordset.length > 0) {
    throw new ApiError('Someone already uses that phone number or email.', 409);
  }

  const passwordHash = await bcrypt.hash(input.tempPassword, 10);
  const inserted = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, input.name)
    .input('email', sql.NVarChar, input.email || null)
    .input('phone', sql.NVarChar, input.phone)
    .input('passwordHash', sql.NVarChar, passwordHash)
    .input('role', sql.NVarChar, input.roleKey)
    .query(`
      INSERT INTO dbo.users (lodge_id, name, email, phone, password_hash, role, must_reset_password)
      OUTPUT inserted.id
      VALUES (@lodgeId, @name, @email, @phone, @passwordHash, @role, 1)
    `);

  return { id: inserted.recordset[0].id };
}

async function loadLodgeUser(pool, lodgeId, userId) {
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('userId', sql.BigInt, userId)
    .query('SELECT id, role, is_active FROM dbo.users WHERE id = @userId AND lodge_id = @lodgeId');
  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('Staff member not found.', 404);
  }
  return row;
}

// Guards against a lodge removing its last way in: the final active OWNER
// can't be demoted or deactivated.
async function assertNotLastOwner(pool, lodgeId, userId, nextRoleKey, nextIsActive) {
  const current = await loadLodgeUser(pool, lodgeId, userId);
  const wasActiveOwner = current.role === 'OWNER' && current.is_active;
  const staysActiveOwner = (nextRoleKey ?? current.role) === 'OWNER' && (nextIsActive ?? current.is_active);
  if (!wasActiveOwner || staysActiveOwner) return;

  const owners = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('userId', sql.BigInt, userId)
    .query(`
      SELECT COUNT(*) AS count FROM dbo.users
      WHERE lodge_id = @lodgeId AND role = 'OWNER' AND is_active = 1 AND id <> @userId
    `);
  if (owners.recordset[0].count === 0) {
    throw new ApiError('This is the only active owner — promote someone else first.', 409);
  }
}

async function updateStaff(lodgeId, userId, input) {
  const pool = await getPool();
  if (input.roleKey) {
    await assertRoleExists(lodgeId, input.roleKey);
  }
  await assertNotLastOwner(pool, lodgeId, userId, input.roleKey, input.isActive);

  if (input.phone || input.email !== undefined) {
    const clash = await pool
      .request()
      .input('userId', sql.BigInt, userId)
      .input('phone', sql.NVarChar, input.phone || null)
      .input('email', sql.NVarChar, input.email || null)
      .query(`
        SELECT id FROM dbo.users
        WHERE id <> @userId
          AND ((@phone IS NOT NULL AND phone = @phone) OR (@email IS NOT NULL AND email = @email))
      `);
    if (clash.recordset.length > 0) {
      throw new ApiError('Someone already uses that phone number or email.', 409);
    }
  }

  await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('userId', sql.BigInt, userId)
    .input('name', sql.NVarChar, input.name ?? null)
    .input('email', sql.NVarChar, input.email ?? null)
    .input('emailProvided', sql.Bit, input.email !== undefined ? 1 : 0)
    .input('phone', sql.NVarChar, input.phone ?? null)
    .input('role', sql.NVarChar, input.roleKey ?? null)
    .input('isActive', sql.Bit, input.isActive == null ? null : input.isActive ? 1 : 0)
    .query(`
      UPDATE dbo.users
      SET name = COALESCE(@name, name),
          email = CASE WHEN @emailProvided = 1 THEN @email ELSE email END,
          phone = COALESCE(@phone, phone),
          role = COALESCE(@role, role),
          is_active = COALESCE(@isActive, is_active)
      WHERE id = @userId AND lodge_id = @lodgeId
    `);

  const staff = await listStaff(lodgeId);
  return staff.find((s) => String(s.id) === String(userId));
}

// Sets a fresh temporary password and forces a change at next sign-in — the
// recovery path when a staff member is locked out.
async function resetStaffPassword(lodgeId, userId, tempPassword) {
  const pool = await getPool();
  await loadLodgeUser(pool, lodgeId, userId);
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('userId', sql.BigInt, userId)
    .input('passwordHash', sql.NVarChar, passwordHash)
    .query(`
      UPDATE dbo.users SET password_hash = @passwordHash, must_reset_password = 1
      WHERE id = @userId AND lodge_id = @lodgeId
    `);
}

module.exports = { listStaff, createStaff, updateStaff, resetStaffPassword };
