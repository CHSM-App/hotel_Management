const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const { priceEvent, billablePax, round2 } = require('./eventPricing');
const notifications = require('../notifications/bookingConfirmation');

// The statuses that keep a venue busy. An enquiry does not — two families can
// ask about the same Saturday and the first to put money down gets it — and
// neither does anything that has been settled, cancelled or lapsed.
const BLOCKING = ['TENTATIVE', 'CONFIRMED'];
// How long a tentative hold stands before the date is released. Two days is
// what the banquet trade actually gives: long enough to arrange the advance,
// short enough that a serious party is not turned away for a maybe.
const DEFAULT_HOLD_HOURS = 48;

function toIso(value) {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseJson(text, fallback) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

// A DATE column back as the 'YYYY-MM-DD' the form sent.
function toDateOnly(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

// What the property can sell alongside a hall. A lodge with no kitchen cannot
// cater — there is no food rate to bill plates under — and a restaurant has
// no rooms to want. Read on every write so the form being hidden is not the
// only thing keeping a rooms-only lodge from quoting plates.
async function getCapabilities(lodgeId, pool = null) {
  const db = pool ?? (await getPool());
  const result = await db
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query('SELECT has_rooms, serves_food FROM dbo.lodges WHERE id = @lodgeId');
  const row = result.recordset[0];
  if (!row) throw new ApiError('Lodge not found.', 404);
  return { hasRooms: !!row.has_rooms, servesFood: !!row.serves_food };
}

// ---------------------------------------------------------------------------
// Venues and the add-on catalogue
// ---------------------------------------------------------------------------

function mapVenue(row, images = []) {
  return {
    id: row.id,
    name: row.name,
    capacityPax: row.capacity_pax == null ? null : Number(row.capacity_pax),
    baseCharge: Number(row.base_charge),
    isActive: !!row.is_active,
    createdAt: toIso(row.created_at),
    images,
  };
}

// Every photo of every venue at the property, grouped by venue and in gallery
// order — one query for the whole list rather than one per venue.
async function loadVenueImages(pool, lodgeId, venueId = null) {
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('venueId', sql.BigInt, venueId)
    .query(`
      SELECT vi.id, vi.venue_id, vi.filename
      FROM dbo.event_venue_images vi
      JOIN dbo.event_venues v ON v.id = vi.venue_id
      WHERE v.lodge_id = @lodgeId ${venueId == null ? '' : 'AND vi.venue_id = @venueId'}
      ORDER BY vi.sort_order ASC, vi.id ASC
    `);
  const byVenue = new Map();
  for (const row of result.recordset) {
    const list = byVenue.get(row.venue_id) || [];
    list.push({ id: row.id, filename: row.filename });
    byVenue.set(row.venue_id, list);
  }
  return byVenue;
}

async function listVenues(lodgeId, { includeInactive = false } = {}) {
  const pool = await getPool();
  const [result, images] = await Promise.all([
    pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .query(`
        SELECT id, name, capacity_pax, base_charge, is_active, created_at
        FROM dbo.event_venues
        WHERE lodge_id = @lodgeId ${includeInactive ? '' : 'AND is_active = 1'}
        ORDER BY name
      `),
    loadVenueImages(pool, lodgeId),
  ]);
  return result.recordset.map((row) => mapVenue(row, images.get(row.id) || []));
}

async function getVenue(lodgeId, venueId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('venueId', sql.BigInt, venueId)
    .query('SELECT id, name, capacity_pax, base_charge, is_active, created_at FROM dbo.event_venues WHERE id = @venueId AND lodge_id = @lodgeId');
  const row = result.recordset[0];
  if (!row) throw new ApiError('Venue not found.', 404);
  const images = await loadVenueImages(pool, lodgeId, venueId);
  return mapVenue(row, images.get(row.id) || []);
}

// A duplicate name is the one error worth translating: the unique index
// throws a driver error whose text names the constraint, and the desk cannot
// do anything with that.
function isUniqueViolation(err) {
  return err?.number === 2627 || err?.number === 2601;
}

async function createVenue(lodgeId, input) {
  const pool = await getPool();
  try {
    const result = await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('name', sql.NVarChar(100), input.name)
      .input('capacity', sql.Int, input.capacityPax ?? null)
      .input('baseCharge', sql.Decimal(10, 2), input.baseCharge ?? 0)
      .query(`
        INSERT INTO dbo.event_venues (lodge_id, name, capacity_pax, base_charge)
        OUTPUT inserted.id
        VALUES (@lodgeId, @name, @capacity, @baseCharge)
      `);
    return getVenue(lodgeId, result.recordset[0].id);
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError('A venue with that name already exists.', 409);
    throw err;
  }
}

async function updateVenue(lodgeId, venueId, input) {
  const pool = await getPool();
  await getVenue(lodgeId, venueId);
  try {
    await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('venueId', sql.BigInt, venueId)
      .input('name', sql.NVarChar(100), input.name ?? null)
      .input('capacity', sql.Int, input.capacityPax ?? null)
      .input('capacityGiven', sql.Bit, input.capacityPax !== undefined ? 1 : 0)
      .input('baseCharge', sql.Decimal(10, 2), input.baseCharge ?? null)
      .input('isActive', sql.Bit, input.isActive == null ? null : input.isActive ? 1 : 0)
      .query(`
        UPDATE dbo.event_venues
        SET name = COALESCE(@name, name),
            capacity_pax = CASE WHEN @capacityGiven = 1 THEN @capacity ELSE capacity_pax END,
            base_charge = COALESCE(@baseCharge, base_charge),
            is_active = COALESCE(@isActive, is_active)
        WHERE id = @venueId AND lodge_id = @lodgeId
      `);
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError('A venue with that name already exists.', 409);
    throw err;
  }
  return getVenue(lodgeId, venueId);
}

// Appends to whatever photos the venue already has — uploading more later
// adds to the gallery; only deleteVenueImage takes one away. The cap is
// enforced here as well as by the upload middleware, because the middleware
// counts files in one request and the gallery counts across all of them.
async function addVenueImages(lodgeId, venueId, filenames, maxImages) {
  if (filenames.length === 0) return;
  const pool = await getPool();
  await getVenue(lodgeId, venueId);

  const countResult = await pool
    .request()
    .input('venueId', sql.BigInt, venueId)
    .query('SELECT COUNT(*) AS n, MAX(sort_order) AS maxSortOrder FROM dbo.event_venue_images WHERE venue_id = @venueId');
  const { n, maxSortOrder } = countResult.recordset[0];
  if (Number(n) + filenames.length > maxImages) {
    throw new ApiError(`Up to ${maxImages} photos per venue — this one already has ${n}.`, 400);
  }

  let nextSortOrder = (maxSortOrder ?? -1) + 1;
  for (const filename of filenames) {
    await pool
      .request()
      .input('venueId', sql.BigInt, venueId)
      .input('filename', sql.NVarChar(255), filename)
      .input('sortOrder', sql.Int, nextSortOrder)
      .query('INSERT INTO dbo.event_venue_images (venue_id, filename, sort_order) VALUES (@venueId, @filename, @sortOrder)');
    nextSortOrder += 1;
  }
}

// Returns the deleted photo's filename so the caller can remove it from disk
// — the row is the source of truth, not the upload directory.
async function deleteVenueImage(lodgeId, venueId, imageId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('venueId', sql.BigInt, venueId)
    .input('imageId', sql.BigInt, imageId)
    .query(`
      SELECT vi.filename
      FROM dbo.event_venue_images vi
      JOIN dbo.event_venues v ON v.id = vi.venue_id
      WHERE vi.id = @imageId AND vi.venue_id = @venueId AND v.lodge_id = @lodgeId
    `);
  const row = result.recordset[0];
  if (!row) throw new ApiError('Photo not found.', 404);

  await pool.request().input('imageId', sql.BigInt, imageId).query('DELETE FROM dbo.event_venue_images WHERE id = @imageId');
  return row.filename;
}

function mapAddon(row) {
  return {
    id: row.id,
    name: row.name,
    defaultAmount: Number(row.default_amount),
    isPerUnit: !!row.is_per_unit,
    isActive: !!row.is_active,
  };
}

async function listAddons(lodgeId, { includeInactive = false } = {}) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT id, name, default_amount, is_per_unit, is_active
      FROM dbo.event_addons
      WHERE lodge_id = @lodgeId ${includeInactive ? '' : 'AND is_active = 1'}
      ORDER BY name
    `);
  return result.recordset.map(mapAddon);
}

async function createAddon(lodgeId, input) {
  const pool = await getPool();
  try {
    const result = await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('name', sql.NVarChar(100), input.name)
      .input('amount', sql.Decimal(10, 2), input.defaultAmount ?? 0)
      .input('perUnit', sql.Bit, input.isPerUnit ? 1 : 0)
      .query(`
        INSERT INTO dbo.event_addons (lodge_id, name, default_amount, is_per_unit)
        OUTPUT inserted.id, inserted.name, inserted.default_amount, inserted.is_per_unit, inserted.is_active
        VALUES (@lodgeId, @name, @amount, @perUnit)
      `);
    return mapAddon(result.recordset[0]);
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError('An add-on with that name already exists.', 409);
    throw err;
  }
}

async function updateAddon(lodgeId, addonId, input) {
  const pool = await getPool();
  try {
    const result = await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('addonId', sql.BigInt, addonId)
      .input('name', sql.NVarChar(100), input.name ?? null)
      .input('amount', sql.Decimal(10, 2), input.defaultAmount ?? null)
      .input('perUnit', sql.Bit, input.isPerUnit == null ? null : input.isPerUnit ? 1 : 0)
      .input('isActive', sql.Bit, input.isActive == null ? null : input.isActive ? 1 : 0)
      .query(`
        UPDATE dbo.event_addons
        SET name = COALESCE(@name, name),
            default_amount = COALESCE(@amount, default_amount),
            is_per_unit = COALESCE(@perUnit, is_per_unit),
            is_active = COALESCE(@isActive, is_active)
        OUTPUT inserted.id, inserted.name, inserted.default_amount, inserted.is_per_unit, inserted.is_active
        WHERE id = @addonId AND lodge_id = @lodgeId
      `);
    const row = result.recordset[0];
    if (!row) throw new ApiError('Add-on not found.', 404);
    return mapAddon(row);
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError('An add-on with that name already exists.', 409);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

// Turns what the request sent — catalogue ids, typed one-offs, overrides —
// into fully described lines the pricing can run on and the booking can
// snapshot. Catalogue rows are read for their label and price at this moment,
// which is the moment the price is agreed.
async function resolveAddonLines(request, lodgeId, lines) {
  if (!lines || lines.length === 0) return [];
  const ids = lines.filter((l) => l.addonId != null).map((l) => l.addonId);
  const catalogue = new Map();
  if (ids.length > 0) {
    request.input('lodgeId', sql.BigInt, lodgeId);
    ids.forEach((id, i) => request.input(`a${i}`, sql.BigInt, id));
    const result = await request.query(`
      SELECT id, name, default_amount, is_per_unit FROM dbo.event_addons
      WHERE lodge_id = @lodgeId AND id IN (${ids.map((_, i) => `@a${i}`).join(', ')})
    `);
    for (const row of result.recordset) catalogue.set(Number(row.id), row);
  }
  return lines.map((line) => {
    const item = line.addonId != null ? catalogue.get(Number(line.addonId)) : null;
    if (line.addonId != null && !item) throw new ApiError('One of the add-ons is no longer on the list.', 400);
    const quantity = Number(line.quantity) || 1;
    // A flat-priced catalogue item costs its price once, however many were
    // ticked; a per-unit one multiplies. A typed unit price always wins.
    const unitAmount =
      line.unitAmount != null
        ? Number(line.unitAmount)
        : item
          ? item.is_per_unit
            ? Number(item.default_amount)
            : Number(item.default_amount) / quantity
          : 0;
    // An extra noted on the day keeps its flags through every re-save; an
    // amount arriving on an unpriced one is the price being agreed.
    const isExtra = Boolean(line.isExtra);
    const needsPricing = isExtra && Boolean(line.needsPricing) && line.agreedAmount == null;
    return {
      addonId: item ? Number(item.id) : null,
      label: line.label || item?.name || 'Add-on',
      quantity,
      unitAmount: round2(unitAmount),
      agreedAmount: line.agreedAmount != null ? round2(Number(line.agreedAmount)) : null,
      isExtra,
      needsPricing,
      notedAt: isExtra ? (line.notedAt ?? null) : null,
    };
  });
}

// The quote, priced against the venue's own charge unless the desk agreed a
// different one. Pure once the lines are resolved, so create and update
// snapshot exactly what this returns.
async function quote(lodgeId, input, { pool = null, request = null } = {}) {
  const db = pool ?? (await getPool());
  const [venue, capabilities] = await Promise.all([getVenue(lodgeId, input.venueId), getCapabilities(lodgeId, db)]);
  const addons = await resolveAddonLines(request ?? db.request(), lodgeId, input.addons);
  const pricing = priceEvent({
    venueCharge: input.venueCharge != null ? input.venueCharge : venue.baseCharge,
    // No kitchen, no plates — whatever the request said.
    perPlateRate: capabilities.servesFood ? (input.perPlateRate ?? 0) : 0,
    expectedPax: input.expectedPax ?? 0,
    guaranteedPax: input.guaranteedPax ?? 0,
    finalPax: input.finalPax ?? null,
    addons,
    discountAmount: input.discountAmount ?? 0,
  });
  const overCapacity =
    venue.capacityPax != null && pricing.billablePax > venue.capacityPax
      ? `${venue.name} seats ${venue.capacityPax}; this party is ${pricing.billablePax}. Lower the count or pick a larger venue.`
      : null;
  return { venue, addons, pricing, overCapacity, capabilities };
}

// A party the venue cannot seat is refused, not filed with a note on it.
// /events/quote still returns overCapacity as a message so the form can say so
// while the desk is typing; this is the same rule at the point it is saved, so
// a request that never went near the form cannot get past it either.
//
// Exactly at capacity is fine — a 300-seat hall seats 300. Only above it is
// over. And a venue with no capacity recorded holds whatever it is told to:
// quote() leaves overCapacity null there, and an unknown limit must not become
// a limit of zero.
function assertWithinCapacity(overCapacity) {
  if (overCapacity) throw new ApiError(overCapacity, 409);
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

// Every held or confirmed function at this venue that overlaps the range.
// Half-open on both ends: a morning slot ending at 15:00 and an evening one
// starting at 15:00 do not clash, which is exactly how a hall turns over.
//
// `lock` takes UPDLOCK + HOLDLOCK over the range, the same way the room
// overlap check does: inside a SERIALIZABLE transaction that is what stops a
// second desk slipping a booking into the same evening between this read and
// our insert.
async function findClashes(request, lodgeId, { venueId, startAt, endAt, excludeId = null, lock = false }) {
  request
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('venueId', sql.BigInt, venueId)
    .input('startAt', sql.DateTimeOffset, new Date(startAt))
    .input('endAt', sql.DateTimeOffset, new Date(endAt))
    .input('excludeId', sql.BigInt, excludeId);
  const result = await request.query(`
    SELECT id, title, status, start_at, end_at, organiser_name
    FROM dbo.event_bookings ${lock ? 'WITH (UPDLOCK, HOLDLOCK)' : ''}
    WHERE lodge_id = @lodgeId AND venue_id = @venueId
      AND status IN (${BLOCKING.map((s) => `'${s}'`).join(', ')})
      AND start_at < @endAt AND end_at > @startAt
      AND (@excludeId IS NULL OR id <> @excludeId)
    ORDER BY start_at
  `);
  return result.recordset.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    organiserName: row.organiser_name,
    startAt: toIso(row.start_at),
    endAt: toIso(row.end_at),
  }));
}

async function checkAvailability(lodgeId, { venueId, startAt, endAt, excludeId = null }) {
  const pool = await getPool();
  await getVenue(lodgeId, venueId);
  await lapseExpiredHolds(lodgeId, pool);
  const clashes = await findClashes(pool.request(), lodgeId, { venueId, startAt, endAt, excludeId });
  return { available: clashes.length === 0, clashes };
}

function clashError(clashes) {
  const first = clashes[0];
  return new ApiError(
    `That venue is already ${first.status === 'CONFIRMED' ? 'booked' : 'on hold'} for “${first.title}” at that time.`,
    409
  );
}

// A hold that ran out is released. Done on read rather than by a scheduler —
// there is none in this process, and the diary is opened often enough that a
// lapsed hold is never more than a screen-load stale. Same shape as the way
// late checkouts are noticed.
async function lapseExpiredHolds(lodgeId, pool = null) {
  const db = pool ?? (await getPool());
  await db
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      UPDATE dbo.event_bookings
      SET status = 'EXPIRED', updated_at = SYSDATETIMEOFFSET()
      WHERE lodge_id = @lodgeId AND status = 'TENTATIVE'
        AND hold_expires_at IS NOT NULL AND hold_expires_at < SYSDATETIMEOFFSET()
    `);
}

