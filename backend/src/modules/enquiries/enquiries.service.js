const crypto = require('crypto');

const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const { logger } = require('../../config/logger');

const RETENTION_DAYS = 30;

// No 0/O/1/I — the code is read aloud and quoted back over the phone.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeReferenceCode() {
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `ENQ-${out}`;
}

function mapEnquiry(row) {
  return {
    id: row.id,
    referenceCode: row.reference_code,
    kind: row.kind,
    name: row.name,
    phone: row.phone,
    checkInDate: row.check_in_date,
    checkOutDate: row.check_out_date,
    eventDate: row.event_date,
    eventType: row.event_type,
    roomTypeId: row.room_type_id,
    venueId: row.venue_id,
    guests: row.guests,
    addonIds: row.addon_ids ? JSON.parse(row.addon_ids) : [],
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
    handledAt: row.handled_at,
  };
}

// Public: the guest's submit. Never trusts the client for the lodge — the slug
// is resolved by the caller (public.service.getLodgeBySlug) to a lodge id.
async function createPublicEnquiry(lodgeId, data) {
  // Honeypot filled: pretend success so a bot gets no signal, store nothing.
  if (data.website) return { referenceCode: makeReferenceCode() };

  const pool = await getPool();
  // A collision on a 32^6 code is vanishingly rare; retry covers it anyway.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const referenceCode = makeReferenceCode();
    try {
      await pool
        .request()
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('code', sql.NVarChar, referenceCode)
        .input('kind', sql.NVarChar, data.kind)
        .input('name', sql.NVarChar, data.name)
        .input('phone', sql.NVarChar, data.phone)
        .input('checkIn', sql.Date, data.checkInDate)
        .input('checkOut', sql.Date, data.checkOutDate)
        .input('eventDate', sql.Date, data.eventDate)
        .input('eventType', sql.NVarChar, data.eventType)
        .input('roomTypeId', sql.BigInt, data.roomTypeId)
        .input('venueId', sql.BigInt, data.venueId)
        .input('guests', sql.Int, data.guests)
        .input('addonIds', sql.NVarChar, data.addonIds.length ? JSON.stringify(data.addonIds) : null)
        .input('notes', sql.NVarChar, data.notes)
        .query(`
          INSERT INTO dbo.lodge_enquiries
            (lodge_id, reference_code, kind, name, phone, check_in_date, check_out_date,
             event_date, event_type, room_type_id, venue_id, guests, addon_ids, notes)
          VALUES
            (@lodgeId, @code, @kind, @name, @phone, @checkIn, @checkOut,
             @eventDate, @eventType, @roomTypeId, @venueId, @guests, @addonIds, @notes)
        `);
      return { referenceCode };
    } catch (err) {
      // 2601/2627: unique violation on reference_code — try a fresh code.
      if ((err.number === 2601 || err.number === 2627) && attempt < 2) continue;
      throw err;
    }
  }
  throw new ApiError('Could not save your enquiry. Please try again.', 500);
}

async function listEnquiries(lodgeId, { status } = {}) {
  const pool = await getPool();
  const request = pool.request().input('lodgeId', sql.BigInt, lodgeId);
  let filter = '';
  if (status && ['NEW', 'CONTACTED', 'CONVERTED', 'CLOSED'].includes(status)) {
    request.input('status', sql.NVarChar, status);
    filter = 'AND status = @status';
  }
  const result = await request.query(`
    SELECT * FROM dbo.lodge_enquiries
    WHERE lodge_id = @lodgeId ${filter}
    ORDER BY created_at DESC
  `);
  return { enquiries: result.recordset.map(mapEnquiry) };
}

