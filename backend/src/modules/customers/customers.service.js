const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const { normaliseMobile } = require('../bookings/bookings.schema');
const { logger } = require('../../config/logger');

function mapCustomer(row) {
  return {
    id: row.id,
    phone: row.phone,
    name: row.name,
    email: row.email,
    dateOfBirth: row.date_of_birth,
    idProofType: row.id_proof_type,
    idProofNumber: row.id_proof_number,
    idProofDocument: row.id_proof_document,
    notes: row.notes,
    loyaltyPoints: row.loyalty_points,
    marketingOptIn: Boolean(row.marketing_opt_in),
    tags: row.tags,
    totalStays: row.total_stays,
    totalRoomSpend: Number(row.total_room_spend),
    lastStayDate: row.last_stay_date,
    totalEvents: row.total_events,
    totalEventSpend: Number(row.total_event_spend),
    lastEventDate: row.last_event_date,
    totalSpend: Number(row.total_room_spend) + Number(row.total_event_spend),
    lastVisit: [row.last_stay_date, row.last_event_date].filter(Boolean).sort().at(-1) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Shared by the room-stay and event-confirmed hooks. `kind` picks which pair
// of rollup columns (stays/room_spend/last_stay vs events/event_spend/
// last_event) gets bumped — the other pair is left untouched, same idea as
// invoices/advance_receipts keeping booking_id and event_booking_id apart.
//
// `requestFactory` is a `() => new sql.Request(...)` thunk rather than a
// single request object, the same shape bookings.service.js's hasOverlap()
// takes, because mssql needs a fresh Request per query and this runs two.
//
// amount/visitDate are the "did a real visit just happen" signal: when both
// are null (checkIn refreshing an ID proof that was missing at booking time,
// nothing else), the matching counter is left untouched — only contact and ID
// proof fields are refreshed.
async function upsertCustomerRow(
  requestFactory,
  lodgeId,
  { phone, name, idProofType = null, idProofNumber = null, idProofDocument = null, amount = null, visitDate = null, kind }
) {
  const normalisedPhone = normaliseMobile(phone);
  if (!normalisedPhone) return null;

  const existing = await requestFactory()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('phone', sql.NVarChar, normalisedPhone)
    .query('SELECT id FROM dbo.customers WHERE lodge_id = @lodgeId AND phone = @phone');

  const isRoom = kind === 'room';
  const stayInc = isRoom && amount != null ? 1 : 0;
  const eventInc = !isRoom && amount != null ? 1 : 0;
  const roomAmount = isRoom ? amount ?? 0 : 0;
  const eventAmount = !isRoom ? amount ?? 0 : 0;

  if (existing.recordset.length > 0) {
    const id = existing.recordset[0].id;
    await requestFactory()
      .input('id', sql.BigInt, id)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('name', sql.NVarChar, name ?? null)
      .input('idProofType', sql.NVarChar, idProofType)
      .input('idProofNumber', sql.NVarChar, idProofNumber)
      .input('idProofDocument', sql.NVarChar, idProofDocument)
      .input('stayInc', sql.Int, stayInc)
      .input('eventInc', sql.Int, eventInc)
      .input('roomAmount', sql.Decimal(12, 2), roomAmount)
      .input('eventAmount', sql.Decimal(12, 2), eventAmount)
      .input('visitDate', sql.Date, visitDate)
      .input('isRoom', sql.Bit, isRoom ? 1 : 0)
      .query(`
        UPDATE dbo.customers
        SET name = COALESCE(@name, name),
            id_proof_type = COALESCE(@idProofType, id_proof_type),
            id_proof_number = COALESCE(@idProofNumber, id_proof_number),
            id_proof_document = COALESCE(@idProofDocument, id_proof_document),
            total_stays = total_stays + @stayInc,
            total_room_spend = total_room_spend + @roomAmount,
            last_stay_date = CASE
              WHEN @isRoom = 1 AND @visitDate IS NOT NULL AND (last_stay_date IS NULL OR @visitDate > last_stay_date)
              THEN @visitDate ELSE last_stay_date END,
            total_events = total_events + @eventInc,
            total_event_spend = total_event_spend + @eventAmount,
            last_event_date = CASE
              WHEN @isRoom = 0 AND @visitDate IS NOT NULL AND (last_event_date IS NULL OR @visitDate > last_event_date)
              THEN @visitDate ELSE last_event_date END,
            updated_at = SYSDATETIMEOFFSET()
        WHERE id = @id AND lodge_id = @lodgeId
      `);
    return id;
  }

  const inserted = await requestFactory()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('phone', sql.NVarChar, normalisedPhone)
    .input('name', sql.NVarChar, name || normalisedPhone)
    .input('idProofType', sql.NVarChar, idProofType)
    .input('idProofNumber', sql.NVarChar, idProofNumber)
    .input('idProofDocument', sql.NVarChar, idProofDocument)
    .input('totalStays', sql.Int, stayInc)
    .input('totalRoomSpend', sql.Decimal(12, 2), roomAmount)
    .input('lastStayDate', sql.Date, isRoom ? visitDate : null)
    .input('totalEvents', sql.Int, eventInc)
    .input('totalEventSpend', sql.Decimal(12, 2), eventAmount)
    .input('lastEventDate', sql.Date, isRoom ? null : visitDate)
    .query(`
      INSERT INTO dbo.customers
        (lodge_id, phone, name, id_proof_type, id_proof_number, id_proof_document,
         total_stays, total_room_spend, last_stay_date, total_events, total_event_spend, last_event_date)
      OUTPUT inserted.id
      VALUES
        (@lodgeId, @phone, @name, @idProofType, @idProofNumber, @idProofDocument,
         @totalStays, @totalRoomSpend, @lastStayDate, @totalEvents, @totalEventSpend, @lastEventDate)
    `);
  return inserted.recordset[0].id;
}

// Called from bookings.service.js createBooking() (a real stay, amount +
// stayDate given) and checkIn() (ID proof arriving late on a pre-reservation,
// amount/stayDate left null so the stay count isn't double-counted).
function upsertCustomerForRoomStay(requestFactory, lodgeId, { phone, name, idProofType, idProofNumber, idProofDocument, amount = null, stayDate = null }) {
  return upsertCustomerRow(requestFactory, lodgeId, {
    phone,
    name,
    idProofType,
    idProofNumber,
    idProofDocument,
    amount,
    visitDate: stayDate,
    kind: 'room',
  });
}

// Called from events.service.js confirmEventBooking(). No ID proof — an
// event booking never collects one (see migration 046's comment: "a function
// is not a stay").
function upsertCustomerForEvent(requestFactory, lodgeId, { phone, name, amount = null, eventDate = null }) {
  return upsertCustomerRow(requestFactory, lodgeId, {
    phone,
    name,
    amount,
    visitDate: eventDate,
    kind: 'event',
  });
}

// Best-effort wrapper for the event-confirm call site: that hook runs after
// the booking's own transaction has already committed (see confirmEventBooking
// in events.service.js), so a failure here must never be allowed to surface
// as a failed confirmation — it's logged and swallowed instead.
async function upsertCustomerForEventSafely(lodgeId, eventBookingId, { phone, name, amount, eventDate }) {
  try {
    const pool = await getPool();
    const customerId = await upsertCustomerForEvent(() => pool.request(), lodgeId, { phone, name, amount, eventDate });
    if (customerId) {
      await pool
        .request()
        .input('id', sql.BigInt, eventBookingId)
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('customerId', sql.BigInt, customerId)
        .query('UPDATE dbo.event_bookings SET customer_id = @customerId WHERE id = @id AND lodge_id = @lodgeId');
    }
  } catch (err) {
    logger.warn({ eventBookingId, lodgeId, err }, 'Could not update customer record for confirmed event');
  }
}

// Reverses what the room or event upsert hook added when that same booking
// is later cancelled — without this, a cancelled booking or function that
// never actually happened would permanently inflate the spend and count
// figures the loyalty-points feature this table exists for will eventually
// be built on.
//
// last_stay_date/last_event_date are deliberately left alone: working out the
// true most-recent date after removing one visit means re-aggregating every
// remaining booking, and a count or a spend total that's wrong is a much
// bigger problem than a last-visit date that's briefly stale.
//
// Best-effort, same reasoning as the event-confirm hook: the cancellation has
// already committed by the time this runs, so a failure here must not
// surface as a failed cancellation.
async function reverseCustomerForCancellation(lodgeId, { phone, amount, kind }) {
  const normalisedPhone = normaliseMobile(phone);
  if (!normalisedPhone) return;
  const countColumn = kind === 'room' ? 'total_stays' : 'total_events';
  const spendColumn = kind === 'room' ? 'total_room_spend' : 'total_event_spend';
  try {
    const pool = await getPool();
    await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('phone', sql.NVarChar, normalisedPhone)
      .input('amount', sql.Decimal(12, 2), amount ?? 0)
      .query(`
        UPDATE dbo.customers
        SET ${countColumn} = CASE WHEN ${countColumn} > 0 THEN ${countColumn} - 1 ELSE 0 END,
            ${spendColumn} = CASE WHEN ${spendColumn} >= @amount THEN ${spendColumn} - @amount ELSE 0 END,
            updated_at = SYSDATETIMEOFFSET()
        WHERE lodge_id = @lodgeId AND phone = @phone
      `);
  } catch (err) {
    logger.warn({ lodgeId, kind, err }, 'Could not reverse customer totals for a cancellation');
  }
}

function reverseCustomerForCancelledStay(lodgeId, { phone, amount }) {
  return reverseCustomerForCancellation(lodgeId, { phone, amount, kind: 'room' });
}

function reverseCustomerForCancelledEvent(lodgeId, { phone, amount }) {
  return reverseCustomerForCancellation(lodgeId, { phone, amount, kind: 'event' });
}

async function listCustomers(lodgeId, { search = '', tag = '', optInOnly = false } = {}) {
  const pool = await getPool();
  const term = String(search ?? '').trim();
  const request = pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('search', sql.NVarChar, `%${term.replace(/[%_[]/g, (c) => `[${c}]`)}%`)
    .input('tag', sql.NVarChar, `%${String(tag ?? '').trim()}%`);

  const extraConditions = [];
  if (term) extraConditions.push('(name LIKE @search ESCAPE \'\\\' OR phone LIKE @search ESCAPE \'\\\' OR email LIKE @search ESCAPE \'\\\')');
  if (tag) extraConditions.push('tags LIKE @tag');
  if (optInOnly) extraConditions.push('marketing_opt_in = 1');
  const extraWhere = extraConditions.length ? ` AND ${extraConditions.join(' AND ')}` : '';

  const result = await request.query(`
    SELECT * FROM dbo.customers
    WHERE lodge_id = @lodgeId${extraWhere}
    ORDER BY COALESCE(last_stay_date, last_event_date) DESC, name ASC
  `);

  const statsResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT COUNT(*) AS total, SUM(CASE WHEN marketing_opt_in = 1 THEN 1 ELSE 0 END) AS optedIn
      FROM dbo.customers WHERE lodge_id = @lodgeId
    `);

  return {
    customers: result.recordset.map(mapCustomer),
    stats: {
      total: statsResult.recordset[0].total,
      optedIn: statsResult.recordset[0].optedIn ?? 0,
    },
  };
}

async function getCustomer(lodgeId, id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('id', sql.BigInt, id)
    .query('SELECT * FROM dbo.customers WHERE id = @id AND lodge_id = @lodgeId');
  const row = result.recordset[0];
  if (!row) throw new ApiError('Customer not found.', 404);

  const stays = await pool
    .request()
    .input('customerId', sql.BigInt, id)
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT b.id, b.check_in_date, b.check_out_date, b.status, b.total_price, r.room_number
      FROM dbo.bookings b
      LEFT JOIN dbo.rooms r ON r.id = b.room_id
      WHERE b.customer_id = @customerId AND b.lodge_id = @lodgeId
      ORDER BY b.check_in_date DESC
    `);

  const events = await pool
    .request()
    .input('customerId', sql.BigInt, id)
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT eb.id, eb.title, eb.event_type, eb.start_at, eb.end_at, eb.status, eb.total_amount, v.name AS venueName
      FROM dbo.event_bookings eb
      LEFT JOIN dbo.event_venues v ON v.id = eb.venue_id
      WHERE eb.customer_id = @customerId AND eb.lodge_id = @lodgeId
      ORDER BY eb.start_at DESC
    `);

  const history = [
    ...stays.recordset.map((s) => ({
      type: 'stay',
      id: s.id,
      date: s.check_in_date,
      endDate: s.check_out_date,
      label: s.room_number ? `Room ${s.room_number}` : 'Room stay',
      status: s.status,
      amount: Number(s.total_price),
    })),
    ...events.recordset.map((e) => ({
      type: 'event',
      id: e.id,
      date: e.start_at,
      endDate: e.end_at,
      label: e.venueName ? `${e.title} — ${e.venueName}` : e.title,
      status: e.status,
      amount: Number(e.total_amount),
    })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  return { ...mapCustomer(row), history };
}

async function createCustomer(lodgeId, input) {
  const pool = await getPool();
  const phone = normaliseMobile(input.phone);

  const clash = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('phone', sql.NVarChar, phone)
    .query('SELECT id FROM dbo.customers WHERE lodge_id = @lodgeId AND phone = @phone');
  if (clash.recordset.length > 0) {
    throw new ApiError('A customer with that phone number already exists.', 409, 'phone');
  }

  const inserted = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('phone', sql.NVarChar, phone)
    .input('name', sql.NVarChar, input.name)
    .input('email', sql.NVarChar, input.email ?? null)
    .input('dateOfBirth', sql.Date, input.dateOfBirth || null)
    .input('notes', sql.NVarChar, input.notes ?? null)
    .input('tags', sql.NVarChar, input.tags ?? null)
    .input('marketingOptIn', sql.Bit, input.marketingOptIn ? 1 : 0)
    .query(`
      INSERT INTO dbo.customers (lodge_id, phone, name, email, date_of_birth, notes, tags, marketing_opt_in)
      OUTPUT inserted.id
      VALUES (@lodgeId, @phone, @name, @email, @dateOfBirth, @notes, @tags, @marketingOptIn)
    `);

  return getCustomer(lodgeId, inserted.recordset[0].id);
}

// loyalty_points is deliberately not accepted here — no earning/redeeming UI
// exists yet, so there's nothing for a raw editable number to mean. Phase 2
// adds its own endpoint(s) for point adjustments with an audit trail instead.
async function updateCustomer(lodgeId, id, input) {
  const pool = await getPool();
  const existing = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('id', sql.BigInt, id)
    .query('SELECT id FROM dbo.customers WHERE id = @id AND lodge_id = @lodgeId');
  if (existing.recordset.length === 0) {
    throw new ApiError('Customer not found.', 404);
  }

  await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('name', sql.NVarChar, input.name ?? null)
    .input('email', sql.NVarChar, input.email ?? null)
    .input('dateOfBirth', sql.Date, input.dateOfBirth || null)
    .input('notes', sql.NVarChar, input.notes ?? null)
    .input('tags', sql.NVarChar, input.tags ?? null)
    .input('marketingOptIn', sql.Bit, input.marketingOptIn == null ? null : input.marketingOptIn ? 1 : 0)
    .input('idProofType', sql.NVarChar, input.idProofType ?? null)
    .input('idProofNumber', sql.NVarChar, input.idProofNumber ?? null)
    .input('idProofDocument', sql.NVarChar, input.idProofDocument ?? null)
    .query(`
      UPDATE dbo.customers
      SET name = COALESCE(@name, name),
          email = @email,
          date_of_birth = @dateOfBirth,
          notes = @notes,
          tags = @tags,
          marketing_opt_in = COALESCE(@marketingOptIn, marketing_opt_in),
          id_proof_type = COALESCE(@idProofType, id_proof_type),
          id_proof_number = COALESCE(@idProofNumber, id_proof_number),
          id_proof_document = COALESCE(@idProofDocument, id_proof_document),
          updated_at = SYSDATETIMEOFFSET()
      WHERE id = @id AND lodge_id = @lodgeId
    `);

  return getCustomer(lodgeId, id);
}

// Every submitted "how was your stay" response, all-time — not date-ranged
// like reports.service.js's getFeedbackReport, which this otherwise mirrors.
// Lives here rather than being reused from Reports because the Customers tab
// is gated on customers.manage, not reports.view, and a desk role with one
// but not the other should still see this.
async function listFeedback(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT fr.id, fr.rating, fr.comment, fr.submitted_at, b.guest_name, b.check_out_date
      FROM dbo.feedback_requests fr
      JOIN dbo.bookings b ON b.id = fr.booking_id
      WHERE fr.lodge_id = @lodgeId AND fr.submitted_at IS NOT NULL
      ORDER BY fr.submitted_at DESC
    `);

  const responses = result.recordset.map((row) => ({
    id: row.id,
    guestName: row.guest_name,
    checkOutDate: row.check_out_date,
    rating: row.rating,
    comment: row.comment || '',
    submittedAt: row.submitted_at,
  }));

  const averageRating =
    responses.length > 0
      ? Math.round((responses.reduce((sum, r) => sum + r.rating, 0) / responses.length) * 100) / 100
      : null;

  return { totals: { count: responses.length, averageRating }, responses };
}

module.exports = {
  upsertCustomerForRoomStay,
  upsertCustomerForEventSafely,
  reverseCustomerForCancelledStay,
  reverseCustomerForCancelledEvent,
  listCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  listFeedback,
};
