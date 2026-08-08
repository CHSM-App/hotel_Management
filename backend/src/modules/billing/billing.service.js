const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');

function round2(n) {
  return Math.round(n * 100) / 100;
}

function nightCount(checkInDate, checkOutDate) {
  const start = new Date(`${checkInDate}T00:00:00Z`);
  const end = new Date(`${checkOutDate}T00:00:00Z`);
  return Math.round((end - start) / 86400000);
}

// Nightly rates behind a booking's total_price — from the frozen snapshot
// taken at booking time, or (for bookings created before that column
// existed) an even split of total_price across the stay.
function nightlyAmounts(booking) {
  if (booking.nightly_breakdown) {
    return JSON.parse(booking.nightly_breakdown).map((n) => Number(n.total));
  }
  const nights = nightCount(booking.check_in_date, booking.check_out_date);
  const even = round2(Number(booking.total_price) / nights);
  return Array.from({ length: nights }, () => even);
}

async function getGstSlabs(pool) {
  const result = await pool
    .request()
    .query('SELECT max_amount, rate_percent FROM dbo.gst_slabs WHERE is_active = 1 ORDER BY CASE WHEN max_amount IS NULL THEN 1 ELSE 0 END, max_amount ASC');
  return result.recordset.map((r) => ({
    maxAmount: r.max_amount == null ? null : Number(r.max_amount),
    ratePercent: Number(r.rate_percent),
  }));
}

function ratePercentFor(amount, slabs) {
  for (const slab of slabs) {
    if (slab.maxAmount == null || amount <= slab.maxAmount) return slab.ratePercent;
  }
  return 0;
}

// CGST/SGST computed per night on that night's actual rate (never the stay
// average), each half-rate rounded to 2dp before summing — computing total
// tax then halving produces paise mismatches that fail GSTR-1
// reconciliation. anyTaxable tracks whether any night is above the nil
// threshold, which decides tax invoice vs bill of supply.
function computeGstBreakdown(amounts, slabs) {
  let cgstAmount = 0;
  let sgstAmount = 0;
  let anyTaxable = false;
  for (const amount of amounts) {
    const ratePercent = ratePercentFor(amount, slabs);
    if (ratePercent > 0) anyTaxable = true;
    cgstAmount += round2(amount * (ratePercent / 100) / 2);
    sgstAmount += round2(amount * (ratePercent / 100) / 2);
  }
  return { cgstAmount: round2(cgstAmount), sgstAmount: round2(sgstAmount), anyTaxable };
}

