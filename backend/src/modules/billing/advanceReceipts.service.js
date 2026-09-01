const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const { toClockTime } = require('../rooms/checkoutPolicy.service');
const {
  taxWithin,
  round2,
  getGstSlabs,
  ratePercentFor,
  nightlyAmounts,
  insertPaymentLines,
  readPaymentLines,
} = require('./billing.service');
const { paymentLinesOf } = require('../bookings/bookings.schema');
const eventsService = require('../events/events.service');

// The receipt a guest is handed when they pay an advance at the time of
// booking. Under GST that document is a Receipt Voucher (Rule 50): money taken
// against a supply that has not been made yet, acknowledged now, with the tax
// invoice at checkout covering the whole stay as its own separate document.
//
// Why this sits beside billing rather than inside it: the two write different
// documents against the same stay and must not share a numbering series or a
// status. Billing's own filtered index enforces one ISSUED invoice per booking,
// which is exactly the rule an advance receipt must not obey — a booking can
// carry several, one per instalment, and still be billed once at the end.
//
// A function booked for a wedding or a birthday takes an advance far more
// often than a stay does, and usually in instalments. The same receipt serves
// it: the row hangs off event_booking_id instead of booking_id, the amount
// is held on the function the way it is held on the stay, and the tax inside
// the advance is taken at the hall-hire rate rather than a nightly band.

// What rate the advance is taxed at.
//
// GST bands accommodation on the *nightly tariff*, not on the size of the
// payment — so a ₹1,000 advance against a ₹5,000-a-night room is taxed in the
// ₹5,000 band, not the ₹1,000 one. Reading the slab off the advance itself is
// the obvious mistake here, and it understates the tax on every part payment.
//
// Nights can be banded differently from each other (a season uplift can push
// one night up a slab). The advance is not against any particular night, so it
// takes the rate of the highest-banded night the stay contains: that is the
// rate the supply is capable of attracting, and under-declaring on an advance
// is the direction that costs the property at assessment.
//
// A function has no nights: hall hire is one flat rate, carried on the subject
// row by loadEventForReceipt.
function advanceRatePercent(booking, slabs) {
  if (booking.flat_rate_percent != null) return Number(booking.flat_rate_percent);
  const nights = nightlyAmounts(booking);
  if (nights.length === 0) return 0;
  return nights.reduce((highest, night) => Math.max(highest, ratePercentFor(night, slabs)), 0);
}

// The tax already sitting inside the money the guest handed over.
//
// Every price in this system is GST-inclusive, and an advance is a payment of
// one of those prices — so the receipt declares the tax *within* the amount
// rather than adding any to it. This is what keeps the final bill's arithmetic
// untouched: billing subtracts the same inclusive advance from an inclusive
// total, and the guest is never charged tax twice on the same rupee.
//
// Halved into CGST and SGST with each half rounded independently, matching the
// accommodation rule in billing.service.js that exists to keep GSTR-1
// reconciliation clean.
function taxOnAdvance(amount, ratePercent) {
  const cgstAmount = round2(taxWithin(amount, ratePercent) / 2);
  const sgstAmount = round2(taxWithin(amount, ratePercent) / 2);
  return { cgstAmount, sgstAmount };
}

const LODGE_COLUMNS = `
             l.is_gst_registered, l.gstin, l.checkin_mode, l.check_out_time,
             l.name AS lodge_name, l.phone AS lodge_phone, l.address AS lodge_address,
             l.name_mr AS lodge_name_mr, l.address_mr AS lodge_address_mr,
             l.city AS lodge_city, l.state AS lodge_state`;

