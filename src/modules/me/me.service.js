const fs = require('fs/promises');
const path = require('path');
const bcrypt = require('bcryptjs');
const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const rolesService = require('../roles/roles.service');
const whatsapp = require('../../config/whatsapp');
const { logger } = require('../../config/logger');
const { issueOtp, verifyAndConsumeOtp } = require('./otp.service');
const { UPLOAD_DIR: LOGO_DIR } = require('../../middleware/logoUpload');

const PASSWORD_CHANGE = 'password_change';

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
        l.name_mr, l.address_mr, l.latitude, l.longitude,
        l.is_gst_registered, l.gstin, l.is_specified_premises,
        l.has_rooms, l.serves_food, l.food_room_service, l.food_table_service, l.has_events,
        l.logo_path, l.show_logo_on_receipt
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
      nameMr: row.name_mr,
      addressMr: row.address_mr,
      latitude: row.latitude,
      longitude: row.longitude,
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
      hasEvents: !!row.has_events,
      logoUrl: row.logo_path ? `/hotel-logos/${row.logo_path}` : null,
      showLogoOnReceipt: !!row.show_logo_on_receipt,
    },
  };
}

// Loads the account and checks the password it was given, for both halves of
// the change flow below. Both halves must prove the current password: the send
// step so a code is never delivered on someone else's say-so, and the change
// step so a code intercepted in transit is still not enough on its own.
async function assertCurrentPassword(userId, currentPassword) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('userId', sql.BigInt, userId)
    .query('SELECT id, name, phone, password_hash FROM dbo.users WHERE id = @userId');
  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('Account not found.', 404);
  }

  const matches = await bcrypt.compare(currentPassword, row.password_hash);
  if (!matches) {
    throw new ApiError('Current password is incorrect.', 401);
  }
  return row;
}

// Step 1 of the password change: send a one-time code to the account's own
// phone. Changing a password is what locks the rightful owner out of a
// property, and reception terminals stay signed in on a shared counter — so the
// current password alone, which anyone standing at that counter already has,
// is not enough to authorise it.
//
// Returns the masked destination so the UI can say where the code went without
// printing a staff member's full number on a screen in a public lobby.
async function sendPasswordChangeOtp(userId, currentPassword) {
  const user = await assertCurrentPassword(userId, currentPassword);

  const phone = whatsapp.normalisePhone(user.phone);
  if (!phone) {
    throw new ApiError('No usable phone number is on file for this account. Ask the owner to update it.', 422);
  }
  // Checked before the code is generated: a code written to the database and
  // never delivered would leave the user waiting for a message that is not
  // coming, with no way to tell that from a slow one.
  if (!whatsapp.isConfigured()) {
    throw new ApiError('WhatsApp is not configured on this server, so codes cannot be sent.', 503);
  }

  const { otp, expiresAt } = await issueOtp({ userId, phone, purpose: PASSWORD_CHANGE });

  try {
    await whatsapp.sendOtp(phone, otp);
  } catch (err) {
    // The provider's reason goes to the log, not to the response: it can name
    // the destination number and the template, and the caller can do nothing
    // with it either way. The stored code is left behind for the next sweep.
    logger.error({ err, userId }, 'WhatsApp OTP send failed');
    throw new ApiError('Could not send the code right now. Please try again in a moment.', 502);
  }

  return { phone: maskPhone(phone), expiresAt };
}

// 919876543210 -> +91 ******3210. Enough for the right person to recognise
// their own number and not enough for anyone else to learn it.
function maskPhone(normalised) {
  const digits = String(normalised);
  const last4 = digits.slice(-4);
  return `+${digits.slice(0, 2)} ${'*'.repeat(Math.max(0, digits.length - 6))}${last4}`;
}

// Step 2: the change itself. The current password is re-checked here rather
// than trusted from step 1, because the two are separate requests and nothing
// carries between them except the code.
async function changePassword(userId, currentPassword, newPassword, otp) {
  await assertCurrentPassword(userId, currentPassword);

  const { valid, reason } = await verifyAndConsumeOtp({ userId, otp, purpose: PASSWORD_CHANGE });
  if (!valid) {
    throw new ApiError(reason, 400);
  }

  const pool = await getPool();
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await pool
    .request()
    .input('userId', sql.BigInt, userId)
    .input('passwordHash', sql.NVarChar, passwordHash)
    .query('UPDATE dbo.users SET password_hash = @passwordHash, must_reset_password = 0 WHERE id = @userId');
}

