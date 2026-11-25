const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const pricingService = require('../pricing/pricing.service');
const eventsService = require('../events/events.service');
const ordersService = require('../orders/orders.service');
const barService = require('../bar/bar.service');
const { UPLOAD_DIR } = require('../../middleware/quotationShareUpload');
const { publicBaseUrl } = require('../../config/publicBaseUrl');
const whatsapp = require('../../config/whatsapp');
const { logger } = require('../../config/logger');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_NIGHTS = 365;
const LIST_CAP = 500;
const MENU_QUOTE_DAYS = 7; // food / bar quotes stop being valid this many days after they are made

// Who may work with which kind. The route lets in anyone holding any of these;
// each handler then checks the kind it is touching.
const KIND_PERMISSIONS = {
  ROOM: ['rooms.manage', 'bookings.manage'],
  EVENT: ['events.manage'],
  FOOD: ['orders.manage', 'orders.take'],
  BAR: ['bar.manage', 'bar.take', 'bar.bill'],
};
const allowedKinds = (permissions = []) =>
  Object.keys(KIND_PERMISSIONS).filter((k) => KIND_PERMISSIONS[k].some((p) => permissions.includes(p)));
function assertKindAllowed(permissions, kind) {
  if (!allowedKinds(permissions).includes(kind)) throw new ApiError('Not allowed.', 403);
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const addDaysIso = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

function makeReferenceCode() {
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `QTN-${out}`;
}

function todayIsoIST() {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

const isoDay = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

// A quotation is good through its earliest check-in date: it reads Expired from the
// day after. Worked out on every read, so nothing has to
// run at midnight and a missed sweep can never leave a stale price "active".
function quotationState(status, checkInDate, today = todayIsoIST()) {
  if (status === 'BOOKED') return 'BOOKED';
  return isoDay(checkInDate) < today ? 'EXPIRED' : 'ACTIVE';
}

// The day a quotation stops being valid: check-in for rooms, valid_until otherwise.
const expiryOf = (row) => row.check_in_date ?? row.valid_until;

function mapRow(row, { withPayload = false } = {}) {
  const kind = row.kind || 'ROOM';
  const out = {
    id: row.id,
    kind,
    referenceCode: row.reference_code,
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    checkInDate: row.check_in_date ? isoDay(row.check_in_date) : null,
    lastCheckOutDate: row.last_check_out_date ? isoDay(row.last_check_out_date) : null,
    validUntil: expiryOf(row) ? isoDay(expiryOf(row)) : null,
    total: Number(row.total),
    roomSummary: row.room_summary,
    status: quotationState(row.status, expiryOf(row)),
    bookedBookingId: row.booked_booking_id,
    bookedRefId: row.booked_ref_id ?? null,
    createdAt: row.created_at,
  };
  if (withPayload) {
    const payload = JSON.parse(row.payload);
    if (kind === 'ROOM') out.rooms = payload;
    else out.details = payload;
  }
  return out;
}

function nightsBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

async function buildRoom(lodgeId, { rooms }) {
  const pool = await getPool();
  const payload = [];

  for (const r of rooms) {
    if (r.toDate <= r.fromDate) throw new ApiError('The to date must be after the from date.', 400);
    if (nightsBetween(r.fromDate, r.toDate) > MAX_NIGHTS) {
      throw new ApiError(`Quote up to ${MAX_NIGHTS} nights at a time.`, 400);
    }
    const result = await pricingService.simulateRange(
      lodgeId,
      r.roomId,
      r.fromDate,
      r.toDate,
      pricingService.parseChargeSelections(r.chargeIds)
    );
    const cat = await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('roomId', sql.BigInt, r.roomId)
      .query(`
        SELECT c.name
        FROM dbo.rooms rm JOIN dbo.room_categories c ON c.id = rm.category_id
        WHERE rm.id = @roomId AND rm.lodge_id = @lodgeId
      `);
    payload.push({
      roomId: r.roomId,
      roomNumber: result.roomNumber,
      categoryName: cat.recordset[0]?.name ?? '',
      fromDate: r.fromDate,
      toDate: r.toDate,
      chargeIds: r.chargeIds || '',
      result,
    });
  }

  const total = Math.round(payload.reduce((sum, p) => sum + p.result.total, 0) * 100) / 100;
  const checkIn = payload.map((p) => p.fromDate).sort()[0];
  const lastOut = payload.map((p) => p.toDate).sort().at(-1);
  const summary = payload.map((p) => `Room ${p.roomNumber}${p.categoryName ? ` · ${p.categoryName}` : ''}`).join(', ').slice(0, 300);
  return { payload, total, summary, checkIn, lastOut, validUntil: null };
}

async function buildEvent(lodgeId, { event, note }) {
  if (!event.startAt || !event.endAt) throw new ApiError('Choose when the function starts and ends.', 400);
  if (Date.parse(event.endAt) <= Date.parse(event.startAt)) throw new ApiError('The function must end after it starts.', 400);
  const startDay = new Date(Date.parse(event.startAt) + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const q = await eventsService.quote(lodgeId, event);
  if (q.overCapacity) throw new ApiError(q.overCapacity, 409);
  const payload = {
    input: event,
    venueName: q.venue.name,
    rateLabel: q.rate?.label ?? null,
    pricing: q.pricing,
    overBlock: q.overBlock,
    note,
  };
  const summary = `${q.venue.name} · ${q.pricing.billablePax} guests`.slice(0, 300);
  return { payload, total: q.pricing.totalAmount, summary, checkIn: null, lastOut: null, validUntil: startDay };
}

function menuTotals(lines, discountAmount) {
  const subtotal = round2(lines.reduce((sum, l) => sum + l.lineTotal, 0));
  const discount = round2(Math.min(Math.max(Number(discountAmount) || 0, 0), subtotal));
  return { subtotal, discount, total: round2(subtotal - discount) };
}

const menuSummary = (lines) => lines.map((l) => `${l.itemName} ×${l.quantity}`).join(', ').slice(0, 300);

async function buildFood(lodgeId, { items, discountAmount, note }) {
  const pool = await getPool();
  const lines = await ordersService.resolveOrderLines(pool, lodgeId, items);
  const t = menuTotals(lines, discountAmount);
  return {
    payload: { lines, ...t, note },
    total: t.total,
    summary: menuSummary(lines),
    checkIn: null,
    lastOut: null,
    validUntil: addDaysIso(todayIsoIST(), MENU_QUOTE_DAYS),
  };
}

// Bar prices already include tax, so tax is shown as a note, never added on.
async function buildBar(lodgeId, { items, discountAmount, note }) {
  const pool = await getPool();
  const resolved = await barService.resolveLines(pool, lodgeId, items);
  const lines = resolved.map(({ quantity, m }) => ({
    menuItemId: m.id,
    itemName: `${m.name} ${m.size_label}`,
    unitPrice: Number(m.price),
    quantity,
    lineTotal: round2(Number(m.price) * quantity),
  }));
  const t = menuTotals(lines, discountAmount);
  const { taxPercent } = await barService.getSettings(lodgeId);
  return {
    payload: { lines, ...t, taxPercent, note },
    total: t.total,
    summary: menuSummary(lines),
    checkIn: null,
    lastOut: null,
    validUntil: addDaysIso(todayIsoIST(), MENU_QUOTE_DAYS),
  };
}

const BUILDERS = { ROOM: buildRoom, EVENT: buildEvent, FOOD: buildFood, BAR: buildBar };

async function createQuotation(lodgeId, userId, data) {
  const { kind, guestName, guestPhone } = data;
  const pool = await getPool();
  const { payload, total, summary, checkIn, lastOut, validUntil } = await BUILDERS[kind](lodgeId, data);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const referenceCode = makeReferenceCode();
    try {
      const inserted = await pool
        .request()
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('code', sql.NVarChar, referenceCode)
        .input('name', sql.NVarChar, guestName)
        .input('phone', sql.NVarChar, guestPhone ?? null)
        .input('checkIn', sql.Date, checkIn)
        .input('lastOut', sql.Date, lastOut)
        .input('kind', sql.NVarChar, kind)
        .input('validUntil', sql.Date, validUntil)
        .input('total', sql.Decimal(12, 2), total)
        .input('summary', sql.NVarChar, summary)
        .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
        .input('userId', sql.BigInt, userId ?? null)
        .query(`
          INSERT INTO dbo.lodge_quotations
            (lodge_id, reference_code, guest_name, guest_phone, check_in_date, last_check_out_date,
             total, room_summary, payload, created_by, kind, valid_until)
          OUTPUT INSERTED.*
          VALUES (@lodgeId, @code, @name, @phone, @checkIn, @lastOut, @total, @summary, @payload, @userId, @kind, @validUntil)
        `);
      return mapRow(inserted.recordset[0], { withPayload: true });
    } catch (err) {
      if ((err.number === 2601 || err.number === 2627) && attempt < 2) continue;
      throw err;
    }
  }
  throw new ApiError('Could not save the quotation. Please try again.', 500);
}

async function listQuotations(lodgeId, { state, q, kind, kinds } = {}) {
  const pool = await getPool();
  const request = pool.request().input('lodgeId', sql.BigInt, lodgeId);
  let search = '';
  const term = (q || '').trim();
  if (term) {
    request.input('q', sql.NVarChar, `%${term}%`);
    search = 'AND (guest_name LIKE @q OR guest_phone LIKE @q OR reference_code LIKE @q OR room_summary LIKE @q)';
  }
  // Only kinds the caller may see; ?kind= narrows further.
  const wantedKinds = (kinds || Object.keys(KIND_PERMISSIONS)).filter((k) => !kind || k === String(kind).toUpperCase());
  if (wantedKinds.length === 0) return { quotations: [] };
  search += ` AND kind IN (${wantedKinds.map((k) => `'${k}'`).join(', ')})`;
  const result = await request.query(`
    SELECT TOP (${LIST_CAP}) id, lodge_id, reference_code, guest_name, guest_phone, check_in_date,
           last_check_out_date, total, room_summary, status, booked_booking_id, booked_ref_id, created_at,
           kind, valid_until
    FROM dbo.lodge_quotations
    WHERE lodge_id = @lodgeId AND deleted_at IS NULL ${search}
    ORDER BY created_at DESC
  `);
  const wanted = String(state || 'all').toUpperCase();
  const quotations = result.recordset
    .map((r) => mapRow(r))
    .filter((qt) => wanted === 'ALL' || qt.status === wanted);
  return { quotations };
}

async function loadRow(lodgeId, id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('id', sql.BigInt, id)
    .query('SELECT * FROM dbo.lodge_quotations WHERE id = @id AND lodge_id = @lodgeId AND deleted_at IS NULL');
  const row = result.recordset[0];
  if (!row) throw new ApiError('Quotation not found.', 404);
  return row;
}

async function getQuotation(lodgeId, id, permissions) {
  const row = await loadRow(lodgeId, id);
  if (permissions) assertKindAllowed(permissions, row.kind);
  return mapRow(row, { withPayload: true });
}

async function updateQuotation(lodgeId, id, { guestName, guestPhone, status, bookingId, refId }, permissions) {
  const row = await loadRow(lodgeId, id);
  if (permissions) assertKindAllowed(permissions, row.kind);
  const pool = await getPool();
  const request = pool.request().input('id', sql.BigInt, id).input('lodgeId', sql.BigInt, lodgeId);
  const sets = [];
  if (guestName !== undefined) {
    request.input('name', sql.NVarChar, guestName);
    sets.push('guest_name = @name');
  }
  if (guestPhone !== undefined) {
    request.input('phone', sql.NVarChar, guestPhone);
    sets.push('guest_phone = @phone');
  }
  if (status === 'BOOKED') {
    request.input('bookingId', sql.BigInt, (row.kind === 'ROOM' ? bookingId : refId) ?? null);
    sets.push("status = 'BOOKED'", row.kind === 'ROOM' ? 'booked_booking_id = @bookingId' : 'booked_ref_id = @bookingId');
  }
  if (sets.length === 0) return mapRow(row, { withPayload: true });
  const result = await request.query(
    `UPDATE dbo.lodge_quotations SET ${sets.join(', ')} OUTPUT INSERTED.* WHERE id = @id AND lodge_id = @lodgeId`
  );
  return mapRow(result.recordset[0], { withPayload: true });
}

async function deleteQuotation(lodgeId, id, permissions) {
  const row = await loadRow(lodgeId, id);
  if (permissions) assertKindAllowed(permissions, row.kind);
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('lodgeId', sql.BigInt, lodgeId)
    .query('UPDATE dbo.lodge_quotations SET deleted_at = SYSDATETIMEOFFSET() WHERE id = @id AND lodge_id = @lodgeId');
  return { ok: true };
}

const SHARE_DAYS = 30;

function discard(filename) {
  if (filename) fs.promises.unlink(path.join(UPLOAD_DIR, filename)).catch(() => {});
}

// Keeps the desk's PDF of this quotation and hands back a link a guest can open without logging in.
// One live link per quotation: sharing again replaces the file and the token.
async function shareQuotation(lodgeId, id, file, permissions) {
  if (!file) throw new ApiError('Attach the quotation PDF.', 400);
  let row;
  try {
    row = await loadRow(lodgeId, id);
    if (permissions) assertKindAllowed(permissions, row.kind);
    const baseUrl = publicBaseUrl();
    const token = crypto.randomBytes(18).toString('base64url');
    const pool = await getPool();
    await pool
      .request()
      .input('id', sql.BigInt, id)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('token', sql.NVarChar, token)
      .input('file', sql.NVarChar, file.filename)
      .input('days', sql.Int, SHARE_DAYS)
      .query(`UPDATE dbo.lodge_quotations
              SET share_token = @token, share_file = @file, share_expires_at = DATEADD(day, @days, SYSDATETIMEOFFSET())
              WHERE id = @id AND lodge_id = @lodgeId`);
    discard(row.share_file);
    return { link: `${baseUrl}/public/quotations/${token}`, expiresInDays: SHARE_DAYS };
  } catch (err) {
    discard(file.filename); // the new upload is not kept when the link could not be made
    throw err;
  }
}

// The provider joins a template's variables with commas, so a comma inside a value shifts every
// later one along, and a blank variable is rejected outright (same rule as billShare.service.js).
function clean(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ' - ').trim();
  return text || '-';
}

const longDay = (iso) =>
  new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const TYPE_LABEL = { ROOM: 'room', EVENT: 'event', FOOD: 'restaurant', BAR: 'bar' };

// What was quoted, on one line: a template variable cannot hold a line break.
function describeQuotation(row) {
  const payload = JSON.parse(row.payload);
  if (row.kind === 'ROOM') {
    return payload
      .map((r) => `Room ${r.roomNumber}${r.categoryName ? ` (${r.categoryName})` : ''} ${longDay(r.fromDate)} to ${longDay(r.toDate)}`)
      .join('; ');
  }
  if (row.kind === 'EVENT') {
    const start = payload.input?.startAt ? ` ${longDay(new Date(Date.parse(payload.input.startAt) + 5.5 * 3600 * 1000).toISOString())}` : '';
    return `${payload.venueName}${start} ${payload.pricing?.billablePax ?? ''} guests`;
  }
  return (payload.lines || []).map((l) => `${l.itemName} x${l.quantity}`).join('; ');
}

// Sends the quotation to the guest on WhatsApp from the server, with a link to the PDF the desk
// uploaded. Throws, like the bill and receipt shares: this is the action the desk asked for.
async function sendQuotationOnWhatsApp(lodgeId, userId, id, { file, phone }, permissions) {
  if (!whatsapp.isQuotationTemplateConfigured()) {
    discard(file?.filename);
    throw new ApiError('WhatsApp sending is not set up for quotations yet.', 503);
  }
  const row = await loadRow(lodgeId, id).catch((err) => {
    discard(file?.filename);
    throw err;
  });
  if (permissions) assertKindAllowed(permissions, row.kind);
  const target = whatsapp.normalisePhone(phone || row.guest_phone);
  if (!target) {
    discard(file?.filename);
    throw new ApiError('No WhatsApp number for this guest. Enter one to send the quotation.', 400);
  }
  const { link } = await shareQuotation(lodgeId, id, file, permissions);
  const pool = await getPool();
  const lodge = (await pool.request().input('lodgeId', sql.BigInt, lodgeId).query('SELECT name, phone FROM dbo.lodges WHERE id = @lodgeId')).recordset[0] || {};
  const until = expiryOf(row);
  const sample = [
    clean(row.guest_name || 'Guest'),
    clean(lodge.name),
    clean(TYPE_LABEL[row.kind]),
    clean(row.reference_code),
    clean(describeQuotation(row)).slice(0, 300),
    clean(`Rs ${Number(row.total).toFixed(2)}`),
    clean(until ? longDay(isoDay(until)) : ''),
    link, // not cleaned: a URL has no commas
    clean(lodge.phone),
  ].join(',');
  try {
    const sent = await whatsapp.sendTemplateMessage(target, whatsapp.QUOTATION_TEMPLATE_ID, sample, 'quotation_share');
    logger.info({ lodgeId, quotationId: id, userId, phone: target, campaignId: sent.campaignId }, 'Quotation sent to guest on WhatsApp');
    return { status: 'sent', phone: target, referenceCode: row.reference_code, link };
  } catch (err) {
    logger.warn({ lodgeId, quotationId: id, phone: target, err }, 'Quotation could not be sent on WhatsApp');
    throw new ApiError(err.message || 'WhatsApp could not send the quotation.', 502);
  }
}

// The PDF behind a shared link, or a 404 once it has expired or the quotation was deleted.
async function readSharedQuotation(token) {
  if (!/^[A-Za-z0-9_-]{10,40}$/.test(token)) throw new ApiError('This link is not valid.', 404);
  const pool = await getPool();
  const result = await pool
    .request()
    .input('token', sql.NVarChar, token)
    .query(`SELECT reference_code, share_file FROM dbo.lodge_quotations
            WHERE share_token = @token AND deleted_at IS NULL AND share_expires_at > SYSDATETIMEOFFSET()`);
  const row = result.recordset[0];
  const filePath = row && path.join(UPLOAD_DIR, row.share_file);
  if (!row || !fs.existsSync(filePath)) throw new ApiError('This link has expired or is not valid.', 404);
  return { filePath, referenceCode: row.reference_code };
}

module.exports = {
  shareQuotation,
  sendQuotationOnWhatsApp,
  describeQuotation,
  readSharedQuotation,
  createQuotation,
  listQuotations,
  getQuotation,
  updateQuotation,
  deleteQuotation,
  quotationState,
  allowedKinds,
  assertKindAllowed,
  KIND_PERMISSIONS,
};
