const bcrypt = require('bcryptjs');
const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const rolesService = require('../roles/roles.service');

async function getMe(userId) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('userId', sql.BigInt, userId)
    .query(`
      SELECT
        u.id, u.name, u.email, u.phone, u.role, u.must_reset_password,
        l.id AS lodge_id, l.name AS lodge_name, l.slug, l.phone AS lodge_phone,
        l.whatsapp_number, l.address, l.city, l.state, l.checkin_mode,
        l.is_gst_registered, l.gstin, l.is_specified_premises,
        l.has_rooms, l.serves_food, l.food_room_service, l.food_table_service
      FROM dbo.users u
      JOIN dbo.lodges l ON l.id = u.lodge_id
      WHERE u.id = @userId
    `);

  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('Account not found.', 404);
  }

  // Shipped with the profile so the dashboard can build its menu from what the
  // caller can actually reach, rather than hard-coding role names in the UI.
  const effectiveRole = await rolesService.getEffectiveRole(row.lodge_id, row.role);

  return {
    user: {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      role: row.role,
      roleName: effectiveRole?.name || row.role,
      permissions: effectiveRole?.permissions || [],
      mustResetPassword: !!row.must_reset_password,
    },
    lodge: {
      id: row.lodge_id,
      name: row.lodge_name,
      slug: row.slug,
      phone: row.lodge_phone,
      whatsappNumber: row.whatsapp_number,
      address: row.address,
      city: row.city,
      state: row.state,
      checkinMode: row.checkin_mode,
      isGstRegistered: row.is_gst_registered,
      gstin: row.gstin,
      isSpecifiedPremises: row.is_specified_premises,
      // What this property actually is. The dashboard builds its menu from
      // these together with the caller's permissions — a restaurant has the
      // rooms sections hidden even for an owner who can reach everything.
      hasRooms: !!row.has_rooms,
      servesFood: !!row.serves_food,
      foodRoomService: !!row.food_room_service,
      foodTableService: !!row.food_table_service,
    },
  };
}

// Self-service password change — the only way a temp password (see
// must_reset_password) or a forgotten one gets replaced today, since there's
// no admin "reset user password" flow yet.
async function changePassword(userId, currentPassword, newPassword) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('userId', sql.BigInt, userId)
    .query('SELECT password_hash FROM dbo.users WHERE id = @userId');
  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('Account not found.', 404);
  }

  const matches = await bcrypt.compare(currentPassword, row.password_hash);
  if (!matches) {
    throw new ApiError('Current password is incorrect.', 401);
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await pool
    .request()
    .input('userId', sql.BigInt, userId)
    .input('passwordHash', sql.NVarChar, passwordHash)
    .query('UPDATE dbo.users SET password_hash = @passwordHash, must_reset_password = 0 WHERE id = @userId');
}

module.exports = { getMe, changePassword };