// What the alert hook polls: the NEW ones only, newest first, capped — the bell
// needs a count and a few names, not the whole inbox.
async function summarize(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT TOP 20 id, reference_code, kind, name, created_at
      FROM dbo.lodge_enquiries
      WHERE lodge_id = @lodgeId AND status = 'NEW'
      ORDER BY created_at DESC
    `);
  return {
    newCount: result.recordset.length,
    items: result.recordset.map((r) => ({
      id: r.id,
      referenceCode: r.reference_code,
      kind: r.kind,
      name: r.name,
      createdAt: r.created_at,
    })),
  };
}

async function updateStatus(lodgeId, userId, id, status) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('id', sql.BigInt, id)
    .input('status', sql.NVarChar, status)
    .input('userId', sql.BigInt, userId ?? null)
    .query(`
      UPDATE dbo.lodge_enquiries
      SET status = @status,
          handled_by = CASE WHEN @status = 'NEW' THEN NULL ELSE @userId END,
          handled_at = CASE WHEN @status = 'NEW' THEN NULL ELSE SYSDATETIMEOFFSET() END
      OUTPUT inserted.*
      WHERE id = @id AND lodge_id = @lodgeId
    `);
  const row = result.recordset[0];
  if (!row) throw new ApiError('Enquiry not found.', 404);
  return { enquiry: mapEnquiry(row) };
}

// Called from inside createBooking's or createEventBooking's own transaction
// (bookings.service.js / events.service.js) when the desk started that
// booking from an enquiry's "Confirm booking" button — see Enquiries.jsx,
// OwnerDashboard.jsx's pendingBookingEnquiry/pendingEventEnquiry handoff, and
// Bookings.jsx's/Events.jsx's prefilled-form entry points. Marks the enquiry
// CONVERTED and records which booking it became, in the same transaction as
// the booking itself, so the two can never disagree: either both commit or
// neither does. Exactly one of bookingId/eventBookingId is passed, never both
// — an enquiry converts into a stay or a function, not both.
//
// `converted_booking_id IS NULL AND converted_event_booking_id IS NULL` in
// the WHERE is the only guard — not a status check — so this never blocks on
// an enquiry already marked CLOSED or CONTACTED by hand; the only thing that
// must not happen twice is a second booking claiming the same enquiry.
// Matching zero rows (already converted, or the enquiry was deleted by the
// 30-day purge since the form was opened) is not an error: the booking the
// desk is making right now is still good, it just won't have an enquiry
// linked back to it.
async function linkConvertedBooking(transaction, lodgeId, enquiryId, { bookingId = null, eventBookingId = null } = {}, userId) {
  const result = await new sql.Request(transaction)
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('enquiryId', sql.BigInt, enquiryId)
    .input('bookingId', sql.BigInt, bookingId)
    .input('eventBookingId', sql.BigInt, eventBookingId)
    .input('userId', sql.BigInt, userId ?? null)
    .query(`
      UPDATE dbo.lodge_enquiries
      SET status = 'CONVERTED',
          converted_booking_id = @bookingId,
          converted_event_booking_id = @eventBookingId,
          handled_by = COALESCE(handled_by, @userId),
          handled_at = COALESCE(handled_at, SYSDATETIMEOFFSET())
      OUTPUT inserted.id
      WHERE id = @enquiryId AND lodge_id = @lodgeId
        AND converted_booking_id IS NULL AND converted_event_booking_id IS NULL
    `);
  if (result.recordset.length === 0) {
    logger.warn(
      { lodgeId, enquiryId, bookingId, eventBookingId },
      'Could not link this booking to its enquiry — already converted, or the enquiry no longer exists'
    );
  }
}

// The id->name lookups the dashboard's enquiry detail modal needs to turn
// roomTypeId/venueId/addonIds (all it stores — an enquiry names a catalogue
// entry, never duplicates its name onto the row) back into words. Scoped to
// this module rather than reusing /rooms or /events/venues: both of those
// sit behind a write-capable permission (rooms.manage/orders.take,
// events.manage) that a desk holding only enquiries.manage may not have —
// granting that for a read-only label would mean granting the ability to
// edit room categories or venues just to view an enquiry. All four
// catalogues are read here, inactive entries included: an enquiry can sit
// around for weeks (30-day retention) naming something since deactivated in
// Setup, and that's still the honest answer to "what did this enquiry ask
// for", not a reason to show nothing.
async function loadCatalogue(lodgeId) {
  const pool = await getPool();
  const [roomTypes, venues, addons, roomExtras] = await Promise.all([
    pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .query('SELECT id, name FROM dbo.room_categories WHERE lodge_id = @lodgeId ORDER BY name'),
    pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .query('SELECT id, name FROM dbo.event_venues WHERE lodge_id = @lodgeId ORDER BY name'),
    pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .query('SELECT id, name FROM dbo.event_addons WHERE lodge_id = @lodgeId ORDER BY name'),
    // An enquiry's addonIds means two different things depending on kind: a
    // ROOM enquiry's extras are ticked off the public page's room-addon
    // picker (dbo.switchable_charges, via public.service.js's
    // listPublicRoomAddons) — a separate catalog from `addons` above
    // (dbo.event_addons, what an EVENT enquiry's extras are). Same field
    // name on the enquiry row, two unrelated id spaces; the caller picks
    // the right map by e.kind.
    pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .query('SELECT id, name FROM dbo.switchable_charges WHERE lodge_id = @lodgeId ORDER BY name'),
  ]);
  return {
    roomTypes: roomTypes.recordset,
    venues: venues.recordset,
    addons: addons.recordset,
    roomExtras: roomExtras.recordset,
  };
}

async function purgeOldEnquiries() {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('days', sql.Int, RETENTION_DAYS)
    .query('DELETE FROM dbo.lodge_enquiries WHERE created_at < DATEADD(DAY, -@days, SYSDATETIMEOFFSET())');
  if (result.rowsAffected[0]) logger.info({ removed: result.rowsAffected[0] }, 'Purged old enquiries');
}

module.exports = {
  createPublicEnquiry,
  listEnquiries,
  summarize,
  updateStatus,
  linkConvertedBooking,
  loadCatalogue,
  purgeOldEnquiries,
};
