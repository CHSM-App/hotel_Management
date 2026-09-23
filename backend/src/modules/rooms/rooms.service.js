const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');

// bed_size is the legacy single-value column. It is kept in step with beds[0]
// because the public room-type page, the booking chip, the price simulator and
// the room card all still read it — deriving it here is what let those four go
// untouched. Never set on its own.
function primaryBedSize(beds) {
  return beds && beds.length > 0 ? beds[0].size : null;
}

// Rooms added before the beds column read as a one-entry list, so callers get
// the same shape for every room and need no "old row" branch.
function parseBeds(row) {
  if (row.beds) {
    try {
      return JSON.parse(row.beds);
    } catch {
      // A hand-edited row. The single-value column is still trustworthy.
    }
  }
  return row.bed_size ? [{ size: row.bed_size, count: 1 }] : [];
}

// A dormitory room's own rate if it has one, else the category's — the same
// fallback pricing.service.js's basePriceOf uses when it actually prices a
// stay. This copy is for display only (the room card, the tape chart), so
// the two staying in step matters more than sharing the function.
function computePrice(categoryBasePrice, dormitoryPrice) {
  if (dormitoryPrice != null) return Number(dormitoryPrice);
  return Number(categoryBasePrice);
}

async function listRooms(lodgeId) {
  const pool = await getPool();

  const roomsResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT r.id, r.room_number, r.floor, r.bed_size, r.beds, r.bathroom_type, r.max_occupancy, r.description,
             r.is_active, r.is_dormitory, r.dormitory_price, r.dormitory_gender, r.dormitory_is_ac, r.created_at,
             c.id AS category_id, c.name AS category_name, c.base_price AS category_base_price,
             CASE WHEN b.id IS NULL THEN 0 ELSE 1 END AS is_occupied
      FROM dbo.rooms r
      JOIN dbo.room_categories c ON c.id = r.category_id
      OUTER APPLY (
        SELECT TOP 1 id FROM dbo.bookings
        WHERE room_id = r.id AND lodge_id = @lodgeId AND status = 'CHECKED_IN'
      ) b
      WHERE r.lodge_id = @lodgeId
      ORDER BY TRY_CAST(r.room_number AS INT) ASC, r.room_number ASC
    `);

  const switchableChargesResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT rsc.room_id, sc.id, sc.name, sc.charge_per_night
      FROM dbo.room_switchable_charges rsc
      JOIN dbo.switchable_charges sc ON sc.id = rsc.charge_id
      JOIN dbo.rooms r ON r.id = rsc.room_id
      WHERE r.lodge_id = @lodgeId
    `);

  const switchableChargesByRoom = new Map();
  for (const row of switchableChargesResult.recordset) {
    const list = switchableChargesByRoom.get(row.room_id) || [];
    list.push({ id: row.id, name: row.name, chargePerNight: Number(row.charge_per_night) });
    switchableChargesByRoom.set(row.room_id, list);
  }

  const imagesResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT ri.id, ri.room_id, ri.filename
      FROM dbo.room_images ri
      JOIN dbo.rooms r ON r.id = ri.room_id
      WHERE r.lodge_id = @lodgeId
      ORDER BY ri.sort_order ASC, ri.id ASC
    `);

  const imagesByRoom = new Map();
  for (const row of imagesResult.recordset) {
    const list = imagesByRoom.get(row.room_id) || [];
    list.push({ id: row.id, filename: row.filename });
    imagesByRoom.set(row.room_id, list);
  }

  const dormitoryRoomIds = roomsResult.recordset.filter((r) => r.is_dormitory).map((r) => r.id);
  const bedsByRoom = await listBedsForRooms(pool, dormitoryRoomIds);

  return roomsResult.recordset.map((row) => ({
    id: row.id,
    roomNumber: row.room_number,
    floor: row.floor,
    bedSize: row.bed_size,
    beds: parseBeds(row),
    bathroomType: row.bathroom_type,
    maxOccupancy: row.max_occupancy,
    description: row.description,
    isActive: !!row.is_active,
    isOccupied: !!row.is_occupied,
    isDormitory: !!row.is_dormitory,
    dormitoryPrice: row.dormitory_price != null ? Number(row.dormitory_price) : null,
    dormitoryGender: row.dormitory_gender,
    dormitoryIsAc: row.dormitory_is_ac,
    createdAt: row.created_at,
    category: { id: row.category_id, name: row.category_name, basePrice: Number(row.category_base_price) },
    switchableCharges: switchableChargesByRoom.get(row.id) || [],
    images: imagesByRoom.get(row.id) || [],
    // bedsByRoom is keyed by Number (see listBedsForRooms) — row.id is the
    // raw driver value, so it needs the same coercion the other two maps
    // above don't, because those are keyed by that same raw value on both
    // sides.
    dormitoryBeds: row.is_dormitory ? bedsByRoom.get(Number(row.id)) || [] : undefined,
    price: computePrice(row.category_base_price, row.dormitory_price),
  }));
}

function buildRoomNumbers(input) {
  if (input.roomNumber) {
    return [input.roomNumber];
  }
  const numbers = [];
  for (let n = input.rangeStart; n <= input.rangeEnd; n += 1) {
    numbers.push(String(n));
  }
  return numbers;
}

async function createRooms(lodgeId, input) {
  const pool = await getPool();

  const category = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, input.categoryId)
    .query('SELECT id FROM dbo.room_categories WHERE id = @categoryId AND lodge_id = @lodgeId');

  if (category.recordset.length === 0) {
    throw new ApiError('Choose a valid category.', 400, 'categoryId');
  }

  if (input.switchableChargeIds.length > 0) {
    const charges = await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .query('SELECT id FROM dbo.switchable_charges WHERE lodge_id = @lodgeId');
    const validIds = new Set(charges.recordset.map((r) => Number(r.id)));
    if (!input.switchableChargeIds.every((id) => validIds.has(id))) {
      throw new ApiError('One or more switchable charges are invalid.', 400);
    }
  }

  const roomNumbers = buildRoomNumbers(input);

  const existing = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query('SELECT room_number FROM dbo.rooms WHERE lodge_id = @lodgeId');
  const taken = new Set(existing.recordset.map((r) => r.room_number));
  const conflicts = roomNumbers.filter((n) => taken.has(n));
  if (conflicts.length > 0) {
    // Single mode names one field to land the message under; a range spans
    // rangeStart..rangeEnd, and the message names which numbers in it clash
    // rather than pretending one end of the range is the problem.
    throw new ApiError(
      `Room number already in use: ${conflicts.join(', ')}.`,
      409,
      input.roomNumber ? 'roomNumber' : 'rangeStart'
    );
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const createdIds = [];
    for (const roomNumber of roomNumbers) {
      const result = await new sql.Request(transaction)
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('roomNumber', sql.NVarChar, roomNumber)
        .input('categoryId', sql.BigInt, input.categoryId)
        .input('floor', sql.NVarChar, input.floor || null)
        .input('bedSize', sql.NVarChar, primaryBedSize(input.beds))
        // A dormitory arrives with no beds array at all — its beds are
        // dormitory_beds rows, not this column — so the room saves with
        // beds NULL rather than the literal string "undefined".
        .input('beds', sql.NVarChar, input.beds ? JSON.stringify(input.beds) : null)
        .input('bathroomType', sql.NVarChar, input.bathroomType ?? null)
        .input('maxOccupancy', sql.Int, input.maxOccupancy ?? null)
        .input('description', sql.NVarChar, input.description || null)
        .input('isDormitory', sql.Bit, input.isDormitory ? 1 : 0)
        .input('dormitoryPrice', sql.Decimal(10, 2), input.isDormitory ? (input.dormitoryPrice ?? null) : null)
        .input('dormitoryGender', sql.NVarChar, input.isDormitory ? (input.dormitoryGender ?? null) : null)
        .input('dormitoryIsAc', sql.NVarChar, input.isDormitory ? (input.dormitoryIsAc ?? null) : null)
        .query(`
          INSERT INTO dbo.rooms
            (lodge_id, room_number, category_id, floor, bed_size, beds, bathroom_type, max_occupancy, description,
             is_dormitory, dormitory_price, dormitory_gender, dormitory_is_ac)
          OUTPUT inserted.id
          VALUES
            (@lodgeId, @roomNumber, @categoryId, @floor, @bedSize, @beds, @bathroomType, @maxOccupancy, @description,
             @isDormitory, @dormitoryPrice, @dormitoryGender, @dormitoryIsAc)
        `);

      const roomId = result.recordset[0].id;
      createdIds.push(roomId);

      for (const chargeId of input.switchableChargeIds) {
        await new sql.Request(transaction)
          .input('roomId', sql.BigInt, roomId)
          .input('chargeId', sql.BigInt, chargeId)
          .query(
            'INSERT INTO dbo.room_switchable_charges (room_id, charge_id) VALUES (@roomId, @chargeId)'
          );
      }
    }

    await transaction.commit();
    return { roomIds: createdIds, roomNumbers };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function updateRoom(lodgeId, roomId, input) {
  const pool = await getPool();

  const roomResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roomId', sql.BigInt, roomId)
    .query('SELECT id FROM dbo.rooms WHERE id = @roomId AND lodge_id = @lodgeId');
  if (roomResult.recordset.length === 0) {
    throw new ApiError('Room not found.', 404);
  }

  const category = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('categoryId', sql.BigInt, input.categoryId)
    .query('SELECT id FROM dbo.room_categories WHERE id = @categoryId AND lodge_id = @lodgeId');
  if (category.recordset.length === 0) {
    throw new ApiError('Choose a valid category.', 400, 'categoryId');
  }

  if (input.switchableChargeIds && input.switchableChargeIds.length > 0) {
    const charges = await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .query('SELECT id FROM dbo.switchable_charges WHERE lodge_id = @lodgeId');
    const validIds = new Set(charges.recordset.map((r) => Number(r.id)));
    if (!input.switchableChargeIds.every((id) => validIds.has(id))) {
      throw new ApiError('One or more switchable charges are invalid.', 400);
    }
  }

  const conflict = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roomId', sql.BigInt, roomId)
    .input('roomNumber', sql.NVarChar, input.roomNumber)
    .query('SELECT id FROM dbo.rooms WHERE lodge_id = @lodgeId AND room_number = @roomNumber AND id <> @roomId');
  if (conflict.recordset.length > 0) {
    throw new ApiError('Room number already in use.', 409, 'roomNumber');
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction)
      .input('roomId', sql.BigInt, roomId)
      .input('roomNumber', sql.NVarChar, input.roomNumber)
      .input('categoryId', sql.BigInt, input.categoryId)
      .input('floor', sql.NVarChar, input.floor || null)
      .input('bedSize', sql.NVarChar, primaryBedSize(input.beds))
      .input('beds', sql.NVarChar, input.beds ? JSON.stringify(input.beds) : null)
      .input('bathroomType', sql.NVarChar, input.bathroomType)
      .input('maxOccupancy', sql.Int, input.maxOccupancy ?? null)
      .input('description', sql.NVarChar, input.description || null)
      .input('isDormitory', sql.Bit, input.isDormitory ? 1 : 0)
      .input('dormitoryPrice', sql.Decimal(10, 2), input.isDormitory ? (input.dormitoryPrice ?? null) : null)
      .input('dormitoryGender', sql.NVarChar, input.isDormitory ? (input.dormitoryGender ?? null) : null)
      .input('dormitoryIsAc', sql.NVarChar, input.isDormitory ? (input.dormitoryIsAc ?? null) : null)
      .query(`
        UPDATE dbo.rooms
        SET room_number = @roomNumber, category_id = @categoryId, floor = @floor,
            bed_size = @bedSize, beds = @beds, bathroom_type = @bathroomType, max_occupancy = @maxOccupancy,
            description = @description, is_dormitory = @isDormitory,
            dormitory_price = @dormitoryPrice, dormitory_gender = @dormitoryGender, dormitory_is_ac = @dormitoryIsAc
        WHERE id = @roomId
      `);

    if (input.switchableChargeIds) {
      await new sql.Request(transaction)
        .input('roomId', sql.BigInt, roomId)
        .query('DELETE FROM dbo.room_switchable_charges WHERE room_id = @roomId');

      for (const chargeId of input.switchableChargeIds) {
        await new sql.Request(transaction)
          .input('roomId', sql.BigInt, roomId)
          .input('chargeId', sql.BigInt, chargeId)
          .query('INSERT INTO dbo.room_switchable_charges (room_id, charge_id) VALUES (@roomId, @chargeId)');
      }
    }

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  return { id: roomId };
}

// Rooms are referenced by bookings, features and switchable-charge links, so
// "delete" deactivates rather than removing the row — same convention as
// categories and switchable charges, which are also historically referenced.
async function setRoomActive(lodgeId, roomId, isActive) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roomId', sql.BigInt, roomId)
    .input('isActive', sql.Bit, isActive)
    .query(`
      UPDATE dbo.rooms SET is_active = @isActive
      OUTPUT inserted.id
      WHERE id = @roomId AND lodge_id = @lodgeId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Room not found.', 404);
  }
  return { id: roomId };
}