async function loadBookingForBilling(lodgeId, bookingId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT b.*, r.room_number, c.name AS category_name,
             l.is_gst_registered, l.gstin
      FROM dbo.bookings b
      JOIN dbo.rooms r ON r.id = b.room_id
      JOIN dbo.room_categories c ON c.id = r.category_id
      JOIN dbo.lodges l ON l.id = b.lodge_id
      WHERE b.id = @bookingId AND b.lodge_id = @lodgeId
    `);
  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('Booking not found.', 404);
  }
  return row;
}

async function findActiveInvoice(request, bookingId) {
  const result = await request
    .input('bookingId', sql.BigInt, bookingId)
    .query("SELECT id FROM dbo.invoices WHERE booking_id = @bookingId AND status = 'ISSUED'");
  return result.recordset[0] || null;
}

// Reconstructs the rate that produced a tax amount, rather than threading a
// separate rate value through every call site — a stay can cross GST slabs
// night to night (season pricing), so there isn't always one true "the"
// rate. Backing it out of the amounts gives the correct blended rate in
// both the common single-slab case and the mixed one, and works identically
// for a live preview and a bill issued months ago, since it only needs
// numbers already being stored/returned anyway.
function ratePercentFromAmount(taxAmount, subtotal) {
  if (!subtotal) return 0;
  return round2((taxAmount / subtotal) * 100);
}

function buildBreakdown(subtotal, cgstAmount, sgstAmount, isGstSide) {
  const preRound = subtotal + cgstAmount + sgstAmount;
  const totalAmount = isGstSide ? Math.round(preRound) : round2(preRound);
  const roundOff = round2(totalAmount - preRound);
  return {
    subtotal: round2(subtotal),
    cgstAmount,
    sgstAmount,
    cgstRatePercent: ratePercentFromAmount(cgstAmount, subtotal),
    sgstRatePercent: ratePercentFromAmount(sgstAmount, subtotal),
    roundOff,
    totalAmount,
  };
}

async function listBillableBookings(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT b.id, b.guest_name, b.guest_phone, b.check_in_date, b.check_out_date,
             b.total_price, b.advance_amount, b.actual_check_out_at,
             r.room_number, c.name AS category_name
      FROM dbo.bookings b
      JOIN dbo.rooms r ON r.id = b.room_id
      JOIN dbo.room_categories c ON c.id = r.category_id
      WHERE b.lodge_id = @lodgeId AND b.status = 'CHECKED_OUT'
        AND NOT EXISTS (SELECT 1 FROM dbo.invoices i WHERE i.booking_id = b.id AND i.status = 'ISSUED')
      ORDER BY b.actual_check_out_at DESC
    `);
  return result.recordset.map((row) => ({
    id: row.id,
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    roomNumber: row.room_number,
    categoryName: row.category_name,
    checkInDate: row.check_in_date.toISOString().slice(0, 10),
    checkOutDate: row.check_out_date.toISOString().slice(0, 10),
    totalPrice: Number(row.total_price),
    advanceAmount: row.advance_amount != null ? Number(row.advance_amount) : null,
    actualCheckOutAt: row.actual_check_out_at,
  }));
}

async function previewBill(lodgeId, bookingId) {
  const pool = await getPool();
  const booking = await loadBookingForBilling(lodgeId, bookingId);

  if (booking.status !== 'CHECKED_OUT') {
    throw new ApiError('This booking must be checked out before it can be billed.', 409);
  }

  const active = await findActiveInvoice(pool.request(), bookingId);
  const amounts = nightlyAmounts(booking);
  const subtotal = round2(amounts.reduce((sum, n) => sum + n, 0));
  const slabs = await getGstSlabs(pool);
  const { cgstAmount, sgstAmount, anyTaxable } = computeGstBreakdown(amounts, slabs);

  const gst = booking.is_gst_registered
    ? {
        documentType: anyTaxable ? 'TAX_INVOICE' : 'BILL_OF_SUPPLY',
        ...buildBreakdown(subtotal, cgstAmount, sgstAmount, true),
      }
    : null;
  const nonGst = { documentType: 'CASH_RECEIPT', ...buildBreakdown(subtotal, 0, 0, false) };

  return {
    bookingId: booking.id,
    guestName: booking.guest_name,
    roomNumber: booking.room_number,
    categoryName: booking.category_name,
    nights: amounts.length,
    advancePaid: booking.advance_amount != null ? Number(booking.advance_amount) : 0,
    isGstRegistered: !!booking.is_gst_registered,
    gstin: booking.gstin,
    gst,
    nonGst,
    alreadyInvoiced: !!active,
  };
}