// ---------------------------------------------------------------------------
// Reading bookings back
// ---------------------------------------------------------------------------

const EVENT_SELECT = `
  SELECT e.*, v.name AS venue_name, v.capacity_pax AS venue_capacity,
         (SELECT a.id, a.addon_id AS addonId, a.label, a.quantity, a.unit_amount AS unitAmount, a.agreed_amount AS agreedAmount,
                 a.is_extra AS isExtra, a.needs_pricing AS needsPricing, a.noted_at AS notedAt
          FROM dbo.event_booking_addons a WHERE a.event_booking_id = e.id ORDER BY a.id
          FOR JSON PATH) AS addons_json,
         (SELECT TOP 1 i.id, i.invoice_number AS invoiceNumber, i.status, i.total_amount AS totalAmount
          FROM dbo.invoices i WHERE i.event_booking_id = e.id
          ORDER BY CASE WHEN i.status = 'ISSUED' THEN 0 ELSE 1 END, i.id DESC
          FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS invoice_json,
         (SELECT COUNT(*) FROM dbo.advance_receipts ar
          WHERE ar.event_booking_id = e.id AND ar.status = 'ISSUED') AS receipt_count
  FROM dbo.event_bookings e
  JOIN dbo.event_venues v ON v.id = e.venue_id
`;