// The stay, the property, and everything the printed receipt puts in its head.
// One query, because the document is rendered straight off this row.
async function loadBookingForReceipt(request, lodgeId, bookingId) {
  const result = await request
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT b.*, r.room_number, c.name AS category_name, ${LODGE_COLUMNS}
      FROM dbo.bookings b
      JOIN dbo.rooms r ON r.id = b.room_id
      JOIN dbo.room_categories c ON c.id = r.category_id
      JOIN dbo.lodges l ON l.id = b.lodge_id
      WHERE b.id = @bookingId AND b.lodge_id = @lodgeId
    `);
  const booking = result.recordset[0];
  if (!booking) throw new ApiError('Booking not found.', 404);
  return booking;
}

// The function, shaped like a stay for everything below: the same total,
// advance and masthead columns under the names the receipt maths reads, plus
// the flat hall-hire rate in place of nightly bands.
async function loadEventForReceipt(request, lodgeId, eventBookingId) {
  const result = await request
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('eventId', sql.BigInt, eventBookingId)
    .query(`
      SELECT e.*, e.total_amount AS total_price,
             e.organiser_name AS guest_name, e.organiser_phone AS guest_phone,
             e.title AS event_title, v.name AS venue_name,
             e.start_at AS event_start_at, e.end_at AS event_end_at,
             (SELECT TOP 1 rate_percent FROM dbo.gst_slabs
              WHERE is_active = 1 AND supply_type = 'VENUE' ORDER BY id) AS flat_rate_percent,
             ${LODGE_COLUMNS}
      FROM dbo.event_bookings e
      JOIN dbo.event_venues v ON v.id = e.venue_id
      JOIN dbo.lodges l ON l.id = e.lodge_id
      WHERE e.id = @eventId AND e.lodge_id = @lodgeId
    `);
  const row = result.recordset[0];
  if (!row) throw new ApiError('Event booking not found.', 404);
  return { ...row, event_booking_id: row.id, flat_rate_percent: row.flat_rate_percent ?? 0 };
}

function toIsoDate(value) {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function toIsoInstant(value) {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// The receipt as the document will print it. Deliberately the same field names
// the bill document already reads, so the two share a masthead and a money
// column rather than each inventing their own.
//
// `row` carries the receipt's own columns joined onto the stay and the lodge —
// which is why the receipt fields are read explicitly rather than spread: a
// booking and a receipt both have an `id` and a `status`, and spreading would
// let the stay quietly win.
function mapReceipt(row) {
  const amountReceived = Number(row.amount_received);
  const cgstAmount = Number(row.cgst_amount);
  const sgstAmount = Number(row.sgst_amount);
  const stayTotal = Number(row.stay_total);
  return {
    id: row.id,
    bookingId: row.booking_id ?? null,
    // Against a stay or against a function. The document branches on this
    // for its register strip; nothing about the money changes.
    kind: row.event_booking_id != null ? 'EVENT' : 'STAY',
    eventBookingId: row.event_booking_id ?? null,
    eventTitle: row.event_title ?? null,
    eventType: row.event_type ?? null,
    venueName: row.venue_name ?? null,
    eventStartAt: toIsoInstant(row.event_start_at),
    eventEndAt: toIsoInstant(row.event_end_at),
    receiptNumber: row.receipt_number,
    documentType: row.document_type,
    billingSide: row.billing_side,
    // What the guest handed over, tax inside.
    amountReceived,
    cgstAmount,
    sgstAmount,
    // The rate each half was taken at — half the slab rate, because the slab is
    // split between the two. The document prints them as "CGST 6 %".
    cgstRatePercent: round2(Number(row.rate_percent) / 2),
    sgstRatePercent: round2(Number(row.rate_percent) / 2),
    // The taxable value the rates were charged on: the advance less the tax
    // inside it. Stated because a receipt voucher has to say what was taxed,
    // and because taxable × rate has to come back to the tax charged.
    taxableValue: round2(amountReceived - cgstAmount - sgstAmount),
    // The stay as it stood when the receipt was written, and what is left on it.
    // Frozen at issue: extending the booking afterwards must not restate a
    // document the guest is already holding.
    stayTotal,
    balanceDue: round2(stayTotal - amountReceived),
    paymentMethod: row.payment_method,
    paymentReference: row.payment_reference ?? null,
    // Every way this advance was handed over. A receipt taken before split
    // payments existed reads as a single line built from the two fields above,
    // so the printed receipt has one shape to render rather than two.
    paymentLines: readPaymentLines(
      row.payment_lines,
      row.payment_method,
      row.amount_received,
      row.payment_reference
    ),
    status: row.status,
    voidReason: row.void_reason ?? null,
    voidedAt: row.voided_at ?? null,
    createdAt: row.created_at ?? null,

    // The stay this is against, for the register strip on the document.
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    numGuests: row.num_guests ?? null,
    roomNumber: row.room_number ?? null,
    categoryName: row.category_name ?? null,
    checkInDate: toIsoDate(row.check_in_date),
    checkOutDate: toIsoDate(row.check_out_date),

    // The masthead — same fields, same names the bill document already reads.
    gstin: row.gstin,
    isGstRegistered: !!row.is_gst_registered,
    lodgeName: row.lodge_name,
    lodgePhone: row.lodge_phone,
    lodgeAddress: row.lodge_address,
    lodgeNameMr: row.lodge_name_mr ?? null,
    lodgeAddressMr: row.lodge_address_mr ?? null,
    lodgeCity: row.lodge_city,
    lodgeState: row.lodge_state,
    checkinMode: row.checkin_mode ?? null,
    checkOutTime: toClockTime(row.check_out_time),
  };
}

const RECEIPT_SELECT = `
  SELECT ar.id, ar.booking_id, ar.event_booking_id, ar.receipt_number, ar.document_type, ar.billing_side,
         ar.amount_received, ar.cgst_amount, ar.sgst_amount, ar.rate_percent, ar.stay_total,
         ar.payment_method, ar.payment_reference, ar.status, ar.void_reason, ar.voided_at,
         ar.created_at,
         (SELECT pl.method, pl.amount, pl.reference
          FROM dbo.payment_lines pl
          WHERE pl.advance_receipt_id = ar.id
          ORDER BY pl.id
          FOR JSON PATH) AS payment_lines,
         COALESCE(b.guest_name, eb.organiser_name) AS guest_name,
         COALESCE(b.guest_phone, eb.organiser_phone) AS guest_phone,
         b.num_guests, b.check_in_date, b.check_out_date,
         r.room_number, c.name AS category_name,
         eb.title AS event_title, eb.event_type, ev.name AS venue_name,
         eb.start_at AS event_start_at, eb.end_at AS event_end_at,
         ${LODGE_COLUMNS}
  FROM dbo.advance_receipts ar
  -- LEFT on both parents: a receipt is against a stay or against a function.
  LEFT JOIN dbo.bookings b ON b.id = ar.booking_id
  LEFT JOIN dbo.rooms r ON r.id = b.room_id
  LEFT JOIN dbo.room_categories c ON c.id = r.category_id
  LEFT JOIN dbo.event_bookings eb ON eb.id = ar.event_booking_id
  LEFT JOIN dbo.event_venues ev ON ev.id = eb.venue_id
  JOIN dbo.lodges l ON l.id = ar.lodge_id
`;

async function getAdvanceReceipt(lodgeId, receiptId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('receiptId', sql.BigInt, receiptId)
    .query(`${RECEIPT_SELECT} WHERE ar.id = @receiptId AND ar.lodge_id = @lodgeId`);
  const row = result.recordset[0];
  if (!row) throw new ApiError('Receipt not found.', 404);
  return mapReceipt(row);
}

// Every receipt this property has written, newest first. The bills list shows
// these alongside invoices: an advance receipt is money taken and reported, so
// a month's takings that omitted them would understate what the property
// actually collected.
//
// Capped at the same 200 the invoice list is, and for the same reason — this
// feeds a screen, not a return.
async function listAdvanceReceipts(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`${RECEIPT_SELECT} WHERE ar.lodge_id = @lodgeId
            ORDER BY ar.created_at DESC
            OFFSET 0 ROWS FETCH NEXT 200 ROWS ONLY`);
  return result.recordset.map(mapReceipt);
}

// Every receipt written against one booking, newest first. The booking detail
// screen shows these so the desk reprints what it already handed over instead
// of issuing a second receipt for the same money.
async function listAdvanceReceiptsForBooking(lodgeId, bookingId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .query(`${RECEIPT_SELECT} WHERE ar.booking_id = @bookingId AND ar.lodge_id = @lodgeId
            ORDER BY ar.id DESC`);
  return result.recordset.map(mapReceipt);
}

async function listAdvanceReceiptsForEvent(lodgeId, eventBookingId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('eventId', sql.BigInt, eventBookingId)
    .query(`${RECEIPT_SELECT} WHERE ar.event_booking_id = @eventId AND ar.lodge_id = @lodgeId
            ORDER BY ar.id DESC`);
  return result.recordset.map(mapReceipt);
}

// Pure, given the booking and the slabs — so the preview and the issue path
// compute the document exactly once between them, and what gets written is
// provably what was shown.
// What the booking held before the advance this receipt is for.
//
// On the automatic path the booking's own INSERT/UPDATE has already recorded
// the money, so the row's advance_amount *includes* this amount; counting it as
// "already held" and then adding the amount again doubled every advance at the
// guard. Anything over half the stay was refused a receipt it was entitled to,
// and a stay paid in full — exactly the case a guest most wants paper for —
// was refused every time. The booking survived by design, so the failure was a
// log line and a desk with nothing to print.
function heldBefore(booking, amount, alreadyOnBooking) {
  const onRow = round2(Number(booking.advance_amount) || 0);
  return alreadyOnBooking ? Math.max(0, round2(onRow - amount)) : onRow;
}

function buildReceiptPreview(booking, slabs, input, { alreadyOnBooking = false } = {}) {
  const amount = round2(Number(input.amountReceived));
  if (!(amount > 0)) {
    throw new ApiError('An advance receipt needs an amount.', 400);
  }

  const isEvent = booking.event_booking_id != null;
  const noun = isEvent ? 'function' : 'stay';
  const stayTotal = Number(booking.total_price);
  // Held to the stay it is against. Taking more than the stay costs is a
  // data-entry slip, and one that would print a negative balance due on a
  // document handed to a guest.
  const alreadyHeld = heldBefore(booking, amount, alreadyOnBooking);
  if (round2(alreadyHeld + amount) > stayTotal) {
    throw new ApiError(
      alreadyHeld > 0
        ? `That would take the advance past the ${noun} total of ₹${stayTotal} — ₹${alreadyHeld} is already held.`
        : `An advance can’t be more than the ${noun} total of ₹${stayTotal}.`,
      400
    );
  }

  const billingSide = booking.is_gst_registered ? 'GST' : 'NON_GST';
  const ratePercent = billingSide === 'GST' ? advanceRatePercent(booking, slabs) : 0;
  const { cgstAmount, sgstAmount } =
    ratePercent > 0 ? taxOnAdvance(amount, ratePercent) : { cgstAmount: 0, sgstAmount: 0 };

  // A receipt voucher is a taxable document. Where there is no tax to state —
  // an unregistered property, or a stay banded below the nil threshold — the
  // document is a plain acknowledgement instead, and says so in its title.
  const documentType = ratePercent > 0 ? 'RECEIPT_VOUCHER' : 'ADVANCE_RECEIPT';

  return mapReceipt({
    ...booking,
    // After the spread, so the receipt's own identity wins over the booking's.
    // The number and the date are blank on purpose: both are allocated at issue
    // to keep the series gapless, and a preview that filled them in would show
    // the desk a number the receipt will not actually carry.
    id: null,
    booking_id: isEvent ? null : booking.id,
    event_booking_id: isEvent ? booking.event_booking_id : null,
    receipt_number: null,
    document_type: documentType,
    billing_side: billingSide,
    amount_received: amount,
    cgst_amount: cgstAmount,
    sgst_amount: sgstAmount,
    rate_percent: ratePercent,
    stay_total: stayTotal,
    payment_method: input.paymentMethod,
    payment_reference: input.paymentReference ?? null,
    status: 'PREVIEW',
    void_reason: null,
    voided_at: null,
    created_at: null,
  });
}

// What the receipt would say, before it exists — so the desk sees the document
// it is about to hand over rather than discovering it after the number has been
// burned.
async function previewAdvanceReceipt(lodgeId, bookingId, input) {
  const pool = await getPool();
  const booking = await loadBookingForReceipt(pool.request(), lodgeId, bookingId);
  const slabs = await getGstSlabs(pool);
  return buildReceiptPreview(booking, slabs, input);
}

async function previewEventAdvanceReceipt(lodgeId, eventBookingId, input) {
  const pool = await getPool();
  const event = await loadEventForReceipt(pool.request(), lodgeId, eventBookingId);
  const slabs = await getGstSlabs(pool);
  return buildReceiptPreview(event, slabs, input);
}

// The advance series, created on first use the way the invoice series is.
// Its own run rather than sharing the bill series: an advance taken today
// and a bill cut next week must not interleave, or the tax-invoice
// numbering develops gaps an auditor will ask about. No prefix — the serial
// the owner set is the whole number (see billing/series.service.js).
//
// Atomic allocate-and-bump, never SELECT MAX()+1: two desks taking an
// advance at the same moment must not be handed the same number.
async function allocateReceiptNumber(transaction, lodgeId) {
  const seriesResult = await new sql.Request(transaction)
    .input('lodgeId', sql.BigInt, lodgeId)
    .query("SELECT id FROM dbo.invoice_series WHERE lodge_id = @lodgeId AND series_type = 'ADVANCE'");
  if (seriesResult.recordset.length === 0) {
    await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .query(`INSERT INTO dbo.invoice_series (lodge_id, series_type, prefix, next_number)
              VALUES (@lodgeId, 'ADVANCE', N'', 1)`);
  }
  const allocated = await new sql.Request(transaction)
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      UPDATE dbo.invoice_series
      SET next_number = next_number + 1
      OUTPUT deleted.next_number AS number, deleted.prefix AS prefix
      WHERE lodge_id = @lodgeId AND series_type = 'ADVANCE'
    `);
  const { number, prefix } = allocated.recordset[0];
  return `${prefix}${number}`;
}

