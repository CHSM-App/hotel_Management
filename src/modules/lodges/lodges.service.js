const fs = require('fs/promises');
const path = require('path');
const bcrypt = require('bcryptjs');
const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const { logger } = require('../../config/logger');
const { suggestBookingCode } = require('./bookingCode');
const { UPLOAD_DIR: LOGO_DIR } = require('../../middleware/logoUpload');
const { UPLOAD_DIR: HERO_IMAGE_DIR } = require('../../middleware/heroImageUpload');

async function createLodgeWithOwner(input) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();
  try {
    const existingSlug = await new sql.Request(transaction)
      .input('slug', sql.NVarChar, input.slug)
      .query('SELECT id FROM dbo.lodges WHERE slug = @slug');

    if (existingSlug.recordset.length > 0) {
      throw new ApiError('That slug is already taken.', 409, 'slug');
    }

    const codeTaken = async (code) =>
      (
        await new sql.Request(transaction)
          .input('code', sql.NVarChar, code)
          .query('SELECT 1 AS taken FROM dbo.lodges WHERE booking_code = @code')
      ).recordset.length > 0;
    let bookingCode = input.bookingCode || null;
    if (bookingCode) {
      if (await codeTaken(bookingCode)) {
        throw new ApiError('That booking code is already used by another property.', 409, 'bookingCode');
      }
    } else {
      bookingCode = await suggestBookingCode(input.lodgeName, codeTaken);
      if (!bookingCode) throw new ApiError('Could not pick a booking code automatically. Enter one.', 409, 'bookingCode');
    }

    const lodgeResult = await new sql.Request(transaction)
      .input('name', sql.NVarChar, input.lodgeName)
      .input('slug', sql.NVarChar, input.slug)
      .input('bookingCode', sql.NVarChar, bookingCode)
      .input('phone', sql.NVarChar, input.phone || null)
      .input('whatsappNumber', sql.NVarChar, input.whatsappNumber || null)
      .input('address', sql.NVarChar, input.address || null)
      .input('nameMr', sql.NVarChar, input.lodgeNameMr || null)
      .input('addressMr', sql.NVarChar, input.addressMr || null)
      .input('city', sql.NVarChar, input.city || null)
      .input('state', sql.NVarChar, input.state || null)
      .input('latitude', sql.Decimal(9, 6), input.latitude ?? null)
      .input('longitude', sql.Decimal(9, 6), input.longitude ?? null)
      .input('checkinMode', sql.NVarChar, input.checkinMode)
      .input('isGstRegistered', sql.Bit, input.isGstRegistered)
      .input('gstin', sql.NVarChar, input.gstin || null)
      .input('isSpecifiedPremises', sql.Bit, input.isSpecifiedPremises)
      .input('hasRooms', sql.Bit, input.hasRooms)
      .input('servesFood', sql.Bit, input.servesFood)
      .input('foodRoomService', sql.Bit, input.foodRoomService)
      .input('foodTableService', sql.Bit, input.foodTableService)
      .input('hasEvents', sql.Bit, input.hasEvents)
      .input('hasAssets', sql.Bit, input.hasAssets)
      .input('hasExpenses', sql.Bit, input.hasExpenses)
      .input('hasOtherServices', sql.Bit, input.hasOtherServices)
      .input('hasHousekeeping', sql.Bit, input.hasHousekeeping)
      .input('hasLaundry', sql.Bit, input.hasLaundry)
      .query(`
        INSERT INTO dbo.lodges
          (name, slug, booking_code, phone, whatsapp_number, address, name_mr, address_mr, city, state,
           latitude, longitude, checkin_mode,
           is_gst_registered, gstin, is_specified_premises,
           has_rooms, serves_food, food_room_service, food_table_service, has_events,
           has_assets, has_expenses, has_other_services, has_housekeeping, has_laundry)
        OUTPUT inserted.id
        VALUES
          (@name, @slug, @bookingCode, @phone, @whatsappNumber, @address, @nameMr, @addressMr, @city, @state,
           @latitude, @longitude, @checkinMode,
           @isGstRegistered, @gstin, @isSpecifiedPremises,
           @hasRooms, @servesFood, @foodRoomService, @foodTableService, @hasEvents,
           @hasAssets, @hasExpenses, @hasOtherServices, @hasHousekeeping, @hasLaundry)
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
          (lodge_id, name, email, phone, password_hash, role)
        VALUES
          (@lodgeId, @name, @email, @phone, @passwordHash, 'OWNER')
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
    return { lodgeId, slug: input.slug, bookingCode };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function listLodges() {
  const pool = await getPool();

  const result = await pool.request().query(`
    SELECT
      l.id, l.name, l.slug, l.phone AS lodge_phone, l.address, l.city, l.state, l.latitude, l.longitude,
      l.checkin_mode, l.is_gst_registered, l.gstin,
      l.is_specified_premises, l.is_active, l.created_at,
      l.has_rooms, l.serves_food, l.food_room_service, l.food_table_service, l.has_events,
      l.has_assets, l.has_expenses, l.has_other_services, l.has_housekeeping, l.has_laundry,
      l.logo_path, l.show_logo_on_receipt,
      u.name AS owner_name, u.phone AS owner_phone, u.email AS owner_email
    FROM dbo.lodges l
    OUTER APPLY (
      SELECT TOP 1 name, phone, email
      FROM dbo.users
      WHERE lodge_id = l.id AND role = 'OWNER'
      ORDER BY created_at
    ) u
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
      id, name, slug, booking_code, phone, whatsapp_number, address, name_mr, address_mr, city, state,
      latitude, longitude,
      checkin_mode, is_gst_registered, gstin, is_specified_premises,
      has_rooms, serves_food, food_room_service, food_table_service, has_events,
      has_assets, has_expenses, has_other_services, has_housekeeping, has_laundry,
      check_out_time, check_in_time, early_arrival_from, late_grace_minutes, late_half_day_percent,
      late_full_day_after_minutes, late_full_day_percent,
      logo_path, show_logo_on_receipt, hero_image_path,
      is_active, created_at
    FROM dbo.lodges
    WHERE id = @id;

    -- Every login on the property, owner and staff alike. No password
    -- material is selected: this screen shows who can sign in, never how.
    SELECT id, name, email, phone, role, is_active, created_at, last_seen
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

// The same cross-field rules createLodgeSchema enforces, applied to the row
// as it will be after the edit. Stated once here rather than duplicated as
// zod refines, because an edit only carries the fields that changed.
function assertProfileConsistent(row) {
  if (!row.has_rooms && !row.serves_food && !row.has_events) {
    throw new ApiError('A property with no rooms, no food service and no venue has nothing to sell.', 400);
  }
  if (row.is_gst_registered && !row.gstin) {
    throw new ApiError('Enter the GSTIN, or turn off GST registration.', 400);
  }
  if (row.has_housekeeping && !row.has_rooms && !row.has_events) {
    throw new ApiError('Housekeeping looks after rooms and event venues - turn on rooms or events first.', 400);
  }
  if (row.has_laundry && !row.has_rooms && !row.has_events) {
    throw new ApiError('Laundry looks after room and venue linen - turn on rooms or events first.', 400);
  }
  if (row.has_other_services && !row.has_rooms) {
    throw new ApiError('Other services are sold from the rooms side - turn on rooms first.', 400);
  }
  if (row.food_room_service && !row.has_rooms) {
    throw new ApiError('In-room ordering needs rooms - turn it off for a restaurant.', 400);
  }
  if (!row.serves_food && (row.food_room_service || row.food_table_service)) {
    throw new ApiError('Turn on food service before choosing how orders are taken.', 400);
  }
  if (row.is_specified_premises && !(row.has_rooms && row.serves_food)) {
    throw new ApiError('Specified premises only applies to a property that has rooms and serves food.', 400);
  }
  if ((row.latitude === null) !== (row.longitude === null)) {
    throw new ApiError('Enter both latitude and longitude, or leave both empty.', 400);
  }
}

// Internal staff correcting a property after onboarding: a wrong phone
// number, a GSTIN that arrived late, a hall the owner has since built. Absent
// fields are left alone; '' clears a text field.
async function updateLodge(id, input) {
  const pool = await getPool();
  const current = (
    await pool.request().input('id', sql.BigInt, id).query('SELECT * FROM dbo.lodges WHERE id = @id')
  ).recordset[0];
  if (!current) throw new ApiError('Lodge not found.', 404);

  const text = (key, column) => (input[key] !== undefined ? input[key] || null : current[column]);
  const flag = (key, column) => (input[key] !== undefined ? (input[key] ? 1 : 0) : current[column] ? 1 : 0);

  const next = {
    name: input.lodgeName ?? current.name,
    slug: input.slug ?? current.slug,
    booking_code: input.bookingCode ?? current.booking_code,
    phone: text('phone', 'phone'),
    whatsapp_number: text('whatsappNumber', 'whatsapp_number'),
    address: text('address', 'address'),
    name_mr: text('lodgeNameMr', 'name_mr'),
    address_mr: text('addressMr', 'address_mr'),
    city: text('city', 'city'),
    state: text('state', 'state'),
    // Not the text helper: a coordinate of 0 is a real value, and null from
    // the caller means "clear the pin", which is also what an absent column
    // reads as.
    latitude: input.latitude !== undefined ? input.latitude : current.latitude ?? null,
    longitude: input.longitude !== undefined ? input.longitude : current.longitude ?? null,
    checkin_mode: input.checkinMode ?? current.checkin_mode,
    is_gst_registered: flag('isGstRegistered', 'is_gst_registered'),
    gstin: text('gstin', 'gstin'),
    is_specified_premises: flag('isSpecifiedPremises', 'is_specified_premises'),
    has_rooms: flag('hasRooms', 'has_rooms'),
    serves_food: flag('servesFood', 'serves_food'),
    food_room_service: flag('foodRoomService', 'food_room_service'),
    food_table_service: flag('foodTableService', 'food_table_service'),
    has_events: flag('hasEvents', 'has_events'),
    has_assets: flag('hasAssets', 'has_assets'),
    has_expenses: flag('hasExpenses', 'has_expenses'),
    has_other_services: flag('hasOtherServices', 'has_other_services'),
    has_housekeeping: flag('hasHousekeeping', 'has_housekeeping'),
    has_laundry: flag('hasLaundry', 'has_laundry'),
    is_active: flag('isActive', 'is_active'),
    show_logo_on_receipt: flag('showLogoOnReceipt', 'show_logo_on_receipt'),
  };
  assertProfileConsistent(next);

  // Guest laundry is billed when it is handed over. Switching the section off
  // with orders still open would strand them: taken in, never billed.
  if (current.has_laundry && !next.has_laundry) {
    const open = (
      await pool
        .request()
        .input('id', sql.BigInt, id)
        .query("SELECT COUNT(*) AS n FROM dbo.laundry_orders WHERE lodge_id = @id AND status IN ('RECEIVED', 'WASHING', 'READY')")
    ).recordset[0].n;
    if (open > 0) {
      throw new ApiError(
        `${open} guest laundry ${open === 1 ? 'order is' : 'orders are'} still open. Hand over or cancel ${open === 1 ? 'it' : 'them'} first, then switch Laundry off.`,
        409
      );
    }
  }

  if (next.slug !== current.slug) {
    const taken = await pool
      .request()
      .input('slug', sql.NVarChar, next.slug)
      .input('id', sql.BigInt, id)
      .query('SELECT id FROM dbo.lodges WHERE slug = @slug AND id <> @id');
    if (taken.recordset.length > 0) throw new ApiError('A property with that slug already exists.', 409, 'edit-slug');
  }

  // The code is baked into every number already issued, so it can only change
  // while the property has issued none. Compared against the stored value, so
  // re-sending the same code alongside other edits is fine.
  if (next.booking_code !== current.booking_code) {
    const clash = await pool
      .request()
      .input('code', sql.NVarChar, next.booking_code)
      .input('id', sql.BigInt, id)
      .query('SELECT id FROM dbo.lodges WHERE booking_code = @code AND id <> @id');
    if (clash.recordset.length > 0) {
      throw new ApiError('That booking code is already used by another property.', 409, 'edit-bookingCode');
    }
    const issued = await pool
      .request()
      .input('id', sql.BigInt, id)
      .query('SELECT COUNT(*) AS n FROM dbo.bookings WHERE lodge_id = @id AND booking_number IS NOT NULL');
    if (issued.recordset[0].n > 0) {
      throw new ApiError(
        'This property already has booking numbers, so its code can no longer be changed.',
        409,
        'edit-bookingCode'
      );
    }
  }

  await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('name', sql.NVarChar, next.name)
    .input('slug', sql.NVarChar, next.slug)
    .input('bookingCode', sql.NVarChar, next.booking_code)
    .input('phone', sql.NVarChar, next.phone)
    .input('whatsappNumber', sql.NVarChar, next.whatsapp_number)
    .input('address', sql.NVarChar, next.address)
    .input('nameMr', sql.NVarChar, next.name_mr)
    .input('addressMr', sql.NVarChar, next.address_mr)
    .input('city', sql.NVarChar, next.city)
    .input('state', sql.NVarChar, next.state)
    .input('latitude', sql.Decimal(9, 6), next.latitude)
    .input('longitude', sql.Decimal(9, 6), next.longitude)
    .input('checkinMode', sql.NVarChar, next.checkin_mode)
    .input('isGstRegistered', sql.Bit, next.is_gst_registered)
    .input('gstin', sql.NVarChar, next.gstin)
    .input('isSpecifiedPremises', sql.Bit, next.is_specified_premises)
    .input('hasRooms', sql.Bit, next.has_rooms)
    .input('servesFood', sql.Bit, next.serves_food)
    .input('foodRoomService', sql.Bit, next.food_room_service)
    .input('foodTableService', sql.Bit, next.food_table_service)
    .input('hasEvents', sql.Bit, next.has_events)
    .input('hasAssets', sql.Bit, next.has_assets)
    .input('hasExpenses', sql.Bit, next.has_expenses)
    .input('hasOtherServices', sql.Bit, next.has_other_services)
    .input('hasHousekeeping', sql.Bit, next.has_housekeeping)
    .input('hasLaundry', sql.Bit, next.has_laundry)
    .input('isActive', sql.Bit, next.is_active)
    .input('showLogoOnReceipt', sql.Bit, next.show_logo_on_receipt)
    .query(`
      UPDATE dbo.lodges
      SET name = @name, slug = @slug, booking_code = @bookingCode, phone = @phone, whatsapp_number = @whatsappNumber,
          address = @address, name_mr = @nameMr, address_mr = @addressMr, city = @city, state = @state,
          latitude = @latitude, longitude = @longitude,
          checkin_mode = @checkinMode, is_gst_registered = @isGstRegistered, gstin = @gstin,
          is_specified_premises = @isSpecifiedPremises,
          has_rooms = @hasRooms, serves_food = @servesFood, food_room_service = @foodRoomService,
          food_table_service = @foodTableService, has_events = @hasEvents,
          has_assets = @hasAssets, has_expenses = @hasExpenses, has_other_services = @hasOtherServices,
          has_housekeeping = @hasHousekeeping, has_laundry = @hasLaundry, is_active = @isActive,
          show_logo_on_receipt = @showLogoOnReceipt
      WHERE id = @id
    `);

  // The owner's own login row, not a column on dbo.lodges — only touched when
  // the caller actually sent one of these two fields, so an edit that never
  // mentions the owner leaves their login exactly as they set it.
  if (input.ownerName !== undefined || input.ownerPhone !== undefined || input.ownerEmail !== undefined) {
    const ownerRow = (
      await pool
        .request()
        .input('id', sql.BigInt, id)
        .query("SELECT TOP 1 id, name, phone, email FROM dbo.users WHERE lodge_id = @id AND role = 'OWNER' ORDER BY created_at")
    ).recordset[0];
    if (ownerRow) {
      await pool
        .request()
        .input('userId', sql.BigInt, ownerRow.id)
        .input('name', sql.NVarChar, input.ownerName ?? ownerRow.name)
        .input('phone', sql.NVarChar, input.ownerPhone ?? ownerRow.phone)
        // '' clears it, same as every other optional text field here — an
        // owner can legitimately have no email on file.
        .input('email', sql.NVarChar, (input.ownerEmail !== undefined ? input.ownerEmail : ownerRow.email) || null)
        .query('UPDATE dbo.users SET name = @name, phone = @phone, email = @email WHERE id = @userId');
    }
  }

  return getLodgeDetail(id);
}

// Deletes the file backing a stored logo_path, best-effort — a file already
// gone must not block replacing or clearing the row.
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

// Internal staff setting or replacing a property's logo, e.g. during
// onboarding when the owner has handed it over but has no dashboard login yet.
async function updateLodgeLogo(id, filename) {
  const pool = await getPool();
  const current = (
    await pool.request().input('id', sql.BigInt, id).query('SELECT logo_path FROM dbo.lodges WHERE id = @id')
  ).recordset[0];
  if (!current) throw new ApiError('Lodge not found.', 404);

  await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('logoPath', sql.NVarChar, filename)
    .query('UPDATE dbo.lodges SET logo_path = @logoPath WHERE id = @id');

  await deleteLogoFile(current.logo_path);
  return getLodgeDetail(id);
}

async function removeLodgeLogo(id) {
  const pool = await getPool();
  const current = (
    await pool.request().input('id', sql.BigInt, id).query('SELECT logo_path FROM dbo.lodges WHERE id = @id')
  ).recordset[0];
  if (!current) throw new ApiError('Lodge not found.', 404);

  await pool
    .request()
    .input('id', sql.BigInt, id)
    .query('UPDATE dbo.lodges SET logo_path = NULL, show_logo_on_receipt = 0 WHERE id = @id');

  await deleteLogoFile(current.logo_path);
  return getLodgeDetail(id);
}

// Deletes the file backing a stored hero_image_path, best-effort — same
// reasoning as deleteLogoFile.
async function deleteHeroImageFile(heroImagePath) {
  if (!heroImagePath) return;
  try {
    await fs.unlink(path.join(HERO_IMAGE_DIR, heroImagePath));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn({ err, heroImagePath }, 'Could not delete old lodge hero image file');
    }
  }
}

// Internal staff setting or replacing a property's public-page hero
// background, e.g. during onboarding when the owner has handed over photos
// but has no dashboard login yet. Left unset, the page falls back to the
// first room/venue photo.
async function updateLodgeHeroImage(id, filename) {
  const pool = await getPool();
  const current = (
    await pool.request().input('id', sql.BigInt, id).query('SELECT hero_image_path FROM dbo.lodges WHERE id = @id')
  ).recordset[0];
  if (!current) throw new ApiError('Lodge not found.', 404);

  await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('heroImagePath', sql.NVarChar, filename)
    .query('UPDATE dbo.lodges SET hero_image_path = @heroImagePath WHERE id = @id');

  await deleteHeroImageFile(current.hero_image_path);
  return getLodgeDetail(id);
}

async function removeLodgeHeroImage(id) {
  const pool = await getPool();
  const current = (
    await pool.request().input('id', sql.BigInt, id).query('SELECT hero_image_path FROM dbo.lodges WHERE id = @id')
  ).recordset[0];
  if (!current) throw new ApiError('Lodge not found.', 404);

  await pool.request().input('id', sql.BigInt, id).query('UPDATE dbo.lodges SET hero_image_path = NULL WHERE id = @id');

  await deleteHeroImageFile(current.hero_image_path);
  return getLodgeDetail(id);
}

function toIsoDate(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

// Inclusive of both ends, same as reports.service.js's datesInRange.
function datesInRange(fromDate, toDate) {
  const dates = [];
  const cur = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

// The four widgets the Overview dashboard needs beyond what getLodgeDetail
// already carries — kept as a second call so a lodge with no rooms/no food
// doesn't pay for queries it has nothing to show, and so the Food Orders
// period toggle only re-fetches this, not the whole page.
async function getLodgeDashboard(id, { foodPeriod = 'today' } = {}) {
  const pool = await getPool();

  const today = toIsoDate(new Date());
  const weekAgo = toIsoDate(new Date(Date.now() - 6 * 86400000));
  const foodFrom = foodPeriod === '7d' ? weekAgo : today;

  const roomDistributionResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, id)
    .query(`
      SELECT c.name, COUNT(r.id) AS room_count
      FROM dbo.room_categories c
      LEFT JOIN dbo.rooms r ON r.category_id = c.id AND r.is_active = 1
      WHERE c.lodge_id = @lodgeId
      GROUP BY c.name
      ORDER BY room_count DESC
    `);
  const roomDistribution = roomDistributionResult.recordset.map((row) => ({
    name: row.name,
    count: row.room_count,
  }));

  // Same overlap pattern as reports.service.js's getOccupancyReport, split
  // into two buckets instead of one: every non-cancelled booking counts as
  // "sold" for a day it covers, and the ones actually checked in also count
  // as "in house".
  const bookingRoomsResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, id)
    .input('fromDate', sql.Date, weekAgo)
    .input('toDate', sql.Date, today)
    .query(`
      SELECT br.room_id, br.check_in_date, br.check_out_date, br.status
      FROM dbo.booking_rooms br
      JOIN dbo.bookings b ON b.id = br.booking_id
      WHERE b.lodge_id = @lodgeId AND br.status <> 'CANCELLED'
        AND br.check_in_date < DATEADD(day, 1, @toDate) AND br.check_out_date > @fromDate
    `);
  const trendDates = datesInRange(weekAgo, today);
  const soldByDate = new Map(trendDates.map((d) => [d, new Set()]));
  const inHouseByDate = new Map(trendDates.map((d) => [d, new Set()]));
  for (const row of bookingRoomsResult.recordset) {
    const stayStart = toIsoDate(row.check_in_date);
    const stayEnd = toIsoDate(row.check_out_date);
    for (const date of trendDates) {
      if (date >= stayStart && date < stayEnd) {
        soldByDate.get(date).add(row.room_id);
        if (row.status === 'CHECKED_IN') inHouseByDate.get(date).add(row.room_id);
      }
    }
  }
  const bookingTrend = trendDates.map((date) => ({
    date,
    sold: soldByDate.get(date).size,
    inHouse: inHouseByDate.get(date).size,
  }));

  const foodBySourceResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, id)
    .input('fromDate', sql.Date, foodFrom)
    .input('toDate', sql.Date, today)
    .query(`
      SELECT source, COUNT(*) AS n
      FROM dbo.food_orders
      WHERE lodge_id = @lodgeId AND status <> 'CANCELLED' AND order_date BETWEEN @fromDate AND @toDate
      GROUP BY source
    `);
  const foodBySource = foodBySourceResult.recordset.map((row) => ({ source: row.source, count: row.n }));

  // Recent activity across the property, newest first. No money anywhere —
  // an invoice or a payment is shown as the event it is, not as a figure
  // platform staff have no reason to be reading off someone else's bill.
  const activityResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, id)
    .query(`
      SELECT TOP 50 kind, detail, occurred_at FROM (
        SELECT 'INVOICE' AS kind, CASE WHEN r.room_number IS NOT NULL THEN 'Room ' + r.room_number ELSE 'Food bill' END AS detail,
               i.created_at AS occurred_at
        FROM dbo.invoices i
        LEFT JOIN dbo.bookings b ON b.id = i.booking_id
        LEFT JOIN dbo.rooms r ON r.id = b.room_id
        WHERE i.lodge_id = @lodgeId AND i.status = 'ISSUED'

        UNION ALL
        SELECT 'BOOKING', 'Room ' + r.room_number, b.created_at
        FROM dbo.bookings b
        JOIN dbo.rooms r ON r.id = b.room_id
        WHERE b.lodge_id = @lodgeId

        UNION ALL
        SELECT 'FOOD_ORDER',
               CASE fo.source
                 WHEN 'TABLE' THEN 'Table ' + t.label
                 WHEN 'ROOM' THEN 'Room ' + r.room_number
                 ELSE 'Counter'
               END,
               fo.placed_at
        FROM dbo.food_orders fo
        LEFT JOIN dbo.dining_tables t ON t.id = fo.table_id
        LEFT JOIN dbo.rooms r ON r.id = fo.room_id
        WHERE fo.lodge_id = @lodgeId

        UNION ALL
        SELECT 'CHECK_IN', 'Room ' + r.room_number, b.actual_check_in_at
        FROM dbo.bookings b
        JOIN dbo.rooms r ON r.id = b.room_id
        WHERE b.lodge_id = @lodgeId AND b.actual_check_in_at IS NOT NULL

        UNION ALL
        SELECT 'PAYMENT', pl.method, pl.created_at
        FROM dbo.payment_lines pl
        WHERE pl.lodge_id = @lodgeId
      ) activity
      ORDER BY occurred_at DESC
    `);
  const activity = activityResult.recordset.map((row) => ({
    type: row.kind,
    detail: row.detail,
    occurredAt: row.occurred_at,
  }));

  return { roomDistribution, bookingTrend, foodBySource, activity };
}

module.exports = {
  createLodgeWithOwner,
  listLodges,
  getLodgeDetail,
  updateLodge,
  updateLodgeLogo,
  removeLodgeLogo,
  updateLodgeHeroImage,
  removeLodgeHeroImage,
  getLodgeDashboard,
};
