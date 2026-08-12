const { getPool, sql } = require('../../config/connection');

function round2(n) {
  return Math.round(n * 100) / 100;
}

function toIsoDate(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

// Inclusive of both ends — a report for "1 Aug to 3 Aug" covers all three
// calendar days, matching how an owner reads a date-range picker.
function datesInRange(fromDate, toDate) {
  const dates = [];
  const cur = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

// Occupied nights only count stays that actually happened — CHECKED_IN
// (in progress) or CHECKED_OUT (completed). A BOOKED reservation that
// never arrived, or a CANCELLED one, never occupied the room.
async function getOccupancyReport(lodgeId, fromDate, toDate) {
  const pool = await getPool();

  const roomsResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query('SELECT COUNT(*) AS total FROM dbo.rooms WHERE lodge_id = @lodgeId AND is_active = 1');
  const totalRooms = roomsResult.recordset[0].total;

  const bookingsResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('fromDate', sql.Date, fromDate)
    .input('toDate', sql.Date, toDate)
    .query(`
      SELECT room_id, check_in_date, check_out_date
      FROM dbo.bookings
      WHERE lodge_id = @lodgeId AND status IN ('CHECKED_IN', 'CHECKED_OUT')
        AND check_in_date < DATEADD(day, 1, @toDate) AND check_out_date > @fromDate
    `);

  const dates = datesInRange(fromDate, toDate);
  const occupiedByDate = new Map(dates.map((d) => [d, new Set()]));

  for (const row of bookingsResult.recordset) {
    const stayStart = toIsoDate(row.check_in_date);
    const stayEnd = toIsoDate(row.check_out_date);
    for (const date of dates) {
      if (date >= stayStart && date < stayEnd) {
        occupiedByDate.get(date).add(row.room_id);
      }
    }
  }

  const days = dates.map((date) => {
    const occupiedRooms = occupiedByDate.get(date).size;
    return {
      date,
      occupiedRooms,
      totalRooms,
      occupancyPercent: totalRooms > 0 ? round2((occupiedRooms / totalRooms) * 100) : 0,
    };
  });

  const occupiedRoomNights = days.reduce((sum, d) => sum + d.occupiedRooms, 0);
  const totalRoomNights = totalRooms * dates.length;

  return {
    fromDate,
    toDate,
    totalRooms,
    days,
    summary: {
      occupiedRoomNights,
      totalRoomNights,
      occupancyPercent: totalRoomNights > 0 ? round2((occupiedRoomNights / totalRoomNights) * 100) : 0,
    },
  };
}

function emptyTotals() {
  return { count: 0, roomSubtotal: 0, cgstAmount: 0, sgstAmount: 0, totalAmount: 0 };
}

function addToTotals(totals, invoice) {
  totals.count += 1;
  totals.roomSubtotal = round2(totals.roomSubtotal + invoice.roomSubtotal);
  totals.cgstAmount = round2(totals.cgstAmount + invoice.cgstAmount);
  totals.sgstAmount = round2(totals.sgstAmount + invoice.sgstAmount);
  totals.totalAmount = round2(totals.totalAmount + invoice.totalAmount);
}

// A GST filing summary, not a GSTR-1 export — invoice-wise totals grouped
// by document type, the shape a lodge owner (or their CA) needs to fill in
// the actual return. Void bills are excluded; they carry no tax liability.
async function getGstSummary(lodgeId, fromDate, toDate) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('fromDate', sql.Date, fromDate)
    .input('toDate', sql.Date, toDate)
    .query(`
      SELECT i.id, i.document_type, i.billing_side, i.invoice_number, i.room_subtotal,
             i.cgst_amount, i.sgst_amount, i.round_off, i.total_amount, i.created_at,
             b.guest_name
      FROM dbo.invoices i
      JOIN dbo.bookings b ON b.id = i.booking_id
      WHERE i.lodge_id = @lodgeId AND i.status = 'ISSUED'
        AND CAST(i.created_at AS DATE) BETWEEN @fromDate AND @toDate
      ORDER BY i.created_at ASC
    `);

  const invoices = result.recordset.map((row) => ({
    id: row.id,
    invoiceNumber: row.invoice_number,
    documentType: row.document_type,
    billingSide: row.billing_side,
    guestName: row.guest_name,
    roomSubtotal: Number(row.room_subtotal),
    cgstAmount: Number(row.cgst_amount),
    sgstAmount: Number(row.sgst_amount),
    roundOff: Number(row.round_off),
    totalAmount: Number(row.total_amount),
    createdAt: row.created_at,
  }));

  const totals = emptyTotals();
  const byDocumentType = {};

  for (const invoice of invoices) {
    addToTotals(totals, invoice);
    if (!byDocumentType[invoice.documentType]) {
      byDocumentType[invoice.documentType] = emptyTotals();
    }
    addToTotals(byDocumentType[invoice.documentType], invoice);
  }

  return { fromDate, toDate, totals, byDocumentType, invoices };
}

const BOOKING_STATUSES = ['BOOKED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'];
// Mirrors ck_bookings_payment_method / ck_invoices_payment_method.
const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD'];

// A booking belongs to the period it *arrives* in — check_in_date inside the
// range — not every period its stay touches. That's the only reading under
// which a stay is counted once and the twelve monthly reports for a year add
// up to the year's total; the guest register's overlap rule answers a
// different question ("who was here on this date").
async function getBookingsReport(lodgeId, fromDate, toDate) {
  const pool = await getPool();

  const lodgeResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query('SELECT name, gstin, is_gst_registered FROM dbo.lodges WHERE id = @lodgeId');

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('fromDate', sql.Date, fromDate)
    .input('toDate', sql.Date, toDate)
    .query(`
      SELECT b.id, b.guest_name, b.guest_phone, b.num_guests, b.status,
             b.check_in_date, b.check_out_date,
             DATEDIFF(day, b.check_in_date, b.check_out_date) AS nights,
             b.total_price, b.advance_amount, b.advance_payment_method, b.created_at,
             r.room_number, c.name AS category_name,
             i.invoice_number, i.document_type, i.billing_side,
             i.room_subtotal, i.food_subtotal,
             i.cgst_amount, i.sgst_amount, i.food_cgst_amount, i.food_sgst_amount,
             i.round_off, i.total_amount AS invoice_total,
             i.advance_paid, i.balance_collected, i.balance_payment_method
      FROM dbo.bookings b
      JOIN dbo.rooms r ON r.id = b.room_id
      JOIN dbo.room_categories c ON c.id = r.category_id
      OUTER APPLY (
        SELECT TOP 1 invoice_number, document_type, billing_side, room_subtotal, food_subtotal,
               cgst_amount, sgst_amount, food_cgst_amount, food_sgst_amount, round_off,
               total_amount, advance_paid, balance_collected, balance_payment_method
        FROM dbo.invoices
        WHERE booking_id = b.id AND status = 'ISSUED'
        ORDER BY created_at DESC
      ) i
      WHERE b.lodge_id = @lodgeId
        AND b.check_in_date BETWEEN @fromDate AND @toDate
      ORDER BY b.check_in_date ASC, r.room_number ASC
    `);

  const bookings = result.recordset.map((row) => ({
    id: row.id,
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    numGuests: row.num_guests,
    roomNumber: row.room_number,
    categoryName: row.category_name,
    checkInDate: toIsoDate(row.check_in_date),
    checkOutDate: toIsoDate(row.check_out_date),
    nights: row.nights,
    status: row.status,
    totalPrice: Number(row.total_price),
    advanceAmount: row.advance_amount != null ? Number(row.advance_amount) : 0,
    advancePaymentMethod: row.advance_payment_method || null,
    invoiceNumber: row.invoice_number || null,
    documentType: row.document_type || null,
    billingSide: row.billing_side || null,
    roomSubtotal: row.room_subtotal != null ? Number(row.room_subtotal) : null,
    foodSubtotal: row.food_subtotal != null ? Number(row.food_subtotal) : null,
    // Room and food are taxed on separate SACs at separate rates. The report
    // shows what the guest was actually charged — the two added together — but
    // keeps the halves so the tax summary can break them out for filing.
    roomCgst: row.cgst_amount != null ? Number(row.cgst_amount) : null,
    roomSgst: row.sgst_amount != null ? Number(row.sgst_amount) : null,
    foodCgst: row.food_cgst_amount != null ? Number(row.food_cgst_amount) : null,
    foodSgst: row.food_sgst_amount != null ? Number(row.food_sgst_amount) : null,
    cgstAmount:
      row.invoice_number != null ? round2(Number(row.cgst_amount || 0) + Number(row.food_cgst_amount || 0)) : null,
    sgstAmount:
      row.invoice_number != null ? round2(Number(row.sgst_amount || 0) + Number(row.food_sgst_amount || 0)) : null,
    roundOff: row.round_off != null ? Number(row.round_off) : null,
    billedAmount: row.invoice_total != null ? Number(row.invoice_total) : null,
    advancePaid: row.advance_paid != null ? Number(row.advance_paid) : null,
    balanceCollected: row.balance_collected != null ? Number(row.balance_collected) : null,
    balancePaymentMethod: row.balance_payment_method || null,
    createdAt: row.created_at,
  }));

  const byStatus = Object.fromEntries(BOOKING_STATUSES.map((s) => [s, 0]));
  const byPaymentMode = Object.fromEntries(
    [...PAYMENT_METHODS, 'UNRECORDED'].map((m) => [m, { advance: 0, balance: 0, total: 0 }])
  );
  const summary = {
    totalBookings: bookings.length,
    roomNights: 0,
    // What the stays were priced at, versus what an issued bill actually
    // charged. They diverge whenever a bill is still pending, so an owner
    // reading only one of the two would draw the wrong conclusion.
    bookedValue: 0,
    billedAmount: 0,
    billedCount: 0,
    advanceCollected: 0,
    balanceCollected: 0,
  };
  const tax = {
    roomSubtotal: 0,
    foodSubtotal: 0,
    roomCgst: 0,
    roomSgst: 0,
    foodCgst: 0,
    foodSgst: 0,
    cgstAmount: 0,
    sgstAmount: 0,
    roundOff: 0,
    totalAmount: 0,
  };

  // A payment with no method recorded still moved money, so it is bucketed
  // rather than dropped — a silent omission would make the mode breakdown
  // disagree with the totals above it.
  const addPayment = (method, kind, amount) => {
    if (!amount) return;
    const key = PAYMENT_METHODS.includes(method) ? method : 'UNRECORDED';
    byPaymentMode[key][kind] = round2(byPaymentMode[key][kind] + amount);
    byPaymentMode[key].total = round2(byPaymentMode[key].total + amount);
  };

  for (const booking of bookings) {
    if (byStatus[booking.status] === undefined) byStatus[booking.status] = 0;
    byStatus[booking.status] += 1;

    if (booking.status !== 'CANCELLED') {
      summary.roomNights += booking.nights;
      summary.bookedValue = round2(summary.bookedValue + booking.totalPrice);
      summary.advanceCollected = round2(summary.advanceCollected + booking.advanceAmount);
      addPayment(booking.advancePaymentMethod, 'advance', booking.advanceAmount);
    }

    if (booking.billedAmount != null) {
      summary.billedCount += 1;
      summary.billedAmount = round2(summary.billedAmount + booking.billedAmount);
      summary.balanceCollected = round2(summary.balanceCollected + (booking.balanceCollected || 0));
      addPayment(booking.balancePaymentMethod, 'balance', booking.balanceCollected || 0);

      tax.roomSubtotal = round2(tax.roomSubtotal + (booking.roomSubtotal || 0));
      tax.foodSubtotal = round2(tax.foodSubtotal + (booking.foodSubtotal || 0));
      tax.roomCgst = round2(tax.roomCgst + (booking.roomCgst || 0));
      tax.roomSgst = round2(tax.roomSgst + (booking.roomSgst || 0));
      tax.foodCgst = round2(tax.foodCgst + (booking.foodCgst || 0));
      tax.foodSgst = round2(tax.foodSgst + (booking.foodSgst || 0));
      tax.cgstAmount = round2(tax.cgstAmount + booking.cgstAmount);
      tax.sgstAmount = round2(tax.sgstAmount + booking.sgstAmount);
      tax.roundOff = round2(tax.roundOff + (booking.roundOff || 0));
      tax.totalAmount = round2(tax.totalAmount + booking.billedAmount);
    }
  }

  summary.totalCollected = round2(summary.advanceCollected + summary.balanceCollected);

  return {
    fromDate,
    toDate,
    generatedAt: new Date().toISOString(),
    lodgeName: lodgeResult.recordset[0]?.name || '',
    gstin: lodgeResult.recordset[0]?.is_gst_registered ? lodgeResult.recordset[0]?.gstin || null : null,
    summary: { ...summary, byStatus, byPaymentMode, tax },
    bookings,
  };
}

module.exports = { getOccupancyReport, getGstSummary, getBookingsReport };
