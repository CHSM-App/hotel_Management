const bcrypt = require('bcryptjs');
const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');

async function createLodgeWithOwner(input) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();
  try {
    const existingSlug = await new sql.Request(transaction)
      .input('slug', sql.NVarChar, input.slug)
      .query('SELECT id FROM dbo.lodges WHERE slug = @slug');

    if (existingSlug.recordset.length > 0) {
      throw new ApiError('That slug is already taken.', 409);
    }

    const existingPhone = await new sql.Request(transaction)
      .input('phone', sql.NVarChar, input.ownerPhone)
      .query('SELECT id FROM dbo.users WHERE phone = @phone');

    if (existingPhone.recordset.length > 0) {
      throw new ApiError('A user with that phone number already exists.', 409);
    }

    const lodgeResult = await new sql.Request(transaction)
      .input('name', sql.NVarChar, input.lodgeName)
      .input('slug', sql.NVarChar, input.slug)
      .input('phone', sql.NVarChar, input.phone || null)
      .input('whatsappNumber', sql.NVarChar, input.whatsappNumber || null)
      .input('address', sql.NVarChar, input.address || null)
      .input('city', sql.NVarChar, input.city || null)
      .input('state', sql.NVarChar, input.state || null)
      .input('checkinMode', sql.NVarChar, input.checkinMode)
      .input('isGstRegistered', sql.Bit, input.isGstRegistered)
      .input('gstin', sql.NVarChar, input.gstin || null)
      .input('isSpecifiedPremises', sql.Bit, input.isSpecifiedPremises)
      .input('hasRooms', sql.Bit, input.hasRooms)
      .input('servesFood', sql.Bit, input.servesFood)
      .input('foodRoomService', sql.Bit, input.foodRoomService)
      .input('foodTableService', sql.Bit, input.foodTableService)
      .query(`
        INSERT INTO dbo.lodges
          (name, slug, phone, whatsapp_number, address, city, state, checkin_mode,
           is_gst_registered, gstin, is_specified_premises,
           has_rooms, serves_food, food_room_service, food_table_service)
        OUTPUT inserted.id
        VALUES
          (@name, @slug, @phone, @whatsappNumber, @address, @city, @state, @checkinMode,
           @isGstRegistered, @gstin, @isSpecifiedPremises,
           @hasRooms, @servesFood, @foodRoomService, @foodTableService)
      `);

    const lodgeId = lodgeResult.recordset[0].id;
    const passwordHash = await bcrypt.hash(input.tempPassword, 10);

    await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('name', sql.NVarChar, input.ownerName)
      .input('email', sql.NVarChar, input.ownerEmail || null)
      .input('phone', sql.NVarChar, input.ownerPhone)
      .input('passwordHash', sql.NVarChar, passwordHash)
      .query(`
        INSERT INTO dbo.users
          (lodge_id, name, email, phone, password_hash, role, must_reset_password)
        VALUES
          (@lodgeId, @name, @email, @phone, @passwordHash, 'OWNER', 1)
      `);

    await transaction.commit();
    return { lodgeId, slug: input.slug };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function listLodges() {
  const pool = await getPool();

  const result = await pool.request().query(`
    SELECT
      l.id, l.name, l.slug, l.city, l.state, l.checkin_mode, l.is_gst_registered,
      l.is_specified_premises, l.is_active, l.created_at,
      l.has_rooms, l.serves_food, l.food_room_service, l.food_table_service,
      u.name AS owner_name, u.phone AS owner_phone
    FROM dbo.lodges l
    LEFT JOIN dbo.users u ON u.lodge_id = l.id AND u.role = 'OWNER'
    ORDER BY l.created_at DESC
  `);

  return result.recordset;
}

module.exports = { createLodgeWithOwner, listLodges };