// True delete, for when a room was never actually used — blocked once any
// booking references it (deactivating is the only option at that point, to
// keep booking/billing history intact). room_features and
// room_switchable_charges are pure capability links with no independent
// history, so those are cleaned up automatically. dormitory_beds is the same
// kind of link for a dormitory room — every booking row carries room_id
// regardless of whether it also carries bed_id, so the bookings check below
// already rules out an in-use bed before any of this runs; an unused
// dormitory's bed rows are just as disposable as its features would be.
async function deleteRoom(lodgeId, roomId) {
  const pool = await getPool();

  const roomResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roomId', sql.BigInt, roomId)
    .query('SELECT id FROM dbo.rooms WHERE id = @roomId AND lodge_id = @lodgeId');
  if (roomResult.recordset.length === 0) {
    throw new ApiError('Room not found.', 404);
  }

  const bookingsResult = await pool
    .request()
    .input('roomId', sql.BigInt, roomId)
    .query('SELECT TOP 1 id FROM dbo.bookings WHERE room_id = @roomId');
  if (bookingsResult.recordset.length > 0) {
    throw new ApiError(
      'This room has bookings on record and can’t be permanently deleted — deactivate it instead.',
      409
    );
  }

  const imagesResult = await pool
    .request()
    .input('roomId', sql.BigInt, roomId)
    .query('SELECT filename FROM dbo.room_images WHERE room_id = @roomId');
  const imageFilenames = imagesResult.recordset.map((r) => r.filename);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction)
      .input('roomId', sql.BigInt, roomId)
      .query('DELETE FROM dbo.room_features WHERE room_id = @roomId');
    await new sql.Request(transaction)
      .input('roomId', sql.BigInt, roomId)
      .query('DELETE FROM dbo.room_switchable_charges WHERE room_id = @roomId');
    await new sql.Request(transaction)
      .input('roomId', sql.BigInt, roomId)
      .query('DELETE FROM dbo.dormitory_beds WHERE room_id = @roomId');
    await new sql.Request(transaction)
      .input('roomId', sql.BigInt, roomId)
      .query('DELETE FROM dbo.room_images WHERE room_id = @roomId');
    await new sql.Request(transaction)
      .input('roomId', sql.BigInt, roomId)
      .query('DELETE FROM dbo.rooms WHERE id = @roomId');
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  return imageFilenames;
}