async function insertReceipt(transaction, lodgeId, userId, parent, preview, paymentLines, input) {
  const receiptNumber = await allocateReceiptNumber(transaction, lodgeId);
  const inserted = await new sql.Request(transaction)
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, parent.bookingId ?? null)
    .input('eventId', sql.BigInt, parent.eventBookingId ?? null)
    .input('receiptNumber', sql.NVarChar, receiptNumber)
    .input('documentType', sql.NVarChar, preview.documentType)
    .input('billingSide', sql.NVarChar, preview.billingSide)
    .input('amountReceived', sql.Decimal(10, 2), preview.amountReceived)
    .input('cgstAmount', sql.Decimal(10, 2), preview.cgstAmount)
    .input('sgstAmount', sql.Decimal(10, 2), preview.sgstAmount)
    .input('ratePercent', sql.Decimal(5, 2), round2(preview.cgstRatePercent + preview.sgstRatePercent))
    .input('stayTotal', sql.Decimal(10, 2), preview.stayTotal)
    // The receipt's own summary of its lines — the column is NOT NULL, so a
    // split still has to name one, and the first tender is the honest choice.
    .input('paymentMethod', sql.NVarChar, paymentLines[0]?.method ?? input.paymentMethod)
    .input('paymentReference', sql.NVarChar, input.paymentReference ?? null)
    .input('createdBy', sql.BigInt, userId ?? null)
    .query(`
      INSERT INTO dbo.advance_receipts
        (lodge_id, booking_id, event_booking_id, receipt_number, document_type, billing_side, amount_received,
         cgst_amount, sgst_amount, rate_percent, stay_total, payment_method, payment_reference,
         created_by)
      OUTPUT inserted.id
      VALUES
        (@lodgeId, @bookingId, @eventId, @receiptNumber, @documentType, @billingSide, @amountReceived,
         @cgstAmount, @sgstAmount, @ratePercent, @stayTotal, @paymentMethod, @paymentReference,
         @createdBy)
    `);
  const receiptId = inserted.recordset[0].id;
  await insertPaymentLines(transaction, lodgeId, { advanceReceiptId: receiptId }, paymentLines);
  return receiptId;
}