async function issueInvoice(lodgeId, userId, bookingId, input) {
  const pool = await getPool();
  const booking = await loadBookingForBilling(lodgeId, bookingId);

  if (booking.status !== 'CHECKED_OUT') {
    throw new ApiError('This booking must be checked out before it can be billed.', 409);
  }

  const billingSide = booking.is_gst_registered ? input.billingSide || 'GST' : 'NON_GST';

  const amounts = nightlyAmounts(booking);
  const subtotal = round2(amounts.reduce((sum, n) => sum + n, 0));
  const slabs = await getGstSlabs(pool);

  let documentType;
  let breakdown;
  if (billingSide === 'GST') {
    const { cgstAmount, sgstAmount, anyTaxable } = computeGstBreakdown(amounts, slabs);
    documentType = anyTaxable ? 'TAX_INVOICE' : 'BILL_OF_SUPPLY';
    breakdown = buildBreakdown(subtotal, cgstAmount, sgstAmount, true);
  } else {
    documentType = 'CASH_RECEIPT';
    breakdown = buildBreakdown(subtotal, 0, 0, false);
  }

  const advancePaid = booking.advance_amount != null ? Number(booking.advance_amount) : 0;

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const existing = await findActiveInvoice(new sql.Request(transaction), bookingId);
    if (existing) {
      throw new ApiError('This booking already has an issued bill. Void it before reissuing.', 409);
    }

    const seriesType = billingSide;
    const seriesResult = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('seriesType', sql.NVarChar, seriesType)
      .query('SELECT id FROM dbo.invoice_series WHERE lodge_id = @lodgeId AND series_type = @seriesType');
    if (seriesResult.recordset.length === 0) {
      await new sql.Request(transaction)
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('seriesType', sql.NVarChar, seriesType)
        .input('prefix', sql.NVarChar, seriesType === 'GST' ? 'INV-' : 'RCT-')
        .query('INSERT INTO dbo.invoice_series (lodge_id, series_type, prefix, next_number) VALUES (@lodgeId, @seriesType, @prefix, 1)');
    }

    const allocated = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('seriesType', sql.NVarChar, seriesType)
      .query(`
        UPDATE dbo.invoice_series
        SET next_number = next_number + 1
        OUTPUT deleted.next_number AS number, deleted.prefix AS prefix
        WHERE lodge_id = @lodgeId AND series_type = @seriesType
      `);
    const { number, prefix } = allocated.recordset[0];
    const invoiceNumber = `${prefix}${number}`;

    const inserted = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('bookingId', sql.BigInt, bookingId)
      .input('documentType', sql.NVarChar, documentType)
      .input('billingSide', sql.NVarChar, billingSide)
      .input('invoiceNumber', sql.NVarChar, invoiceNumber)
      .input('roomSubtotal', sql.Decimal(10, 2), breakdown.subtotal)
      .input('cgstAmount', sql.Decimal(10, 2), breakdown.cgstAmount)
      .input('sgstAmount', sql.Decimal(10, 2), breakdown.sgstAmount)
      .input('roundOff', sql.Decimal(10, 2), breakdown.roundOff)
      .input('totalAmount', sql.Decimal(10, 2), breakdown.totalAmount)
      .input('advancePaid', sql.Decimal(10, 2), advancePaid)
      .input('balanceCollected', sql.Decimal(10, 2), input.collectedAmount ?? 0)
      .input('balancePaymentMethod', sql.NVarChar, input.paymentMethod ?? null)
      .input('createdBy', sql.BigInt, userId ?? null)
      .query(`
        INSERT INTO dbo.invoices
          (lodge_id, booking_id, document_type, billing_side, invoice_number, room_subtotal,
           cgst_amount, sgst_amount, round_off, total_amount, advance_paid, balance_collected,
           balance_payment_method, created_by)
        OUTPUT inserted.id
        VALUES
          (@lodgeId, @bookingId, @documentType, @billingSide, @invoiceNumber, @roomSubtotal,
           @cgstAmount, @sgstAmount, @roundOff, @totalAmount, @advancePaid, @balanceCollected,
           @balancePaymentMethod, @createdBy)
      `);

    await transaction.commit();
    return getInvoice(lodgeId, inserted.recordset[0].id);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

function mapInvoice(row) {
  return {
    id: row.id,
    bookingId: row.booking_id,
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    numGuests: row.num_guests,
    roomNumber: row.room_number,
    categoryName: row.category_name,
    checkInDate: row.check_in_date.toISOString().slice(0, 10),
    checkOutDate: row.check_out_date.toISOString().slice(0, 10),
    actualCheckInAt: row.actual_check_in_at,
    actualCheckOutAt: row.actual_check_out_at,
    documentType: row.document_type,
    billingSide: row.billing_side,
    invoiceNumber: row.invoice_number,
    roomSubtotal: Number(row.room_subtotal),
    cgstAmount: Number(row.cgst_amount),
    sgstAmount: Number(row.sgst_amount),
    cgstRatePercent: ratePercentFromAmount(Number(row.cgst_amount), Number(row.room_subtotal)),
    sgstRatePercent: ratePercentFromAmount(Number(row.sgst_amount), Number(row.room_subtotal)),
    roundOff: Number(row.round_off),
    totalAmount: Number(row.total_amount),
    advancePaid: Number(row.advance_paid),
    balanceCollected: Number(row.balance_collected),
    balancePaymentMethod: row.balance_payment_method,
    status: row.status,
    voidReason: row.void_reason,
    voidedAt: row.voided_at,
    createdAt: row.created_at,
    gstin: row.gstin,
    isGstRegistered: !!row.is_gst_registered,
    lodgeName: row.lodge_name,
    lodgePhone: row.lodge_phone,
    lodgeAddress: row.lodge_address,
    lodgeCity: row.lodge_city,
    lodgeState: row.lodge_state,
  };
}

async function getInvoice(lodgeId, invoiceId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('invoiceId', sql.BigInt, invoiceId)
    .query(`
      SELECT i.*, b.guest_name, b.guest_phone, b.num_guests, b.check_in_date, b.check_out_date,
             b.actual_check_in_at, b.actual_check_out_at,
             r.room_number, c.name AS category_name,
             l.gstin, l.is_gst_registered, l.name AS lodge_name,
             l.phone AS lodge_phone, l.address AS lodge_address, l.city AS lodge_city, l.state AS lodge_state
      FROM dbo.invoices i
      JOIN dbo.bookings b ON b.id = i.booking_id
      JOIN dbo.rooms r ON r.id = b.room_id
      JOIN dbo.room_categories c ON c.id = r.category_id
      JOIN dbo.lodges l ON l.id = i.lodge_id
      WHERE i.id = @invoiceId AND i.lodge_id = @lodgeId
    `);
  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('Bill not found.', 404);
  }
  return mapInvoice(row);
}