// Appends to whatever images a room already has — uploading more photos
// later doesn't replace the existing gallery, only deleteRoomImage does.
async function addRoomImages(lodgeId, roomId, filenames) {
  if (filenames.length === 0) return;
  const pool = await getPool();

  const roomResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roomId', sql.BigInt, roomId)
    .query('SELECT id FROM dbo.rooms WHERE id = @roomId AND lodge_id = @lodgeId');
  if (roomResult.recordset.length === 0) {
    throw new ApiError('Room not found.', 404);
  }

  const sortResult = await pool
    .request()
    .input('roomId', sql.BigInt, roomId)
    .query('SELECT MAX(sort_order) AS maxSortOrder FROM dbo.room_images WHERE room_id = @roomId');
  let nextSortOrder = (sortResult.recordset[0].maxSortOrder ?? -1) + 1;

  for (const filename of filenames) {
    await pool
      .request()
      .input('roomId', sql.BigInt, roomId)
      .input('filename', sql.NVarChar, filename)
      .input('sortOrder', sql.Int, nextSortOrder)
      .query(
        'INSERT INTO dbo.room_images (room_id, filename, sort_order) VALUES (@roomId, @filename, @sortOrder)'
      );
    nextSortOrder += 1;
  }
}

// Returns the deleted image's filename so the caller can remove it from
// disk — the DB row is the source of truth, not the upload directory.
async function deleteRoomImage(lodgeId, roomId, imageId) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roomId', sql.BigInt, roomId)
    .input('imageId', sql.BigInt, imageId)
    .query(`
      SELECT ri.filename
      FROM dbo.room_images ri
      JOIN dbo.rooms r ON r.id = ri.room_id
      WHERE ri.id = @imageId AND ri.room_id = @roomId AND r.lodge_id = @lodgeId
    `);
  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('Photo not found.', 404);
  }

  await pool.request().input('imageId', sql.BigInt, imageId).query('DELETE FROM dbo.room_images WHERE id = @imageId');

  return row.filename;
}