function mapEvent(row) {
  const addons = parseJson(row.addons_json, []).map((a) => ({
    id: a.id,
    addonId: a.addonId ?? null,
    label: a.label,
    quantity: Number(a.quantity),
    unitAmount: Number(a.unitAmount),
    agreedAmount: Number(a.agreedAmount),
    isExtra: Boolean(a.isExtra),
    needsPricing: Boolean(a.needsPricing),
    notedAt: a.notedAt ? toIso(a.notedAt) : null,
  }));
  const advanceAmount = row.advance_amount != null ? Number(row.advance_amount) : 0;
  const totalAmount = Number(row.total_amount);
  return {
    id: row.id,
    venueId: row.venue_id,
    venueName: row.venue_name,
    // The bill will not issue while any of these stand — the reminder the
    // desk wrote down before a price was agreed.
    unpricedExtras: addons.filter((a) => a.needsPricing).length,
    venueCapacity: row.venue_capacity == null ? null : Number(row.venue_capacity),
    eventType: row.event_type,
    title: row.title,
    organiserName: row.organiser_name,
    organiserPhone: row.organiser_phone,
    organiserAltPhone: row.organiser_alt_phone ?? null,
    startAt: toIso(row.start_at),
    endAt: toIso(row.end_at),
    slot: row.slot,
    expectedPax: Number(row.expected_pax),
    guaranteedPax: Number(row.guaranteed_pax),
    finalPax: row.final_pax == null ? null : Number(row.final_pax),
    billablePax: billablePax({
      expectedPax: row.expected_pax,
      guaranteedPax: row.guaranteed_pax,
      finalPax: row.final_pax,
    }),
    venueCharge: Number(row.venue_charge),
    perPlateRate: Number(row.per_plate_rate),
    cateringAmount: Number(row.catering_amount),
    addonsTotal: Number(row.addons_total),
    discountAmount: Number(row.discount_amount),
    discountReason: row.discount_reason ?? null,
    totalAmount,
    // The labelled lines the total was quoted as, frozen at the time.
    pricing: parseJson(row.pricing_breakdown, null),
    advanceAmount,
    advancePaymentMethod: row.advance_payment_method ?? null,
    balanceDue: round2(totalAmount - advanceAmount),
    menuNotes: row.menu_notes ?? null,
    setupNotes: row.setup_notes ?? null,
    scheduleNotes: row.schedule_notes ?? null,
    // Rooms wanted with the function — a need noted, not a stay booked.
    roomsRequired: !!row.rooms_required,
    roomsCount: row.rooms_count == null ? null : Number(row.rooms_count),
    roomsFrom: toDateOnly(row.rooms_from),
    roomsTo: toDateOnly(row.rooms_to),
    roomsNotes: row.rooms_notes ?? null,
    status: row.status,
    holdExpiresAt: toIso(row.hold_expires_at),
    cancelReason: row.cancel_reason ?? null,
    refundAmount: row.refund_amount == null ? null : Number(row.refund_amount),
    // The other half of the same settlement: what the house kept of the
    // advance. NULL until a cancellation settles the money.
    cancellationCharge: row.cancellation_charge == null ? null : Number(row.cancellation_charge),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    addons,
    invoice: parseJson(row.invoice_json, null),
    receiptCount: Number(row.receipt_count ?? 0),
  };
}

