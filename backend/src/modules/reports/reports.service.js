const { getPool, sql } = require('../../config/connection');

function round2(n) {
  return Math.round(n * 100) / 100;
}

// BigInt keys arrive as number or string depending on the driver's mood, so
// they are stringified on both sides of the Map.
function linesByParent(result) {
  const map = new Map();
  for (const row of result.recordset) {
    const key = String(row.parent_id);
    const list = map.get(key) ?? [];
    list.push({ method: row.method, amount: Number(row.amount) });
    map.set(key, list);
  }
  return map;
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

// Attributes one payment across the ways it arrived.
//
// The amount is the authority, never the lines. It comes from
// bookings.advance_amount or invoices.balance_collected — the columns this
// report has always summed — and the parts returned here add up to it exactly
// whatever the lines say. That is the whole guarantee that adding split
// payments cannot move a total in a month somebody has already reconciled.
//
// Lines are therefore clamped rather than trusted. bookings.advance_amount has
// five writers (booking create, check-in top-up, an edit that sets an arbitrary
// value, receipt issue, and a void that floors it to NULL), so a booking can
// genuinely hold less than its issued receipts add up to — three do right now.
// A JOIN that assumed sum(lines) === amount would be a money bug waiting on the
// first booking edit.
//
// Whatever the lines do not cover goes to the fallback method. That remainder
// is money taken before payment lines existed, and the scalar column is the
// only record of how it arrived — which is exactly why issueAdvanceReceipt
// refuses to overwrite that column on a split.
function splitAcross(amount, lines, fallbackMethod) {
  const parts = [];
  let left = amount;
  for (const line of lines ?? []) {
    const take = Math.min(Number(line.amount), left);
    if (take > 0) {
      parts.push({ method: line.method, amount: round2(take) });
      left = round2(left - take);
    }
  }
  if (left > 0) parts.push({ method: fallbackMethod, amount: left });
  return parts;
}

const BOOKING_STATUSES = ['BOOKED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'];
// Mirrors ck_bookings_payment_method / ck_invoices_payment_method.
const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD'];

// Money actually taken in the period, on a cash basis — which is a different
// question to the booking register's, and needs its own two queries.
//
// The register lists stays by check-in date. Collections cannot use that date:
// an advance taken in September for an October stay is September's money, and
// keying it to check-in reports it a month late. So each half is dated by when
// it moved. An advance is always taken at booking time (there is no later
// top-up), which is what makes bookings.created_at a faithful payment date and
// what lets this work without a payment-date column. A balance moves when the
// bill is issued, so it is dated by the invoice.
//
// The two halves therefore cover different sets of bookings, and neither need
// match the register on screen — that is the point of a cash-basis figure, and
// the report labels it as such rather than pretending it reconciles.
async function getCollectionsInPeriod(pool, lodgeId, fromDate, toDate) {
  const byPaymentMode = Object.fromEntries(
    [...PAYMENT_METHODS, 'UNRECORDED'].map((m) => [m, { advance: 0, balance: 0, total: 0 }])
  );
  const add = (method, kind, amount) => {
    if (!amount) return;
    const key = PAYMENT_METHODS.includes(method) ? method : 'UNRECORDED';
    byPaymentMode[key][kind] = round2(byPaymentMode[key][kind] + amount);
    byPaymentMode[key].total = round2(byPaymentMode[key].total + amount);
  };

  // Cancelled stays are excluded from both halves. Whether an advance on one was
  // refunded is not recorded anywhere, so counting it as income would overstate
  // takings on exactly the stays that produced none. The report says so on the
  // page rather than leaving an owner to wonder why a cancelled booking's
  // advance is missing from the totals.
  const advances = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('fromDate', sql.Date, fromDate)
    .input('toDate', sql.Date, toDate)
    .query(`
      SELECT b.id, b.advance_amount, b.advance_payment_method,
             CASE
               WHEN b.check_in_date < @fromDate THEN 'EARLIER'
               WHEN b.check_in_date > @toDate THEN 'LATER'
               ELSE 'THIS'
             END AS stay_period
      FROM dbo.bookings b
      WHERE b.lodge_id = @lodgeId
        AND b.status <> 'CANCELLED'
        AND b.advance_amount > 0
        AND CAST(b.created_at AS DATE) BETWEEN @fromDate AND @toDate
    `);

  const balances = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('fromDate', sql.Date, fromDate)
    .input('toDate', sql.Date, toDate)
    .query(`
      SELECT i.id, i.balance_collected, i.balance_payment_method,
             CASE
               WHEN b.check_in_date < @fromDate THEN 'EARLIER'
               WHEN b.check_in_date > @toDate THEN 'LATER'
               ELSE 'THIS'
             END AS stay_period
      FROM dbo.invoices i
      JOIN dbo.bookings b ON b.id = i.booking_id
      WHERE i.lodge_id = @lodgeId
        AND i.status = 'ISSUED'
        AND b.status <> 'CANCELLED'
        AND i.balance_collected > 0
        AND CAST(i.created_at AS DATE) BETWEEN @fromDate AND @toDate
    `);

  // The lines behind those two figures, over exactly the same filtered sets —
  // separate queries rather than a JOIN so no booking or invoice row is
  // multiplied, which would inflate advanceCount, balanceCount and byStayPeriod.
  //
  // Grouped by method, so two cards on one bill report as one CARD figure.
  // Ordered by the first line's id, so the clamp above spends the earliest
  // tender first and gives the same answer every run.
  const advanceLines = linesByParent(
    await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('fromDate', sql.Date, fromDate)
      .input('toDate', sql.Date, toDate)
      .query(`
        SELECT ar.booking_id AS parent_id, pl.method, SUM(pl.amount) AS amount
        FROM dbo.payment_lines pl
        JOIN dbo.advance_receipts ar ON ar.id = pl.advance_receipt_id
        JOIN dbo.bookings b ON b.id = ar.booking_id
        WHERE pl.lodge_id = @lodgeId
          AND ar.lodge_id = @lodgeId
          AND b.lodge_id = @lodgeId
          AND ar.status = 'ISSUED'
          AND b.status <> 'CANCELLED'
          AND b.advance_amount > 0
          AND CAST(b.created_at AS DATE) BETWEEN @fromDate AND @toDate
        GROUP BY ar.booking_id, pl.method
        ORDER BY ar.booking_id, MIN(pl.id)
      `)
  );

  const balanceLines = linesByParent(
    await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('fromDate', sql.Date, fromDate)
      .input('toDate', sql.Date, toDate)
      .query(`
        SELECT pl.invoice_id AS parent_id, pl.method, SUM(pl.amount) AS amount
        FROM dbo.payment_lines pl
        JOIN dbo.invoices i ON i.id = pl.invoice_id
        JOIN dbo.bookings b ON b.id = i.booking_id
        WHERE pl.lodge_id = @lodgeId
          AND i.lodge_id = @lodgeId
          AND b.lodge_id = @lodgeId
          AND i.status = 'ISSUED'
          AND b.status <> 'CANCELLED'
          AND i.balance_collected > 0
          AND CAST(i.created_at AS DATE) BETWEEN @fromDate AND @toDate
        GROUP BY pl.invoice_id, pl.method
        ORDER BY pl.invoice_id, MIN(pl.id)
      `)
  );

  // Each payment is also filed by *which* stay it was for, relative to the
  // period being reported. That is the breakdown that answers "how much of
  // this month's takings is for this month, and how much is for later" —
  // without it a single advances figure hides money that is really next
  // month's business, which is exactly what looks like a mismatch.
  const bucket = () => ({ advance: 0, balance: 0, total: 0, count: 0 });
  const byStayPeriod = { EARLIER: bucket(), THIS: bucket(), LATER: bucket() };
  const file = (row, kind, amount) => {
    const b = byStayPeriod[row.stay_period] || byStayPeriod.THIS;
    b[kind] = round2(b[kind] + amount);
    b.total = round2(b.total + amount);
    b.count += 1;
  };

  let advanceCollected = 0;
  for (const row of advances.recordset) {
    const amount = Number(row.advance_amount);
    advanceCollected = round2(advanceCollected + amount);
    for (const part of splitAcross(amount, advanceLines.get(String(row.id)), row.advance_payment_method)) {
      add(part.method, 'advance', part.amount);
    }
    file(row, 'advance', amount);
  }

  let balanceCollected = 0;
  for (const row of balances.recordset) {
    const amount = Number(row.balance_collected);
    balanceCollected = round2(balanceCollected + amount);
    for (const part of splitAcross(amount, balanceLines.get(String(row.id)), row.balance_payment_method)) {
      add(part.method, 'balance', part.amount);
    }
    file(row, 'balance', amount);
  }

  return {
    advanceCollected,
    advanceCount: advances.recordset.length,
    balanceCollected,
    balanceCount: balances.recordset.length,
    totalCollected: round2(advanceCollected + balanceCollected),
    byPaymentMode,
    byStayPeriod,
  };
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

// A booking belongs to the period it *arrives* in — check_in_date inside the
// range — not every period its stay touches. That's the only reading under
// which a stay is counted once and the twelve monthly reports for a year add
// up to the year's total; the guest register's overlap rule answers a
// different question ("who was here on this date").
async function getBookingsReport(lodgeId, fromDate, toDate, billingSide = 'ALL') {
  const pool = await getPool();

  const lodgeResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query('SELECT name, gstin, is_gst_registered, serves_food FROM dbo.lodges WHERE id = @lodgeId');

  // Filtering on the bill's side necessarily drops stays that carry no bill at
  // all — i.billing_side is NULL for them, so they match neither GST nor
  // NON_GST. That is the intent: asked for "GST bills", an owner means the
  // bills, not the bookings that have yet to produce one.
  const billingFilter =
    billingSide === 'ALL' ? '' : 'AND i.billing_side = @billingSide';

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('fromDate', sql.Date, fromDate)
    .input('toDate', sql.Date, toDate)
    .input('billingSide', sql.NVarChar, billingSide)
    .query(`
      SELECT b.id, b.guest_name, b.guest_phone, b.num_guests, b.status,
             b.check_in_date, b.check_out_date,
             DATEDIFF(day, b.check_in_date, b.check_out_date) AS nights,
             b.actual_check_in_at, b.actual_check_out_at,
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
        ${billingFilter}
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
    // When the guest actually arrived and left, as against the dates the stay
    // was booked for. Null until it happens — a BOOKED reservation has neither,
    // and a late checkout can land these on a different date to the booked one.
    actualCheckInAt: row.actual_check_in_at || null,
    actualCheckOutAt: row.actual_check_out_at || null,
    totalPrice: Number(row.total_price),
    advanceAmount: row.advance_amount != null ? Number(row.advance_amount) : 0,
    advancePaymentMethod: row.advance_payment_method || null,
    invoiceNumber: row.invoice_number || null,
    documentType: row.document_type || null,
    billingSide: row.billing_side || null,
    roomSubtotal: row.room_subtotal != null ? Number(row.room_subtotal) : null,
    foodSubtotal: row.food_subtotal != null ? Number(row.food_subtotal) : null,
    // What the bill was taxed on, before CGST/SGST were added — rooms and food
    // together, since both are taxable supplies on the same document.
    subtotal:
      row.invoice_number != null
        ? round2(Number(row.room_subtotal || 0) + Number(row.food_subtotal || 0))
        : null,
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
  // What cancelled stays would have added, kept aside rather than discarded so
  // the report can name the figure it is leaving out. A number an owner can see
  // and dismiss is very different from one that silently went missing.
  const cancelled = { count: 0, bookedValue: 0, advanceHeld: 0 };
  const summary = {
    totalBookings: bookings.length,
    roomNights: 0,
    // What the stays were priced at, versus what an issued bill actually
    // charged. They diverge whenever a bill is still pending, so an owner
    // reading only one of the two would draw the wrong conclusion.
    bookedValue: 0,
    billedAmount: 0,
    billedCount: 0,
    // Money attached to the stays listed in this register — i.e. keyed to
    // check-in date, so an advance for one of these stays may well have been
    // taken in an earlier period. These reconcile with the rows on the page.
    // What was actually banked in the period is `collections` below, which is
    // dated by when each payment moved and deliberately does not match these.
    stayAdvance: 0,
    stayBalance: 0,
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

  for (const booking of bookings) {
    if (byStatus[booking.status] === undefined) byStatus[booking.status] = 0;
    byStatus[booking.status] += 1;

    if (booking.status === 'CANCELLED') {
      cancelled.count += 1;
      cancelled.bookedValue = round2(cancelled.bookedValue + booking.totalPrice);
      cancelled.advanceHeld = round2(cancelled.advanceHeld + booking.advanceAmount);
    } else {
      summary.roomNights += booking.nights;
      summary.bookedValue = round2(summary.bookedValue + booking.totalPrice);
      summary.stayAdvance = round2(summary.stayAdvance + booking.advanceAmount);
    }

    if (booking.billedAmount != null) {
      summary.billedCount += 1;
      summary.billedAmount = round2(summary.billedAmount + booking.billedAmount);
      summary.stayBalance = round2(summary.stayBalance + (booking.balanceCollected || 0));

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

  summary.stayTotal = round2(summary.stayAdvance + summary.stayBalance);
  summary.cancelled = cancelled;

  // Cash basis, dated by when the money moved rather than by check-in. This is
  // the answer to "what did we take this month"; the stay* figures above answer
  // "what is attached to the stays on this page". They are not expected to
  // agree, and the report prints them under separate headings for that reason.
  const collections = await getCollectionsInPeriod(pool, lodgeId, fromDate, toDate);
  summary.advanceCollected = collections.advanceCollected;
  summary.balanceCollected = collections.balanceCollected;
  summary.totalCollected = collections.totalCollected;
  // The taxable value the period's CGST/SGST was charged on — derived here so
  // the register's subtotal column and the tax table's total cannot drift.
  tax.taxableValue = round2(tax.roomSubtotal + tax.foodSubtotal);

  return {
    fromDate,
    toDate,
    billingSide,
    generatedAt: new Date().toISOString(),
    lodgeName: lodgeResult.recordset[0]?.name || '',
    // A rooms-only lodge has no food supply, so the report drops the food
    // columns entirely rather than printing a column of zeroes.
    servesFood: Boolean(lodgeResult.recordset[0]?.serves_food),
    gstin: lodgeResult.recordset[0]?.is_gst_registered ? lodgeResult.recordset[0]?.gstin || null : null,
    summary: {
      ...summary,
      byStatus,
      // The mode breakdown belongs to the collections figures it is printed
      // under, so it is dated on the same cash basis and adds up to them.
      byPaymentMode: collections.byPaymentMode,
      collections,
      tax,
    },
    bookings,
  };
}

module.exports = { getOccupancyReport, getGstSummary, getBookingsReport, splitAcross };