// Bulk-loads beds for however many dormitory rooms listRooms just fetched,
// instead of one query per room — the same batching addImages/switchable
// charges above already do for their own per-room lists.
//
// Keyed by Number(room_id), not the raw driver value — a BIGINT column comes
// back from mssql/tedious as a JS `bigint` primitive, and `5n !== 5` as Map
// keys. Every caller here looks this map up with a plain Number (roomId
// arrives as one from the route params or an id column already coerced), so
// the map has to be built on the same footing or every lookup misses.
// id/room_id are safe to coerce: SQL Server identity columns never reach
// 2^53, so no BIGINT here is losing precision by going through Number().
async function listBedsForRooms(pool, roomIds) {
  const byRoom = new Map();
  if (roomIds.length === 0) return byRoom;

  const result = await pool.request().query(`
    SELECT id, room_id, bed_label, is_active
    FROM dbo.dormitory_beds
    WHERE room_id IN (${roomIds.map((id) => Number(id)).join(',')})
    -- Not bed_label: it's text, so "Bed 10" sorts right after "Bed 1" and
    -- before "Bed 2". Beds are created in order, so id order is bed order.
    ORDER BY id ASC
  `);
  for (const row of result.recordset) {
    const roomId = Number(row.room_id);
    const list = byRoom.get(roomId) || [];
    list.push({
      id: Number(row.id),
      bedLabel: row.bed_label,
      isActive: !!row.is_active,
    });
    byRoom.set(roomId, list);
  }
  return byRoom;
}