// Writes the receipt and burns a number for it in one transaction — the number
// and the row commit together or neither does, which is what keeps the series
// gapless.
// `alreadyOnBooking` is for the receipt that is raised automatically the
// moment an advance is taken, rather than from the billing screen afterwards.
// In that case the booking's own INSERT/UPDATE has already recorded the money,
// so adding it again here would double every advance the property ever takes —
// the update below accumulates rather than replaces, deliberately, because a
// second instalment is more money in and not a correction of the first.
async function issueAdvanceReceipt(lodgeId, userId, bookingId, input, { alreadyOnBooking = false } = {}) {
  const pool = await getPool();
  const slabs = await getGstSlabs(pool);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const booking = await loadBookingForReceipt(new sql.Request(transaction), lodgeId, bookingId);
    // Nothing to acknowledge on a stay that was called off: the receipt would
    // state a balance due against a booking that no longer stands.
    if (booking.status === 'CANCELLED') {
      throw new ApiError('This booking was cancelled — no advance receipt can be issued against it.', 409);
    }

    const preview = buildReceiptPreview(booking, slabs, input, { alreadyOnBooking });

    // However the request described its payment, this is the list to store.
    const paymentLines = paymentLinesOf(input, preview.amountReceived);
    const isSplit = paymentLines.length > 1;
    // What the booking held before this receipt — net of this amount on the
    // automatic path, where the row already carries it.
    const heldBeforeThis = heldBefore(booking, preview.amountReceived, alreadyOnBooking);

    // The advance is money the property is now holding, so the booking has to
    // carry it too — that is the figure the final bill reads as "Less Advance",
    // and a receipt whose amount the bill never sees would hand the guest a
    // document for money the checkout desk then asks for again.
    //
    // Added to rather than replaced: a second instalment is more money in, not
    // a correction of the first.
    await new sql.Request(transaction)
      .input('bookingId', sql.BigInt, bookingId)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('amount', sql.Decimal(10, 2), preview.amountReceived)
      // NULL when this is a split landing on a booking that already held an
      // advance — and the COALESCE below then leaves the column alone.
      //
      // This is load-bearing, and the reason is not obvious. The collections
      // report attributes advance money by reading bookings.advance_amount and
      // apportioning it across this booking's payment lines, giving whatever is
      // left over to advance_payment_method. That remainder is money taken
      // before payment lines existed, and this column is the only record of how
      // it arrived. Overwriting it here would reattribute that older money to a
      // method it never used — and because the report dates advances by
      // bookings.created_at, it would do so inside a month somebody has already
      // reconciled.
      //
      // A split on a booking with nothing held before has no such remainder, so
      // the first line is a safe summary there.
      .input('method', sql.NVarChar, isSplit && heldBeforeThis > 0 ? null : paymentLines[0]?.method ?? null)
      .input('reference', sql.NVarChar, paymentLines[0]?.reference ?? null)
      .query(`
        UPDATE dbo.bookings
        SET ${alreadyOnBooking ? '' : 'advance_amount = ISNULL(advance_amount, 0) + @amount,'}
            advance_payment_method = COALESCE(@method, advance_payment_method),
            advance_reference = COALESCE(@reference, advance_reference)
        WHERE id = @bookingId AND lodge_id = @lodgeId
      `);

    const receiptId = await insertReceipt(transaction, lodgeId, userId, { bookingId }, preview, paymentLines, input);

    await transaction.commit();
    return getAdvanceReceipt(lodgeId, receiptId);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

// The same document against a function. Money in is what confirms a booking
// that was only held or enquired about, so the status moves with the receipt
// — see eventsService.addAdvance.
async function issueEventAdvanceReceipt(lodgeId, userId, eventBookingId, input) {
  const pool = await getPool();
  const slabs = await getGstSlabs(pool);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const event = await loadEventForReceipt(new sql.Request(transaction), lodgeId, eventBookingId);
    if (event.status === 'CANCELLED') {
      throw new ApiError('This function was cancelled — no advance receipt can be issued against it.', 409);
    }
    if (event.status === 'SETTLED') {
      throw new ApiError('This function has already been billed — nothing more is due on it.', 409);
    }

    const preview = buildReceiptPreview(event, slabs, input);
    const paymentLines = paymentLinesOf(input, preview.amountReceived);

    await eventsService.addAdvance(
      transaction,
      lodgeId,
      eventBookingId,
      preview.amountReceived,
      paymentLines.length > 1 ? null : paymentLines[0]?.method ?? null,
      paymentLines[0]?.reference ?? null
    );

    const receiptId = await insertReceipt(transaction, lodgeId, userId, { eventBookingId }, preview, paymentLines, input);

    await transaction.commit();
    return getAdvanceReceipt(lodgeId, receiptId);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

// Voided in place, never deleted — an issued money document that vanishes is a
// gap in the series nobody can account for. The advance comes back off the
// booking with it, so the checkout desk asks for the full amount again.
async function voidAdvanceReceipt(lodgeId, receiptId, reason) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('receiptId', sql.BigInt, receiptId)
      .input('reason', sql.NVarChar, reason)
      .query(`
        UPDATE dbo.advance_receipts
        SET status = 'VOID', void_reason = @reason, voided_at = SYSDATETIMEOFFSET()
        OUTPUT inserted.booking_id AS bookingId, inserted.event_booking_id AS eventBookingId,
               inserted.amount_received AS amountReceived
        WHERE id = @receiptId AND lodge_id = @lodgeId AND status = 'ISSUED'
      `);
    if (result.recordset.length === 0) {
      throw new ApiError('Receipt not found or already void.', 409);
    }
    const { bookingId, eventBookingId, amountReceived } = result.recordset[0];

    if (eventBookingId != null) {
      await eventsService.subtractAdvance(transaction, lodgeId, eventBookingId, amountReceived);
    } else {
      // Floored at zero rather than allowed to go negative: the booking's advance
      // may have been corrected by hand since, and a negative advance would print
      // on the final bill as money owed *to* the guest.
      await new sql.Request(transaction)
        .input('bookingId', sql.BigInt, bookingId)
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('amount', sql.Decimal(10, 2), amountReceived)
        .query(`
          UPDATE dbo.bookings
          SET advance_amount =
                CASE WHEN ISNULL(advance_amount, 0) - @amount > 0
                     THEN ISNULL(advance_amount, 0) - @amount
                     ELSE NULL END
          WHERE id = @bookingId AND lodge_id = @lodgeId
        `);
    }

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  return getAdvanceReceipt(lodgeId, receiptId);
}

module.exports = {
  previewAdvanceReceipt,
  issueAdvanceReceipt,
  previewEventAdvanceReceipt,
  issueEventAdvanceReceipt,
  getAdvanceReceipt,
  listAdvanceReceipts,
  listAdvanceReceiptsForBooking,
  listAdvanceReceiptsForEvent,
  voidAdvanceReceipt,
};