async function getEventBooking(lodgeId, id, { request = null } = {}) {
  const req = request ?? (await getPool()).request();
  const result = await req
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('id', sql.BigInt, id)
    .query(`${EVENT_SELECT} WHERE e.id = @id AND e.lodge_id = @lodgeId`);
  const row = result.recordset[0];
  if (!row) throw new ApiError('Event booking not found.', 404);
  return mapEvent(row);
}

// The function diary. A date window is matched on overlap — a wedding that
// runs past midnight shows on both days — and cancelled or lapsed bookings
// are only returned when asked for, since the diary is about what is on.
async function listEventBookings(lodgeId, { fromDate = null, toDate = null, status = null, venueId = null, includeClosed = false } = {}) {
  const pool = await getPool();
  await lapseExpiredHolds(lodgeId, pool);
  const request = pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('venueId', sql.BigInt, venueId)
    .input('status', sql.NVarChar(10), status);
  const clauses = ['e.lodge_id = @lodgeId'];
  if (fromDate) {
    request.input('fromDate', sql.DateTimeOffset, new Date(`${fromDate}T00:00:00+05:30`));
    clauses.push('e.end_at > @fromDate');
  }
  if (toDate) {
    // Exclusive of the day after the window's last day.
    const after = new Date(`${toDate}T00:00:00+05:30`);
    after.setUTCDate(after.getUTCDate() + 1);
    request.input('toDate', sql.DateTimeOffset, after);
    clauses.push('e.start_at < @toDate');
  }
  if (venueId) clauses.push('e.venue_id = @venueId');
  if (status) clauses.push('e.status = @status');
  else if (!includeClosed) clauses.push("e.status NOT IN ('CANCELLED', 'EXPIRED')");
  const result = await request.query(`${EVENT_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY e.start_at ASC`);
  return result.recordset.map(mapEvent);
}

