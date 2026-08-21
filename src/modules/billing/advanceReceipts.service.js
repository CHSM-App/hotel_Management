const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const { toClockTime } = require('../rooms/checkoutPolicy.service');
const {
  taxWithin,
  round2,
  getGstSlabs,
  ratePercentFor,
  nightlyAmounts,
} = require('./billing.service');

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
function advanceRatePercent(booking, slabs) {
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

// The stay, the property, and everything the printed receipt puts in its head.
// One query, because the document is rendered straight off this row.
async function loadBookingForReceipt(request, lodgeId, bookingId) {
  const result = await request
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT b.*, r.room_number, c.name AS category_name,
             l.is_gst_registered, l.gstin, l.checkin_mode, l.check_out_time,
             l.name AS lodge_name, l.phone AS lodge_phone, l.address AS lodge_address,
             l.name_mr AS lodge_name_mr, l.address_mr AS lodge_address_mr,
             l.city AS lodge_city, l.state AS lodge_state
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

function toIsoDate(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
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
    bookingId: row.booking_id,
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
    status: row.status,
    voidReason: row.void_reason ?? null,
    voidedAt: row.voided_at ?? null,
    createdAt: row.created_at ?? null,

    // The stay this is against, for the register strip on the document.
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    numGuests: row.num_guests,
    roomNumber: row.room_number,
    categoryName: row.category_name,
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
  SELECT ar.id, ar.booking_id, ar.receipt_number, ar.document_type, ar.billing_side,
         ar.amount_received, ar.cgst_amount, ar.sgst_amount, ar.rate_percent, ar.stay_total,
         ar.payment_method, ar.payment_reference, ar.status, ar.void_reason, ar.voided_at,
         ar.created_at,
         b.guest_name, b.guest_phone, b.num_guests, b.check_in_date, b.check_out_date,
         r.room_number, c.name AS category_name,
         l.is_gst_registered, l.gstin, l.checkin_mode, l.check_out_time,
         l.name AS lodge_name, l.phone AS lodge_phone, l.address AS lodge_address,
         l.name_mr AS lodge_name_mr, l.address_mr AS lodge_address_mr,
         l.city AS lodge_city, l.state AS lodge_state
  FROM dbo.advance_receipts ar
  JOIN dbo.bookings b ON b.id = ar.booking_id
  JOIN dbo.rooms r ON r.id = b.room_id
  JOIN dbo.room_categories c ON c.id = r.category_id
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

// Pure, given the booking and the slabs — so the preview and the issue path
// compute the document exactly once between them, and what gets written is
// provably what was shown.
function buildReceiptPreview(booking, slabs, input) {
  const amount = round2(Number(input.amountReceived));
  if (!(amount > 0)) {
    throw new ApiError('An advance receipt needs an amount.', 400);
  }

  const stayTotal = Number(booking.total_price);
  // Held to the stay it is against. Taking more than the stay costs is a
  // data-entry slip, and one that would print a negative balance due on a
  // document handed to a guest.
  const alreadyHeld = round2(Number(booking.advance_amount) || 0);
  if (round2(alreadyHeld + amount) > stayTotal) {
    throw new ApiError(
      alreadyHeld > 0
        ? `That would take the advance past the stay total of ₹${stayTotal} — ₹${alreadyHeld} is already held.`
        : `An advance can’t be more than the stay total of ₹${stayTotal}.`,
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
    booking_id: booking.id,
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

// Writes the receipt and burns a number for it in one transaction — the number
// and the row commit together or neither does, which is what keeps the series
// gapless.
async function issueAdvanceReceipt(lodgeId, userId, bookingId, input) {
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

    const preview = buildReceiptPreview(booking, slabs, input);

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
      .input('method', sql.NVarChar, input.paymentMethod)
      .input('reference', sql.NVarChar, input.paymentReference ?? null)
      .query(`
        UPDATE dbo.bookings
        SET advance_amount = ISNULL(advance_amount, 0) + @amount,
            advance_payment_method = @method,
            advance_reference = COALESCE(@reference, advance_reference)
        WHERE id = @bookingId AND lodge_id = @lodgeId
      `);

    // The advance series, created on first use the way the invoice series is.
    // ADV- rather than RCT-, which the non-GST bill side already uses — two
    // different documents sharing a prefix is two documents nobody can tell
    // apart on a bank statement.
    const seriesResult = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .query("SELECT id FROM dbo.invoice_series WHERE lodge_id = @lodgeId AND series_type = 'ADVANCE'");
    if (seriesResult.recordset.length === 0) {
      await new sql.Request(transaction)
        .input('lodgeId', sql.BigInt, lodgeId)
        .query(`INSERT INTO dbo.invoice_series (lodge_id, series_type, prefix, next_number)
                VALUES (@lodgeId, 'ADVANCE', 'ADV-', 1)`);
    }

    // Atomic allocate-and-bump, never SELECT MAX()+1: two desks taking an
    // advance at the same moment must not be handed the same number.
    const allocated = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .query(`
        UPDATE dbo.invoice_series
        SET next_number = next_number + 1
        OUTPUT deleted.next_number AS number, deleted.prefix AS prefix
        WHERE lodge_id = @lodgeId AND series_type = 'ADVANCE'
      `);
    const { number, prefix } = allocated.recordset[0];
    const receiptNumber = `${prefix}${number}`;

    const inserted = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('bookingId', sql.BigInt, bookingId)
      .input('receiptNumber', sql.NVarChar, receiptNumber)
      .input('documentType', sql.NVarChar, preview.documentType)
      .input('billingSide', sql.NVarChar, preview.billingSide)
      .input('amountReceived', sql.Decimal(10, 2), preview.amountReceived)
      .input('cgstAmount', sql.Decimal(10, 2), preview.cgstAmount)
      .input('sgstAmount', sql.Decimal(10, 2), preview.sgstAmount)
      .input('ratePercent', sql.Decimal(5, 2), round2(preview.cgstRatePercent + preview.sgstRatePercent))
      .input('stayTotal', sql.Decimal(10, 2), preview.stayTotal)
      .input('paymentMethod', sql.NVarChar, input.paymentMethod)
      .input('paymentReference', sql.NVarChar, input.paymentReference ?? null)
      .input('createdBy', sql.BigInt, userId ?? null)
      .query(`
        INSERT INTO dbo.advance_receipts
          (lodge_id, booking_id, receipt_number, document_type, billing_side, amount_received,
           cgst_amount, sgst_amount, rate_percent, stay_total, payment_method, payment_reference,
           created_by)
        OUTPUT inserted.id
        VALUES
          (@lodgeId, @bookingId, @receiptNumber, @documentType, @billingSide, @amountReceived,
           @cgstAmount, @sgstAmount, @ratePercent, @stayTotal, @paymentMethod, @paymentReference,
           @createdBy)
      `);

    await transaction.commit();
    return getAdvanceReceipt(lodgeId, inserted.recordset[0].id);
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
        OUTPUT inserted.booking_id AS bookingId, inserted.amount_received AS amountReceived
        WHERE id = @receiptId AND lodge_id = @lodgeId AND status = 'ISSUED'
      `);
    if (result.recordset.length === 0) {
      throw new ApiError('Receipt not found or already void.', 409);
    }
    const { bookingId, amountReceived } = result.recordset[0];

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
  getAdvanceReceipt,
  listAdvanceReceipts,
  listAdvanceReceiptsForBooking,
  voidAdvanceReceipt,
};
