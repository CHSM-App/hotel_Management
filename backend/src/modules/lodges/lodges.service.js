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

    // Every property that lets rooms has an extra bed to sell, so it starts
    // with one rather than waiting for the owner to think of it. Priced at 0
    // deliberately — the owner sets the rate on Rooms & rates, and a number
    // invented here would be charged to real guests. is_counter is what puts
    // the "how many" box beside it at booking time; see schema.sql, which
    // backfills the same row into lodges that predate this.
    if (input.hasRooms) {
      await new sql.Request(transaction)
        .input('lodgeId', sql.BigInt, lodgeId)
        .query(`
          INSERT INTO dbo.switchable_charges (lodge_id, name, charge_per_night, is_counter)
          VALUES (@lodgeId, 'Extra bed', 0, 1)
        `);
    }

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

// Everything internal staff need to answer "what is this account, and what has
// it actually done" without signing in as the owner. One round trip with four
// result sets rather than four queries: the whole thing renders as a single
// page, so a partial answer is never useful.
//
// Read-only by design. Nothing here edits a lodge — that stays with the owner,
// and support looking at a property must not be able to change it by accident.
async function getLodgeDetail(id) {
  const pool = await getPool();

  const result = await pool.request().input('id', sql.BigInt, id).query(`
    SELECT
      id, name, slug, phone, whatsapp_number, address, city, state,
      checkin_mode, is_gst_registered, gstin, is_specified_premises,
      has_rooms, serves_food, food_room_service, food_table_service,
      check_out_time, late_grace_minutes, late_half_day_percent,
      late_full_day_after_minutes, late_full_day_percent,
      is_active, created_at
    FROM dbo.lodges
    WHERE id = @id;

    -- Owner first, then the rest by seniority of account. No password material
    -- is selected: this screen shows who can sign in, never how.
    SELECT id, name, email, phone, role, is_active, must_reset_password, created_at
    FROM dbo.users
    WHERE lodge_id = @id
    ORDER BY CASE WHEN role = 'OWNER' THEN 0 ELSE 1 END, created_at;

    SELECT
      (SELECT COUNT(*) FROM dbo.rooms WHERE lodge_id = @id) AS rooms,
      (SELECT COUNT(*) FROM dbo.rooms WHERE lodge_id = @id AND is_active = 1) AS rooms_active,
      (SELECT COUNT(*) FROM dbo.room_categories WHERE lodge_id = @id) AS categories,
      (SELECT COUNT(*) FROM dbo.features WHERE lodge_id = @id) AS features,
      (SELECT COUNT(*) FROM dbo.switchable_charges WHERE lodge_id = @id) AS switchable_charges,
      (SELECT COUNT(*) FROM dbo.seasons WHERE lodge_id = @id) AS seasons,
      (SELECT COUNT(*) FROM dbo.bookings WHERE lodge_id = @id) AS bookings,
      (SELECT COUNT(*) FROM dbo.bookings WHERE lodge_id = @id AND status = 'CHECKED_IN') AS bookings_in_house,
      (SELECT COUNT(*) FROM dbo.bookings WHERE lodge_id = @id AND status = 'BOOKED') AS bookings_upcoming,
      (SELECT COUNT(*) FROM dbo.menu_categories WHERE lodge_id = @id) AS menu_categories,
      (SELECT COUNT(*) FROM dbo.menu_items WHERE lodge_id = @id) AS menu_items,
      (SELECT COUNT(*) FROM dbo.dining_tables WHERE lodge_id = @id) AS dining_tables,
      (SELECT COUNT(*) FROM dbo.food_orders WHERE lodge_id = @id) AS food_orders,
      (SELECT COUNT(*) FROM dbo.invoices WHERE lodge_id = @id AND status = 'ISSUED') AS invoices_issued,
      (SELECT COUNT(*) FROM dbo.invoices WHERE lodge_id = @id AND status = 'VOID') AS invoices_void,
      -- Issued documents only. A void bill was withdrawn, so counting it here
      -- would overstate what the account has actually billed.
      (SELECT ISNULL(SUM(total_amount), 0) FROM dbo.invoices WHERE lodge_id = @id AND status = 'ISSUED') AS billed_total,
      (SELECT MAX(created_at) FROM dbo.bookings WHERE lodge_id = @id) AS last_booking_at,
      (SELECT MAX(placed_at) FROM dbo.food_orders WHERE lodge_id = @id) AS last_order_at,
      (SELECT MAX(created_at) FROM dbo.invoices WHERE lodge_id = @id) AS last_invoice_at;

    SELECT series_type, prefix, next_number
    FROM dbo.invoice_series
    WHERE lodge_id = @id
    ORDER BY series_type;
  `);

  const [lodgeRows, staff, statsRows, invoiceSeries] = result.recordsets;

  if (lodgeRows.length === 0) {
    throw new ApiError('Lodge not found.', 404);
  }

  return {
    lodge: lodgeRows[0],
    staff,
    stats: statsRows[0],
    invoiceSeries,
  };
}

module.exports = { createLodgeWithOwner, listLodges, getLodgeDetail };
