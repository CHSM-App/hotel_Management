const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');

async function getLodgeBySlug(slug) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('slug', sql.NVarChar, slug)
    .query(`
      SELECT id, name, slug, phone, whatsapp_number, address, city, state
      FROM dbo.lodges
      WHERE slug = @slug AND is_active = 1
    `);

  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('Lodge not found.', 404);
  }

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    phone: row.phone,
    whatsappNumber: row.whatsapp_number,
    address: row.address,
    city: row.city,
    state: row.state,
  };
}

// A stripped-down room listing for the public brochure page — active rooms
// only, no booking/guest data, cheapest category first so the page reads
// like a rate card. When a date range is given, each room also gets an
// `available` flag — same overlap rule as the reception tape chart (a room
// is unavailable if any BOOKED/CHECKED_IN stay overlaps the requested
// range), so a guest sees the same truth staff would see.
async function listPublicRooms(lodgeId, checkInDate, checkOutDate) {
  const pool = await getPool();
  const hasDateRange = Boolean(checkInDate && checkOutDate);

  const roomsRequest = pool.request().input('lodgeId', sql.BigInt, lodgeId);
  let availabilityColumn = '';
  if (hasDateRange) {
    roomsRequest.input('checkInDate', sql.Date, checkInDate).input('checkOutDate', sql.Date, checkOutDate);
    availabilityColumn = `,
             CASE WHEN EXISTS (
               SELECT 1 FROM dbo.bookings b
               WHERE b.room_id = r.id AND b.status IN ('BOOKED', 'CHECKED_IN')
                 AND b.check_in_date < @checkOutDate AND b.check_out_date > @checkInDate
             ) THEN 0 ELSE 1 END AS is_available`;
  }

  const roomsResult = await roomsRequest.query(`
      SELECT r.id, r.room_number, r.floor, r.bed_size, r.bathroom_type, r.max_occupancy, r.description,
             c.name AS category_name, c.base_price AS category_base_price${availabilityColumn}
      FROM dbo.rooms r
      JOIN dbo.room_categories c ON c.id = r.category_id
      WHERE r.lodge_id = @lodgeId AND r.is_active = 1
      ORDER BY c.base_price ASC, r.room_number ASC
    `);

  const imagesResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT ri.room_id, ri.filename
      FROM dbo.room_images ri
      JOIN dbo.rooms r ON r.id = ri.room_id
      WHERE r.lodge_id = @lodgeId AND r.is_active = 1
      ORDER BY ri.sort_order ASC, ri.id ASC
    `);

  const imagesByRoom = new Map();
  for (const row of imagesResult.recordset) {
    const list = imagesByRoom.get(row.room_id) || [];
    list.push(row.filename);
    imagesByRoom.set(row.room_id, list);
  }

  return roomsResult.recordset.map((row) => ({
    id: row.id,
    roomNumber: row.room_number,
    floor: row.floor,
    bedSize: row.bed_size,
    bathroomType: row.bathroom_type,
    maxOccupancy: row.max_occupancy,
    description: row.description,
    categoryName: row.category_name,
    price: Number(row.category_base_price),
    images: imagesByRoom.get(row.id) || [],
    available: hasDateRange ? !!row.is_available : null,
  }));
}

module.exports = { getLodgeBySlug, listPublicRooms };
