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

function computePrice(categoryBasePrice) {
  return Number(categoryBasePrice);
}

async function listRooms(lodgeId) {
  const pool = await getPool();

  const roomsResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT r.id, r.room_number, r.floor, r.bed_size, r.beds, r.bathroom_type, r.max_occupancy, r.description,
             r.is_active, r.created_at,
             c.id AS category_id, c.name AS category_name, c.base_price AS category_base_price
      FROM dbo.rooms r
      JOIN dbo.room_categories c ON c.id = r.category_id
      WHERE r.lodge_id = @lodgeId
      ORDER BY r.room_number ASC
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
    createdAt: row.created_at,
    category: { id: row.category_id, name: row.category_name, basePrice: Number(row.category_base_price) },
    switchableCharges: switchableChargesByRoom.get(row.id) || [],
    images: imagesByRoom.get(row.id) || [],
    price: computePrice(row.category_base_price),
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
    throw new ApiError('Choose a valid category.', 400);
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
    throw new ApiError(`Room number already in use: ${conflicts.join(', ')}.`, 409);
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
        .input('beds', sql.NVarChar, JSON.stringify(input.beds))
        .input('bathroomType', sql.NVarChar, input.bathroomType ?? null)
        .input('maxOccupancy', sql.Int, input.maxOccupancy)
        .input('description', sql.NVarChar, input.description || null)
        .query(`
          INSERT INTO dbo.rooms
            (lodge_id, room_number, category_id, floor, bed_size, beds, bathroom_type, max_occupancy, description)
          OUTPUT inserted.id
          VALUES
            (@lodgeId, @roomNumber, @categoryId, @floor, @bedSize, @beds, @bathroomType, @maxOccupancy, @description)
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
    throw new ApiError('Choose a valid category.', 400);
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
    throw new ApiError('Room number already in use.', 409);
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
      .input('beds', sql.NVarChar, JSON.stringify(input.beds))
      .input('bathroomType', sql.NVarChar, input.bathroomType)
      .input('maxOccupancy', sql.Int, input.maxOccupancy)
      .input('description', sql.NVarChar, input.description || null)
      .query(`
        UPDATE dbo.rooms
        SET room_number = @roomNumber, category_id = @categoryId, floor = @floor,
            bed_size = @bedSize, beds = @beds, bathroom_type = @bathroomType, max_occupancy = @maxOccupancy,
            description = @description
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
// history, so those are cleaned up automatically.
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
};