async function listInvoices(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT TOP 200 i.*, b.guest_name, b.guest_phone, b.num_guests, b.check_in_date, b.check_out_date,
             b.actual_check_in_at, b.actual_check_out_at,
             r.room_number, c.name AS category_name,
             l.gstin, l.is_gst_registered, l.name AS lodge_name,
             l.phone AS lodge_phone, l.address AS lodge_address, l.city AS lodge_city, l.state AS lodge_state
      FROM dbo.invoices i
      JOIN dbo.bookings b ON b.id = i.booking_id
      JOIN dbo.rooms r ON r.id = b.room_id
      JOIN dbo.room_categories c ON c.id = r.category_id
      JOIN dbo.lodges l ON l.id = i.lodge_id
      WHERE i.lodge_id = @lodgeId
      ORDER BY i.created_at DESC
    `);
  return result.recordset.map(mapInvoice);
}

async function voidInvoice(lodgeId, invoiceId, reason) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('invoiceId', sql.BigInt, invoiceId)
    .input('reason', sql.NVarChar, reason)
    .query(`
      UPDATE dbo.invoices
      SET status = 'VOID', void_reason = @reason, voided_at = SYSDATETIMEOFFSET()
      OUTPUT inserted.id
      WHERE id = @invoiceId AND lodge_id = @lodgeId AND status = 'ISSUED'
    `);
  if (result.recordset.length === 0) {
    throw new ApiError('Bill not found or already void.', 409);
  }
  return getInvoice(lodgeId, invoiceId);
}

module.exports = {
  listBillableBookings,
  previewBill,
  issueInvoice,
  getInvoice,
  listInvoices,
  voidInvoice,
};