// The owner correcting their own property's contact/location details from the
// dashboard's profile menu. Narrower than internal's lodges.service#updateLodge:
// nothing here can change the slug, GST-registered status, check-in mode, or
// what the property sells — only the facts printed on a bill's masthead and
// the pin on the map. A GSTIN can only be *edited*, never turned on for a
// property that never registered — is_gst_registered stays whatever internal
// set it to.
async function updateMyLodge(lodgeId, input) {
  const pool = await getPool();
  const current = (
    await pool.request().input('id', sql.BigInt, lodgeId).query('SELECT * FROM dbo.lodges WHERE id = @id')
  ).recordset[0];
  if (!current) {
    throw new ApiError('Lodge not found.', 404);
  }

  const gstin = current.is_gst_registered ? input.gstin || null : current.gstin;
  const showLogoOnReceipt =
    input.showLogoOnReceipt !== undefined ? (input.showLogoOnReceipt ? 1 : 0) : current.show_logo_on_receipt;

  await pool
    .request()
    .input('id', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, input.lodgeName)
    .input('phone', sql.NVarChar, input.phone || null)
    .input('whatsappNumber', sql.NVarChar, input.whatsappNumber || null)
    .input('address', sql.NVarChar, input.address || null)
    .input('nameMr', sql.NVarChar, input.lodgeNameMr || null)
    .input('addressMr', sql.NVarChar, input.addressMr || null)
    .input('city', sql.NVarChar, input.city || null)
    .input('state', sql.NVarChar, input.state || null)
    .input('latitude', sql.Decimal(9, 6), input.latitude)
    .input('longitude', sql.Decimal(9, 6), input.longitude)
    .input('gstin', sql.NVarChar, gstin)
    .input('showLogoOnReceipt', sql.Bit, showLogoOnReceipt)
    .query(`
      UPDATE dbo.lodges
      SET name = @name, phone = @phone, whatsapp_number = @whatsappNumber,
          address = @address, name_mr = @nameMr, address_mr = @addressMr,
          city = @city, state = @state, latitude = @latitude, longitude = @longitude,
          gstin = @gstin, show_logo_on_receipt = @showLogoOnReceipt
      WHERE id = @id
    `);
}

// Deletes the file backing a stored logo_path, best-effort — a file already
// gone (manual cleanup, a prior failed delete) must not block replacing or
// clearing the row.
async function deleteLogoFile(logoPath) {
  if (!logoPath) return;
  try {
    await fs.unlink(path.join(LOGO_DIR, logoPath));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn({ err, logoPath }, 'Could not delete old hotel logo file');
    }
  }
}

// The owner replacing their own property's logo. The old file is removed
// after the new path is committed, so a delete failure never leaves the row
// pointing at nothing.
async function updateMyLodgeLogo(lodgeId, filename) {
  const pool = await getPool();
  const current = (
    await pool.request().input('id', sql.BigInt, lodgeId).query('SELECT logo_path FROM dbo.lodges WHERE id = @id')
  ).recordset[0];
  if (!current) throw new ApiError('Lodge not found.', 404);

  await pool
    .request()
    .input('id', sql.BigInt, lodgeId)
    .input('logoPath', sql.NVarChar, filename)
    .query('UPDATE dbo.lodges SET logo_path = @logoPath WHERE id = @id');

  await deleteLogoFile(current.logo_path);
}

async function removeMyLodgeLogo(lodgeId) {
  const pool = await getPool();
  const current = (
    await pool.request().input('id', sql.BigInt, lodgeId).query('SELECT logo_path FROM dbo.lodges WHERE id = @id')
  ).recordset[0];
  if (!current) throw new ApiError('Lodge not found.', 404);

  await pool
    .request()
    .input('id', sql.BigInt, lodgeId)
    .query('UPDATE dbo.lodges SET logo_path = NULL, show_logo_on_receipt = 0 WHERE id = @id');

  await deleteLogoFile(current.logo_path);
}

module.exports = {
  getMe,
  changePassword,
  sendPasswordChangeOtp,
  updateMyLodge,
  updateMyLodgeLogo,
  removeMyLodgeLogo,
};