async function assertDormitoryRoom(pool, lodgeId, roomId) {
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roomId', sql.BigInt, roomId)
    .query('SELECT id, is_dormitory FROM dbo.rooms WHERE id = @roomId AND lodge_id = @lodgeId');
  const room = result.recordset[0];
  if (!room) {
    throw new ApiError('Room not found.', 404);
  }
  if (!room.is_dormitory) {
    throw new ApiError('This room isn’t set up as a dormitory.', 400);
  }
}

async function listBeds(lodgeId, roomId) {
  const pool = await getPool();
  await assertDormitoryRoom(pool, lodgeId, roomId);
  const byRoom = await listBedsForRooms(pool, [roomId]);
  return byRoom.get(Number(roomId)) || [];
}

async function createBed(lodgeId, roomId, input) {
  const pool = await getPool();
  await assertDormitoryRoom(pool, lodgeId, roomId);

  const conflict = await pool
    .request()
    .input('roomId', sql.BigInt, roomId)
    .input('bedLabel', sql.NVarChar, input.bedLabel)
    .query('SELECT id FROM dbo.dormitory_beds WHERE room_id = @roomId AND bed_label = @bedLabel');
  if (conflict.recordset.length > 0) {
    throw new ApiError('That bed label is already used in this room.', 409, 'bedLabel');
  }

  const result = await pool
    .request()
    .input('roomId', sql.BigInt, roomId)
    .input('bedLabel', sql.NVarChar, input.bedLabel)
    .query(`
      INSERT INTO dbo.dormitory_beds (room_id, bed_label)
      OUTPUT inserted.id
      VALUES (@roomId, @bedLabel)
    `);

  return { id: result.recordset[0].id, bedLabel: input.bedLabel, isActive: true };
}