// ---------------------------------------------------------------------------
// Writing bookings
// ---------------------------------------------------------------------------

async function replaceAddonLines(transaction, eventId, lines) {
  await new sql.Request(transaction)
    .input('eventId', sql.BigInt, eventId)
    .query('DELETE FROM dbo.event_booking_addons WHERE event_booking_id = @eventId');
  for (const line of lines) {
    await new sql.Request(transaction)
      .input('eventId', sql.BigInt, eventId)
      .input('addonId', sql.BigInt, line.addonId)
      .input('label', sql.NVarChar(100), line.label)
      .input('quantity', sql.Int, line.quantity)
      .input('unitAmount', sql.Decimal(10, 2), line.unitAmount)
      .input('agreedAmount', sql.Decimal(10, 2), line.agreedAmount ?? round2(line.unitAmount * line.quantity))
      .input('isExtra', sql.Bit, line.isExtra ? 1 : 0)
      .input('needsPricing', sql.Bit, line.needsPricing ? 1 : 0)
      .input('notedAt', sql.DateTimeOffset, line.isExtra ? new Date(line.notedAt ?? Date.now()) : null)
      .query(`
        INSERT INTO dbo.event_booking_addons
          (event_booking_id, addon_id, label, quantity, unit_amount, agreed_amount, is_extra, needs_pricing, noted_at)
        VALUES (@eventId, @addonId, @label, @quantity, @unitAmount, @agreedAmount, @isExtra, @needsPricing, @notedAt)
      `);
  }
}

function holdExpiry(holdHours) {
  const hours = Number(holdHours) || DEFAULT_HOLD_HOURS;
  return new Date(Date.now() + hours * 3600 * 1000);
}

// The rooms need as one set. Off means every column is cleared, so a stale
// count never survives the box being unticked; and a property with no rooms
// records no need however the request was shaped.
function bindRooms(request, input, capabilities) {
  const required = Boolean(input.roomsRequired) && capabilities.hasRooms;
  return request
    .input('roomsRequired', sql.Bit, required ? 1 : 0)
    .input('roomsCount', sql.Int, required ? (input.roomsCount ?? null) : null)
    .input('roomsFrom', sql.Date, required && input.roomsFrom ? new Date(`${input.roomsFrom}T00:00:00Z`) : null)
    .input('roomsTo', sql.Date, required && input.roomsTo ? new Date(`${input.roomsTo}T00:00:00Z`) : null)
    .input('roomsNotes', sql.NVarChar(500), required ? (input.roomsNotes ?? null) : null);
}

function bindPricing(request, pricing, input) {
  return request
    .input('expectedPax', sql.Int, input.expectedPax ?? 0)
    .input('guaranteedPax', sql.Int, input.guaranteedPax ?? 0)
    .input('finalPax', sql.Int, input.finalPax ?? null)
    .input('venueCharge', sql.Decimal(10, 2), pricing.venueCharge)
    .input('perPlateRate', sql.Decimal(10, 2), pricing.perPlateRate)
    .input('cateringAmount', sql.Decimal(10, 2), pricing.cateringAmount)
    .input('addonsTotal', sql.Decimal(10, 2), pricing.addonsTotal)
    .input('discountAmount', sql.Decimal(10, 2), pricing.discountAmount)
    .input('discountReason', sql.NVarChar(100), pricing.discountAmount > 0 ? input.discountReason ?? null : null)
    .input('totalAmount', sql.Decimal(10, 2), pricing.totalAmount)
    .input('breakdown', sql.NVarChar(sql.MAX), JSON.stringify({ lines: pricing.lines, billablePax: pricing.billablePax }));
}