async function updateBed(lodgeId, roomId, bedId, input) {
  const pool = await getPool();
  await assertDormitoryRoom(pool, lodgeId, roomId);

  const conflict = await pool
    .request()
    .input('roomId', sql.BigInt, roomId)
    .input('bedId', sql.BigInt, bedId)
    .input('bedLabel', sql.NVarChar, input.bedLabel)
    .query('SELECT id FROM dbo.dormitory_beds WHERE room_id = @roomId AND bed_label = @bedLabel AND id <> @bedId');
  if (conflict.recordset.length > 0) {
    throw new ApiError('That bed label is already used in this room.', 409, 'bedLabel');
  }

  const result = await pool
    .request()
    .input('roomId', sql.BigInt, roomId)
    .input('bedId', sql.BigInt, bedId)
    .input('bedLabel', sql.NVarChar, input.bedLabel)
    .input('isActive', sql.Bit, input.isActive === undefined ? null : input.isActive ? 1 : 0)
    .query(`
      UPDATE dbo.dormitory_beds
      SET bed_label = @bedLabel,
          is_active = CASE WHEN @isActive IS NULL THEN is_active ELSE @isActive END
      OUTPUT inserted.id
      WHERE id = @bedId AND room_id = @roomId
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Bed not found.', 404);
  }

  return { id: bedId };
}

// True delete, same rule as deleteRoom — blocked once any booking has held
// this bed, since that booking's history (and its nightly_breakdown, which
// names the bed) has to keep meaning something.
async function deleteBed(lodgeId, roomId, bedId) {
  const pool = await getPool();
  await assertDormitoryRoom(pool, lodgeId, roomId);

  const bedResult = await pool
    .request()
    .input('roomId', sql.BigInt, roomId)
    .input('bedId', sql.BigInt, bedId)
    .query('SELECT id FROM dbo.dormitory_beds WHERE id = @bedId AND room_id = @roomId');
  if (bedResult.recordset.length === 0) {
    throw new ApiError('Bed not found.', 404);
  }

  const bookingsResult = await pool
    .request()
    .input('bedId', sql.BigInt, bedId)
    .query('SELECT TOP 1 id FROM dbo.bookings WHERE bed_id = @bedId');
  if (bookingsResult.recordset.length > 0) {
    throw new ApiError('This bed has bookings on record and can’t be permanently deleted — deactivate it instead.', 409);
  }

  await pool.request().input('bedId', sql.BigInt, bedId).query('DELETE FROM dbo.dormitory_beds WHERE id = @bedId');
}

// The desk doesn't name beds — it says how many the room has, and this
// reconciles the room's actual dormitory_beds rows to that number. Beds are
// auto-labelled "Bed 1".."Bed N" in order, so growing the count only ever
// appends new ones ("Bed 4", "Bed 5", ...) and shrinking it only ever
// removes from the top end — an existing "Bed 2" never gets renumbered out
// from under a booking that already names it in a nightly_breakdown line.
async function setBedCount(lodgeId, roomId, targetCount) {
  const pool = await getPool();
  await assertDormitoryRoom(pool, lodgeId, roomId);

  const existingResult = await pool
    .request()
    .input('roomId', sql.BigInt, roomId)
    .query('SELECT id, bed_label FROM dbo.dormitory_beds WHERE room_id = @roomId ORDER BY id ASC');
  const existing = existingResult.recordset;
  const currentCount = existing.length;

  if (targetCount === currentCount) {
    return listBeds(lodgeId, roomId);
  }

  if (targetCount > currentCount) {
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      for (let n = currentCount + 1; n <= targetCount; n += 1) {
        await new sql.Request(transaction)
          .input('roomId', sql.BigInt, roomId)
          .input('bedLabel', sql.NVarChar, `Bed ${n}`)
          .query('INSERT INTO dbo.dormitory_beds (room_id, bed_label) VALUES (@roomId, @bedLabel)');
      }
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
    return listBeds(lodgeId, roomId);
  }

  // Shrinking: remove the most-recently-added beds first (highest id, which
  // is also the highest "Bed N" under the sequential naming above), and
  // refuse outright if any of the beds that would have to go still has a
  // booking on record — the same rule deleteBed enforces one at a time, but
  // checked as a batch so the count either drops cleanly or not at all.
  const toRemove = existing.slice(targetCount);
  const removeIds = toRemove.map((b) => Number(b.id));
  const bookedResult = await pool
    .request()
    .query(`SELECT DISTINCT bed_id FROM dbo.bookings WHERE bed_id IN (${removeIds.join(',')})`);
  if (bookedResult.recordset.length > 0) {
    throw new ApiError(
      `Can’t reduce below ${currentCount - bookedResult.recordset.length} — some of those beds have bookings on record. Deactivate them instead of removing the room's count.`,
      409,
      'bedCount'
    );
  }

  await pool.request().query(`DELETE FROM dbo.dormitory_beds WHERE id IN (${removeIds.join(',')})`);
  return listBeds(lodgeId, roomId);
}

module.exports = {
  // Shared with bookings, which lists the same rooms on the booking form.
  parseBeds,
  listRooms,
  createRooms,
  updateRoom,
  setRoomActive,
  deleteRoom,
  addRoomImages,
  deleteRoomImage,
  computePrice,
  listBeds,
  createBed,
  updateBed,
  deleteBed,
  setBedCount,
};