// Mirrors createBooking: an unlocked pre-check that refuses the common case
// cheaply, then the authoritative one under a range lock inside a SERIALIZABLE
// transaction. Two desks holding the same hall for the same evening is the
// one thing this feature must never allow.
async function createEventBooking(lodgeId, userId, input) {
  const pool = await getPool();
  const { addons, pricing, capabilities, overCapacity } = await quote(lodgeId, input, { pool });
  assertWithinCapacity(overCapacity);
  const blocks = BLOCKING.includes(input.status);

  if (blocks) {
    const clashes = await findClashes(pool.request(), lodgeId, { venueId: input.venueId, startAt: input.startAt, endAt: input.endAt });
    if (clashes.length > 0) throw clashError(clashes);
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    if (blocks) {
      const clashes = await findClashes(new sql.Request(transaction), lodgeId, {
        venueId: input.venueId,
        startAt: input.startAt,
        endAt: input.endAt,
        lock: true,
      });
      if (clashes.length > 0) throw clashError(clashes);
    }

    const inserted = await bindRooms(bindPricing(new sql.Request(transaction), pricing, input), input, capabilities)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('venueId', sql.BigInt, input.venueId)
      .input('eventType', sql.NVarChar(20), input.eventType)
      .input('title', sql.NVarChar(200), input.title)
      .input('organiserName', sql.NVarChar(200), input.organiserName)
      .input('organiserPhone', sql.NVarChar(20), input.organiserPhone)
      .input('organiserAltPhone', sql.NVarChar(20), input.organiserAltPhone ?? null)
      .input('startAt', sql.DateTimeOffset, new Date(input.startAt))
      .input('endAt', sql.DateTimeOffset, new Date(input.endAt))
      .input('slot', sql.NVarChar(10), input.slot ?? 'CUSTOM')
      .input('menuNotes', sql.NVarChar(sql.MAX), input.menuNotes ?? null)
      .input('setupNotes', sql.NVarChar(sql.MAX), input.setupNotes ?? null)
      .input('scheduleNotes', sql.NVarChar(sql.MAX), input.scheduleNotes ?? null)
      .input('status', sql.NVarChar(10), input.status ?? 'ENQUIRY')
      .input('holdExpiresAt', sql.DateTimeOffset, input.status === 'TENTATIVE' ? holdExpiry(input.holdHours) : null)
      .input('createdBy', sql.BigInt, userId ?? null)
      .query(`
        INSERT INTO dbo.event_bookings
          (lodge_id, venue_id, event_type, title, organiser_name, organiser_phone, organiser_alt_phone,
           start_at, end_at, slot, expected_pax, guaranteed_pax, final_pax,
           venue_charge, per_plate_rate, catering_amount, addons_total, discount_amount, discount_reason,
           total_amount, pricing_breakdown, menu_notes, setup_notes, schedule_notes,
           rooms_required, rooms_count, rooms_from, rooms_to, rooms_notes,
           status, hold_expires_at, created_by)
        OUTPUT inserted.id
        VALUES
          (@lodgeId, @venueId, @eventType, @title, @organiserName, @organiserPhone, @organiserAltPhone,
           @startAt, @endAt, @slot, @expectedPax, @guaranteedPax, @finalPax,
           @venueCharge, @perPlateRate, @cateringAmount, @addonsTotal, @discountAmount, @discountReason,
           @totalAmount, @breakdown, @menuNotes, @setupNotes, @scheduleNotes,
           @roomsRequired, @roomsCount, @roomsFrom, @roomsTo, @roomsNotes,
           @status, @holdExpiresAt, @createdBy)
      `);
    const id = inserted.recordset[0].id;
    await replaceAddonLines(transaction, id, addons);
    await transaction.commit();
    const event = await getEventBooking(lodgeId, id);
    // The organiser hears from us once the venue is theirs. An enquiry holds
    // nothing, so it is not told "confirmed"; it gets the message when it is
    // held or confirmed (see transition). Not awaited — best-effort, logged.
    if (blocks) void notifications.notifyEventBooked(lodgeId, event);
    return event;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

// A saved add-on line back in the shape the request sends one, so it can be
// re-sent unchanged beside a new line. An unpriced extra is sent without an
// amount — the 0 it is stored at is a placeholder, not a price.
function savedLine(a) {
  return {
    addonId: a.addonId ?? undefined,
    label: a.label,
    quantity: a.quantity,
    unitAmount: a.unitAmount,
    agreedAmount: a.needsPricing ? undefined : a.agreedAmount,
    isExtra: a.isExtra,
    needsPricing: a.needsPricing,
    notedAt: a.notedAt ?? undefined,
  };
}

// An edit re-prices the function from what is now on it. Anything not sent
// stays as it was; addons sent as [] clears them. Moving the time or the
// venue re-runs the clash check under the same lock a create takes.
async function updateEventBooking(lodgeId, id, input) {
  const pool = await getPool();
  const current = await getEventBooking(lodgeId, id);
  if (current.status === 'SETTLED' || current.status === 'CANCELLED') {
    throw new ApiError('A settled or cancelled function can’t be edited.', 409);
  }

  const merged = {
    venueId: input.venueId ?? current.venueId,
    expectedPax: input.expectedPax ?? current.expectedPax,
    guaranteedPax: input.guaranteedPax ?? current.guaranteedPax,
    finalPax: input.finalPax !== undefined ? input.finalPax : current.finalPax,
    venueCharge: input.venueCharge ?? current.venueCharge,
    perPlateRate: input.perPlateRate ?? current.perPlateRate,
    addons: input.addons !== undefined ? input.addons : current.addons.map(savedLine),
    discountAmount: input.discountAmount ?? current.discountAmount,
    discountReason:
      input.discountReason === undefined ? current.discountReason : input.discountReason,
    startAt: input.startAt ?? current.startAt,
    endAt: input.endAt ?? current.endAt,
  };
  if (Date.parse(merged.endAt) <= Date.parse(merged.startAt)) {
    throw new ApiError('The function must end after it starts.', 400);
  }

  const { addons, pricing, capabilities, overCapacity } = await quote(lodgeId, merged, { pool });
  assertWithinCapacity(overCapacity);
  // The rooms need travels as a set: sent, it replaces; absent, it stays.
  const roomsGiven = input.roomsRequired !== undefined;
  const moved =
    merged.venueId !== current.venueId ||
    Date.parse(merged.startAt) !== Date.parse(current.startAt) ||
    Date.parse(merged.endAt) !== Date.parse(current.endAt);
  const blocks = BLOCKING.includes(current.status);

  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    if (moved && blocks) {
      const clashes = await findClashes(new sql.Request(transaction), lodgeId, {
        venueId: merged.venueId,
        startAt: merged.startAt,
        endAt: merged.endAt,
        excludeId: id,
        lock: true,
      });
      if (clashes.length > 0) throw clashError(clashes);
    }

    await bindRooms(bindPricing(new sql.Request(transaction), pricing, merged), input, capabilities)
      .input('roomsGiven', sql.Bit, roomsGiven ? 1 : 0)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('id', sql.BigInt, id)
      .input('venueId', sql.BigInt, merged.venueId)
      .input('eventType', sql.NVarChar(20), input.eventType ?? null)
      .input('title', sql.NVarChar(200), input.title ?? null)
      .input('organiserName', sql.NVarChar(200), input.organiserName ?? null)
      .input('organiserPhone', sql.NVarChar(20), input.organiserPhone ?? null)
      .input('organiserAltPhone', sql.NVarChar(20), input.organiserAltPhone ?? null)
      .input('altGiven', sql.Bit, input.organiserAltPhone !== undefined ? 1 : 0)
      .input('startAt', sql.DateTimeOffset, new Date(merged.startAt))
      .input('endAt', sql.DateTimeOffset, new Date(merged.endAt))
      .input('slot', sql.NVarChar(10), input.slot ?? null)
      .input('menuNotes', sql.NVarChar(sql.MAX), input.menuNotes ?? null)
      .input('menuGiven', sql.Bit, input.menuNotes !== undefined ? 1 : 0)
      .input('setupNotes', sql.NVarChar(sql.MAX), input.setupNotes ?? null)
      .input('setupGiven', sql.Bit, input.setupNotes !== undefined ? 1 : 0)
      .input('scheduleNotes', sql.NVarChar(sql.MAX), input.scheduleNotes ?? null)
      .input('scheduleGiven', sql.Bit, input.scheduleNotes !== undefined ? 1 : 0)
      .query(`
        UPDATE dbo.event_bookings
        SET venue_id = @venueId,
            event_type = COALESCE(@eventType, event_type),
            title = COALESCE(@title, title),
            organiser_name = COALESCE(@organiserName, organiser_name),
            organiser_phone = COALESCE(@organiserPhone, organiser_phone),
            organiser_alt_phone = CASE WHEN @altGiven = 1 THEN @organiserAltPhone ELSE organiser_alt_phone END,
            start_at = @startAt, end_at = @endAt,
            slot = COALESCE(@slot, slot),
            expected_pax = @expectedPax, guaranteed_pax = @guaranteedPax, final_pax = @finalPax,
            venue_charge = @venueCharge, per_plate_rate = @perPlateRate, catering_amount = @cateringAmount,
            addons_total = @addonsTotal, discount_amount = @discountAmount, discount_reason = @discountReason,
            total_amount = @totalAmount, pricing_breakdown = @breakdown,
            menu_notes = CASE WHEN @menuGiven = 1 THEN @menuNotes ELSE menu_notes END,
            setup_notes = CASE WHEN @setupGiven = 1 THEN @setupNotes ELSE setup_notes END,
            schedule_notes = CASE WHEN @scheduleGiven = 1 THEN @scheduleNotes ELSE schedule_notes END,
            rooms_required = CASE WHEN @roomsGiven = 1 THEN @roomsRequired ELSE rooms_required END,
            rooms_count = CASE WHEN @roomsGiven = 1 THEN @roomsCount ELSE rooms_count END,
            rooms_from = CASE WHEN @roomsGiven = 1 THEN @roomsFrom ELSE rooms_from END,
            rooms_to = CASE WHEN @roomsGiven = 1 THEN @roomsTo ELSE rooms_to END,
            rooms_notes = CASE WHEN @roomsGiven = 1 THEN @roomsNotes ELSE rooms_notes END,
            updated_at = SYSDATETIMEOFFSET()
        WHERE id = @id AND lodge_id = @lodgeId
      `);
    await replaceAddonLines(transaction, id, addons);
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
  return getEventBooking(lodgeId, id);
}

// ---------------------------------------------------------------------------
// Extras noted on the day
// ---------------------------------------------------------------------------
// The function is on, the organiser asks for fifty more chairs, and the desk
// writes it down here so it reaches the bill instead of a scrap of paper. A
// price can be agreed on the spot or later; until it is, the line stands as
// a reminder and the bill refuses to issue over it. Each of these is an edit
// of the add-on list, so the total re-prices the same way a form edit does.

function findExtra(current, lineId) {
  const line = current.addons.find((a) => Number(a.id) === Number(lineId) && a.isExtra);
  if (!line) throw new ApiError('That extra is no longer on the function.', 404);
  return line;
}

async function addExtra(lodgeId, id, { label, quantity = 1, agreedAmount }) {
  const current = await getEventBooking(lodgeId, id);
  const priced = agreedAmount != null;
  return updateEventBooking(lodgeId, id, {
    addons: [
      ...current.addons.map(savedLine),
      {
        label,
        quantity,
        unitAmount: priced ? round2(Number(agreedAmount) / quantity) : 0,
        agreedAmount: priced ? Number(agreedAmount) : undefined,
        isExtra: true,
        needsPricing: !priced,
        notedAt: new Date().toISOString(),
      },
    ],
  });
}

async function priceExtra(lodgeId, id, lineId, { agreedAmount }) {
  const current = await getEventBooking(lodgeId, id);
  findExtra(current, lineId);
  return updateEventBooking(lodgeId, id, {
    addons: current.addons.map((a) =>
      Number(a.id) === Number(lineId)
        ? { ...savedLine(a), unitAmount: round2(Number(agreedAmount) / a.quantity), agreedAmount: Number(agreedAmount), needsPricing: false }
        : savedLine(a)
    ),
  });
}

async function removeExtra(lodgeId, id, lineId) {
  const current = await getEventBooking(lodgeId, id);
  findExtra(current, lineId);
  return updateEventBooking(lodgeId, id, {
    addons: current.addons.filter((a) => Number(a.id) !== Number(lineId)).map(savedLine),
  });
}

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------
//   ENQUIRY ──hold──▶ TENTATIVE ──confirm──▶ CONFIRMED ──bill──▶ SETTLED
//      │                 │  ▲ release                 │
//      └──confirm────────┘  └── EXPIRED (lapsed)      │
//   any of the first three, or EXPIRED ──cancel──▶ CANCELLED
// A hold or a confirmation takes the venue, so both re-check for a clash
// under the lock. Settling is billing's move, made when the bill is issued.

async function transition(lodgeId, id, { from, to, set = '', bind = () => {}, takesVenue = false }) {
  const pool = await getPool();
  await lapseExpiredHolds(lodgeId, pool);
  const current = await getEventBooking(lodgeId, id);
  if (!from.includes(current.status)) {
    throw new ApiError(`This function is ${current.status.toLowerCase()} and can’t be moved to ${to.toLowerCase()}.`, 409);
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    if (takesVenue) {
      const clashes = await findClashes(new sql.Request(transaction), lodgeId, {
        venueId: current.venueId,
        startAt: current.startAt,
        endAt: current.endAt,
        excludeId: id,
        lock: true,
      });
      if (clashes.length > 0) throw clashError(clashes);
    }
    const request = new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('id', sql.BigInt, id)
      .input('to', sql.NVarChar(10), to);
    bind(request);
    await request.query(`
      UPDATE dbo.event_bookings
      SET status = @to, updated_at = SYSDATETIMEOFFSET() ${set}
      WHERE id = @id AND lodge_id = @lodgeId
    `);
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
  const updated = await getEventBooking(lodgeId, id);
  // First time this function takes the venue: an enquiry or a lapsed hold
  // becoming tentative or confirmed. A tentative hold that is then confirmed
  // was already told, and is not told twice.
  if (BLOCKING.includes(to) && !BLOCKING.includes(current.status)) {
    void notifications.notifyEventBooked(lodgeId, updated);
  }
  return updated;
}

function holdEventBooking(lodgeId, id, { holdHours } = {}) {
  return transition(lodgeId, id, {
    from: ['ENQUIRY', 'EXPIRED'],
    to: 'TENTATIVE',
    takesVenue: true,
    set: ', hold_expires_at = @holdExpiresAt',
    bind: (r) => r.input('holdExpiresAt', sql.DateTimeOffset, holdExpiry(holdHours)),
  });
}

function confirmEventBooking(lodgeId, id) {
  return transition(lodgeId, id, {
    from: ['ENQUIRY', 'TENTATIVE', 'EXPIRED'],
    to: 'CONFIRMED',
    takesVenue: true,
    set: ', hold_expires_at = NULL',
  });
}

function releaseEventBooking(lodgeId, id) {
  return transition(lodgeId, id, {
    from: ['TENTATIVE'],
    to: 'ENQUIRY',
    set: ', hold_expires_at = NULL',
  });
}

// Money already taken is not touched here: the refund, if any, is recorded
// as a figure and the advance receipts stay as the paper trail of what was
// held. A cancelled function with an advance is exactly the case an owner
// wants to be able to look back at. What the refund leaves behind is kept as
// the cancellation charge — computed in the UPDATE against the advance as it
// stands there, so the split can never drift from the advance it divides. A
// cancel with no refund figure leaves both NULL: "not settled", not "kept
// nothing".
async function cancelEventBooking(lodgeId, id, { reason, refundAmount = null }) {
  if (refundAmount != null) {
    const current = await getEventBooking(lodgeId, id);
    if (round2(Number(refundAmount)) > round2(current.advanceAmount || 0)) {
      throw new ApiError('The refund can’t be more than the advance held on this function.', 400);
    }
  }
  return transition(lodgeId, id, {
    from: ['ENQUIRY', 'TENTATIVE', 'CONFIRMED', 'EXPIRED'],
    to: 'CANCELLED',
    set: `, hold_expires_at = NULL, cancel_reason = @reason, refund_amount = @refund, cancelled_at = SYSDATETIMEOFFSET(),
          cancellation_charge = CASE WHEN @refund IS NULL THEN NULL ELSE ISNULL(advance_amount, 0) - @refund END`,
    bind: (r) =>
      r.input('reason', sql.NVarChar(200), reason).input('refund', sql.Decimal(10, 2), refundAmount ?? null),
  });
}

// Called by billing on its own transaction: the bill and the status land
// together or not at all.
async function markSettled(transaction, lodgeId, id) {
  await new sql.Request(transaction)
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('id', sql.BigInt, id)
    .query(`
      UPDATE dbo.event_bookings SET status = 'SETTLED', updated_at = SYSDATETIMEOFFSET()
      WHERE id = @id AND lodge_id = @lodgeId AND status = 'CONFIRMED'
    `);
}

// A voided bill puts the function back to confirmed so it can be billed again.
async function unsettle(transaction, lodgeId, id) {
  await new sql.Request(transaction)
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('id', sql.BigInt, id)
    .query(`
      UPDATE dbo.event_bookings SET status = 'CONFIRMED', updated_at = SYSDATETIMEOFFSET()
      WHERE id = @id AND lodge_id = @lodgeId AND status = 'SETTLED'
    `);
}

// The advance an event holds, written the way bookings.advance_amount is:
// added to on a receipt, floored at zero on a void. Money in also confirms a
// function that was only held or enquired about — a deposit is what
// confirmation means.
async function addAdvance(transaction, lodgeId, id, amount, method, reference) {
  await new sql.Request(transaction)
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('id', sql.BigInt, id)
    .input('amount', sql.Decimal(10, 2), amount)
    .input('method', sql.NVarChar(20), method ?? null)
    .query(`
      UPDATE dbo.event_bookings
      SET advance_amount = ISNULL(advance_amount, 0) + @amount,
          advance_payment_method = COALESCE(@method, advance_payment_method),
          status = CASE WHEN status IN ('ENQUIRY', 'TENTATIVE', 'EXPIRED') THEN 'CONFIRMED' ELSE status END,
          hold_expires_at = NULL,
          updated_at = SYSDATETIMEOFFSET()
      WHERE id = @id AND lodge_id = @lodgeId
    `);
}

async function subtractAdvance(transaction, lodgeId, id, amount) {
  await new sql.Request(transaction)
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('id', sql.BigInt, id)
    .input('amount', sql.Decimal(10, 2), amount)
    .query(`
      UPDATE dbo.event_bookings
      SET advance_amount = CASE WHEN ISNULL(advance_amount, 0) - @amount > 0
                                THEN ISNULL(advance_amount, 0) - @amount ELSE NULL END,
          updated_at = SYSDATETIMEOFFSET()
      WHERE id = @id AND lodge_id = @lodgeId
    `);
}

module.exports = {
  BLOCKING,
  DEFAULT_HOLD_HOURS,
  listVenues,
  getVenue,
  createVenue,
  updateVenue,
  addVenueImages,
  deleteVenueImage,
  listAddons,
  createAddon,
  updateAddon,
  quote,
  checkAvailability,
  findClashes,
  lapseExpiredHolds,
  listEventBookings,
  getEventBooking,
  createEventBooking,
  updateEventBooking,
  addExtra,
  priceExtra,
  removeExtra,
  holdEventBooking,
  confirmEventBooking,
  releaseEventBooking,
  cancelEventBooking,
  markSettled,
  unsettle,
  addAdvance,
  subtractAdvance,
};
