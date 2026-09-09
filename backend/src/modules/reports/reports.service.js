const { getPool, sql } = require('../../config/connection');
const { netOfDiscount } = require('../billing/billing.service');

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
// The amount is the authority, never the lines. It comes from the money column
// this report has always summed — and the parts returned here add up to it
// exactly whatever the lines say. That is the whole guarantee that adding split
// payments cannot move a total in a month somebody has already reconciled.
//
// Lines are therefore clamped rather than trusted. bookings.advance_amount has
// five writers (booking create, a receipt top-up, an edit that sets an
// arbitrary value, receipt issue, and a void that reduces it), so a booking can
// genuinely hold less than its issued receipts add up to. A JOIN that assumed
// sum(lines) === amount would be a money bug waiting on the first booking edit.
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
// Mirrors ck_invoices_document_type.
const DOCUMENT_TYPES = ['TAX_INVOICE', 'BILL_OF_SUPPLY', 'CASH_RECEIPT'];

// Two payments are combined per method — two cards on one bill report as one
// CARD figure — and returned in a stable order so a document reads the same
// on every run.
function mergeTenders(parts) {
  const byMethod = new Map();
  for (const part of parts) {
    const key = PAYMENT_METHODS.includes(part.method) ? part.method : 'UNRECORDED';
    byMethod.set(key, round2((byMethod.get(key) ?? 0) + part.amount));
  }
  return [...PAYMENT_METHODS, 'UNRECORDED']
    .filter((m) => byMethod.has(m))
    .map((method) => ({ method, amount: byMethod.get(method) }));
}

// The figures a bill states, derived from its stored columns exactly the way
// the printed document derives them — so the register row and the bill in the
// guest's hand can never disagree.
//
// Every price in this system is GST-inclusive. room_subtotal and food_subtotal
// are the gross (what was sold, tax inside, before any discount); the discount
// is stored once for the whole bill and was apportioned across the two supplies
// when the tax was computed. The taxable value is therefore what is left of the
// discounted gross once the tax inside it comes out — never the gross itself,
// which would overstate the taxable value by exactly the tax.
//
// The identity every reader can check on the page:
//   gross − discount = net;  net − CGST − SGST = taxable;
//   taxable + CGST + SGST + round off = billed total.
function billFigures(row) {
  const roomGross = Number(row.room_subtotal);
  const foodGross = Number(row.food_subtotal ?? 0);
  const roomCgst = Number(row.cgst_amount ?? 0);
  const roomSgst = Number(row.sgst_amount ?? 0);
  const foodCgst = Number(row.food_cgst_amount ?? 0);
  const foodSgst = Number(row.food_sgst_amount ?? 0);
  const discountAmount = Number(row.discount_amount ?? 0);
  const grossAmount = round2(roomGross + foodGross);
  const [roomNetOfDiscount, foodNetOfDiscount] = netOfDiscount(
    [roomGross, foodGross],
    discountAmount,
    grossAmount
  );
  const roomTaxable = round2(roomNetOfDiscount - roomCgst - roomSgst);
  const foodTaxable = round2(foodNetOfDiscount - foodCgst - foodSgst);
  return {
    grossAmount,
    roomGross,
    foodGross,
    discountAmount,
    netAmount: round2(grossAmount - discountAmount),
    lateCheckoutCharge: Number(row.late_checkout_charge ?? 0),
    roomTaxable,
    foodTaxable,
    taxableValue: round2(roomTaxable + foodTaxable),
    roomCgst,
    roomSgst,
    foodCgst,
    foodSgst,
    cgstAmount: round2(roomCgst + foodCgst),
    sgstAmount: round2(roomSgst + foodSgst),
    totalTax: round2(roomCgst + foodCgst + roomSgst + foodSgst),
    roundOff: Number(row.round_off ?? 0),
    billedAmount: Number(row.total_amount),
  };
}

// Money actually taken in the period, on a cash basis — which is a different
// question to the booking register's, and needs its own queries.
//
// The register lists stays by check-in date. Collections cannot use that date:
// an advance taken in September for an October stay is September's money, and
// keying it to check-in reports it a month late. So each payment is dated by
// when it moved:
//
//   - an advance by the receipt that acknowledged it. A booking can take more
//     than one (a top-up before arrival), each on its own date, so the booking's
//     single advance_amount cannot date them. Money on a booking that no receipt
//     covers — advances taken before receipts existed — falls back to the
//     booking's creation date, the only date there is for it;
//   - a balance by the bill it was settled on.
//
// The two halves cover different sets of bookings, and neither need match the
// register on screen — that is the point of a cash-basis figure, and the report
// labels it as such rather than pretending it reconciles.
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

  const period = (request) =>
    request
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('fromDate', sql.Date, fromDate)
      .input('toDate', sql.Date, toDate);

  // Cancelled stays are excluded from the advance and balance halves: their
  // advances largely went back to the guest, and counting them as income would
  // overstate takings on exactly the stays that produced none. What a
  // cancellation *kept* is different — since cancellations settle the money
  // (refund recorded, remainder held as the cancellation charge), the kept
  // slice is real income, and it is reported below as its own line, dated by
  // the day of cancellation, rather than folded into the advance figure it
  // would only muddy. Cancellations from before settlements existed have no
  // charge recorded and still contribute nothing, which is truthful for them.
  const stayPeriodCase = `
    CASE
      WHEN b.check_in_date < @fromDate THEN 'EARLIER'
      WHEN b.check_in_date > @toDate THEN 'LATER'
      ELSE 'THIS'
    END AS stay_period`;

  const receipts = await period(pool.request()).query(`
    SELECT ar.id, ar.amount_received, ar.payment_method, ${stayPeriodCase}
    FROM dbo.advance_receipts ar
    JOIN dbo.bookings b ON b.id = ar.booking_id
    WHERE ar.lodge_id = @lodgeId
      AND ar.status = 'ISSUED'
      AND b.status <> 'CANCELLED'
      AND ar.amount_received > 0
      AND CAST(ar.created_at AS DATE) BETWEEN @fromDate AND @toDate
  `);

  // Advance money on a booking that its issued receipts do not account for.
  // Dated by the booking, because nothing else dates it.
  const unreceipted = await period(pool.request()).query(`
    SELECT b.id, b.advance_amount - ISNULL(r.total, 0) AS remainder, b.advance_payment_method,
           ${stayPeriodCase}
    FROM dbo.bookings b
    OUTER APPLY (
      SELECT SUM(amount_received) AS total
      FROM dbo.advance_receipts
      WHERE booking_id = b.id AND status = 'ISSUED'
    ) r
    WHERE b.lodge_id = @lodgeId
      AND b.status <> 'CANCELLED'
      AND b.advance_amount > ISNULL(r.total, 0)
      AND CAST(b.created_at AS DATE) BETWEEN @fromDate AND @toDate
  `);

  // Money kept from cancelled stays, dated by when each stay was cancelled —
  // that is the day the advance stopped being a deposit and became income.
  const cancellationCharges = await period(pool.request()).query(`
    SELECT b.id, b.cancellation_charge, ${stayPeriodCase}
    FROM dbo.bookings b
    WHERE b.lodge_id = @lodgeId
      AND b.status = 'CANCELLED'
      AND b.cancellation_charge > 0
      AND CAST(b.cancelled_at AS DATE) BETWEEN @fromDate AND @toDate
  `);

  const balances = await period(pool.request()).query(`
    SELECT i.id, i.balance_collected, i.balance_payment_method, ${stayPeriodCase}
    FROM dbo.invoices i
    JOIN dbo.bookings b ON b.id = i.booking_id
    WHERE i.lodge_id = @lodgeId
      AND i.status = 'ISSUED'
      AND b.status <> 'CANCELLED'
      AND i.balance_collected > 0
      AND CAST(i.created_at AS DATE) BETWEEN @fromDate AND @toDate
  `);

  // The lines behind those figures, over exactly the same filtered sets —
  // separate queries rather than a JOIN so no receipt or invoice row is
  // multiplied. Grouped by method, ordered by the first line's id, so the
  // clamp in splitAcross spends the earliest tender first every run.
  const receiptLines = linesByParent(
    await period(pool.request()).query(`
      SELECT pl.advance_receipt_id AS parent_id, pl.method, SUM(pl.amount) AS amount
      FROM dbo.payment_lines pl
      JOIN dbo.advance_receipts ar ON ar.id = pl.advance_receipt_id
      JOIN dbo.bookings b ON b.id = ar.booking_id
      WHERE pl.lodge_id = @lodgeId
        AND ar.lodge_id = @lodgeId
        AND ar.status = 'ISSUED'
        AND b.status <> 'CANCELLED'
        AND CAST(ar.created_at AS DATE) BETWEEN @fromDate AND @toDate
      GROUP BY pl.advance_receipt_id, pl.method
      ORDER BY pl.advance_receipt_id, MIN(pl.id)
    `)
  );

  const balanceLines = linesByParent(
    await period(pool.request()).query(`
      SELECT pl.invoice_id AS parent_id, pl.method, SUM(pl.amount) AS amount
      FROM dbo.payment_lines pl
      JOIN dbo.invoices i ON i.id = pl.invoice_id
      JOIN dbo.bookings b ON b.id = i.booking_id
      WHERE pl.lodge_id = @lodgeId
        AND i.lodge_id = @lodgeId
        AND i.status = 'ISSUED'
        AND b.status <> 'CANCELLED'
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
  let advanceCount = 0;
  for (const row of receipts.recordset) {
    const amount = Number(row.amount_received);
    advanceCollected = round2(advanceCollected + amount);
    advanceCount += 1;
    for (const part of splitAcross(amount, receiptLines.get(String(row.id)), row.payment_method)) {
      add(part.method, 'advance', part.amount);
    }
    file(row, 'advance', amount);
  }
  for (const row of unreceipted.recordset) {
    const amount = round2(Number(row.remainder));
    advanceCollected = round2(advanceCollected + amount);
    advanceCount += 1;
    add(row.advance_payment_method, 'advance', amount);
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

  // Summed on its own rather than through add()/file(): the charge was
  // tendered when the advance was, possibly split across methods, so filing
  // it under a payment mode here would claim a precision the record does not
  // have. It is a figure of its own, and the report prints it as one.
  let cancellationChargesKept = 0;
  for (const row of cancellationCharges.recordset) {
    cancellationChargesKept = round2(cancellationChargesKept + Number(row.cancellation_charge));
  }

  return {
    advanceCollected,
    advanceCount,
    balanceCollected,
    balanceCount: balances.recordset.length,
    // Cancellation charges are income of the period too — money the house
    // kept when a stay fell through — but they ride outside the advance and
    // balance halves, so byPaymentMode still foots against those two alone.
    cancellationChargesKept,
    cancellationChargeCount: cancellationCharges.recordset.length,
    totalCollected: round2(advanceCollected + balanceCollected + cancellationChargesKept),
    byPaymentMode,
    byStayPeriod,
  };
}

// How each stay in the register was paid — every tender behind its advance and
// its balance, so a split payment reads as "Cash 2,000 + UPI 3,000" on the row
// rather than as the first tender alone.
async function getTendersForBookings(pool, lodgeId, bookingIds) {
  if (bookingIds.length === 0) return { advance: new Map(), balance: new Map() };
  const withIds = (request) => {
    request.input('lodgeId', sql.BigInt, lodgeId);
    bookingIds.forEach((id, i) => request.input(`b${i}`, sql.BigInt, id));
    return request;
  };
  const list = bookingIds.map((_, i) => `@b${i}`).join(', ');

  const advance = linesByParent(
    await withIds(pool.request()).query(`
      SELECT ar.booking_id AS parent_id, pl.method, SUM(pl.amount) AS amount
      FROM dbo.payment_lines pl
      JOIN dbo.advance_receipts ar ON ar.id = pl.advance_receipt_id
      WHERE pl.lodge_id = @lodgeId AND ar.lodge_id = @lodgeId
        AND ar.status = 'ISSUED' AND ar.booking_id IN (${list})
      GROUP BY ar.booking_id, pl.method
      ORDER BY ar.booking_id, MIN(pl.id)
    `)
  );
  const balance = linesByParent(
    await withIds(pool.request()).query(`
      SELECT i.booking_id AS parent_id, pl.method, SUM(pl.amount) AS amount
      FROM dbo.payment_lines pl
      JOIN dbo.invoices i ON i.id = pl.invoice_id
      WHERE pl.lodge_id = @lodgeId AND i.lodge_id = @lodgeId
        AND i.status = 'ISSUED' AND i.booking_id IN (${list})
      GROUP BY i.booking_id, pl.method
      ORDER BY i.booking_id, MIN(pl.id)
    `)
  );
  return { advance, balance };
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
             i.event_booking_id, i.booking_id,
             i.food_subtotal, i.food_cgst_amount, i.food_sgst_amount,
             COALESCE(b.guest_name, eb.organiser_name) AS guest_name
      FROM dbo.invoices i
      -- LEFT: a food bill has no stay and a function's bill has no booking row;
      -- an inner join here dropped both from the filing summary.
      LEFT JOIN dbo.bookings b ON b.id = i.booking_id
      LEFT JOIN dbo.event_bookings eb ON eb.id = i.event_booking_id
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
    // Same discriminator getAnalyticsOverview uses: an EVENT invoice's "room"
    // columns hold the venue/catering charge, never room revenue, and
    // food_subtotal/food_cgst/food_sgst is food tax wherever it rides —
    // including room-service food billed onto a stay's own invoice.
    isEvent: row.event_booking_id != null,
    foodCgst: Number(row.food_cgst_amount ?? 0),
    foodSgst: Number(row.food_sgst_amount ?? 0),
  }));

  const totals = emptyTotals();
  const byDocumentType = {};
  const byRevenueStream = {
    ROOMS: { cgstAmount: 0, sgstAmount: 0 },
    FUNCTIONS: { cgstAmount: 0, sgstAmount: 0 },
    FOOD: { cgstAmount: 0, sgstAmount: 0 },
  };

  for (const invoice of invoices) {
    addToTotals(totals, invoice);
    if (!byDocumentType[invoice.documentType]) {
      byDocumentType[invoice.documentType] = emptyTotals();
    }
    addToTotals(byDocumentType[invoice.documentType], invoice);

    const primaryStream = invoice.isEvent ? 'FUNCTIONS' : 'ROOMS';
    byRevenueStream[primaryStream].cgstAmount = round2(byRevenueStream[primaryStream].cgstAmount + invoice.cgstAmount);
    byRevenueStream[primaryStream].sgstAmount = round2(byRevenueStream[primaryStream].sgstAmount + invoice.sgstAmount);
    byRevenueStream.FOOD.cgstAmount = round2(byRevenueStream.FOOD.cgstAmount + invoice.foodCgst);
    byRevenueStream.FOOD.sgstAmount = round2(byRevenueStream.FOOD.sgstAmount + invoice.foodSgst);
  }

  return { fromDate, toDate, totals, byDocumentType, byRevenueStream, invoices };
}

// The bill-level totals the report foots: one set for every issued bill in the
// register, and one per document type so a tax invoice's figures are never
// blended with a cash receipt's.
function emptyBillTotals() {
  return {
    count: 0,
    grossAmount: 0,
    discountAmount: 0,
    netAmount: 0,
    roomTaxable: 0,
    foodTaxable: 0,
    taxableValue: 0,
    roomCgst: 0,
    roomSgst: 0,
    foodCgst: 0,
    foodSgst: 0,
    cgstAmount: 0,
    sgstAmount: 0,
    totalTax: 0,
    roundOff: 0,
    totalAmount: 0,
  };
}

function addBill(totals, figures) {
  totals.count += 1;
  for (const key of Object.keys(totals)) {
    if (key === 'count') continue;
    const source = key === 'totalAmount' ? figures.billedAmount : figures[key];
    totals[key] = round2(totals[key] + (source || 0));
  }
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
             b.cancel_reason, b.refund_amount, b.cancellation_charge,
             r.room_number, c.name AS category_name,
             i.invoice_number, i.document_type, i.billing_side, i.created_at AS invoice_created_at,
             i.room_subtotal, i.food_subtotal,
             i.cgst_amount, i.sgst_amount, i.food_cgst_amount, i.food_sgst_amount,
             i.late_checkout_charge, i.discount_amount,
             i.round_off, i.total_amount,
             i.advance_paid, i.balance_collected, i.balance_payment_method
      FROM dbo.bookings b
      JOIN dbo.rooms r ON r.id = b.room_id
      JOIN dbo.room_categories c ON c.id = r.category_id
      OUTER APPLY (
        SELECT TOP 1 invoice_number, document_type, billing_side, created_at,
               room_subtotal, food_subtotal,
               cgst_amount, sgst_amount, food_cgst_amount, food_sgst_amount,
               late_checkout_charge, discount_amount, round_off,
               total_amount, advance_paid, balance_collected, balance_payment_method
        FROM dbo.invoices
        WHERE booking_id = b.id AND status = 'ISSUED'
        ORDER BY created_at DESC
      ) i
      WHERE b.lodge_id = @lodgeId
        AND b.check_in_date BETWEEN @fromDate AND @toDate
        ${billingFilter}
      ORDER BY b.created_at DESC, b.id DESC
    `);

  const tenders = await getTendersForBookings(
    pool,
    lodgeId,
    result.recordset.map((row) => row.id)
  );

  const bookings = result.recordset.map((row) => {
    const billed = row.invoice_number != null;
    const figures = billed ? billFigures(row) : null;
    const advanceAmount = row.advance_amount != null ? Number(row.advance_amount) : 0;
    const balanceCollected = billed ? Number(row.balance_collected ?? 0) : null;
    return {
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
      // Money the property holds against this stay, and how it arrived — every
      // tender, so a split advance is not misreported as its first tender.
      advanceAmount,
      advancePaymentMethod: row.advance_payment_method || null,
      advanceTenders: mergeTenders(
        splitAcross(advanceAmount, tenders.advance.get(String(row.id)), row.advance_payment_method)
      ),
      // How a cancellation settled the advance: refunded to the guest, and
      // kept as the cancellation charge. Null on live stays, and on
      // cancellations that never settled the money.
      cancelReason: row.cancel_reason || null,
      refundAmount: row.refund_amount != null ? Number(row.refund_amount) : null,
      cancellationCharge: row.cancellation_charge != null ? Number(row.cancellation_charge) : null,
      invoiceNumber: row.invoice_number || null,
      documentType: row.document_type || null,
      billingSide: row.billing_side || null,
      invoiceDate: row.invoice_created_at || null,
      // The bill's own figures — null on every one of them until a bill exists.
      // See billFigures for the identity that ties them together.
      grossAmount: figures?.grossAmount ?? null,
      roomGross: figures?.roomGross ?? null,
      foodGross: figures?.foodGross ?? null,
      discountAmount: figures?.discountAmount ?? null,
      netAmount: figures?.netAmount ?? null,
      lateCheckoutCharge: figures?.lateCheckoutCharge ?? null,
      roomTaxable: figures?.roomTaxable ?? null,
      foodTaxable: figures?.foodTaxable ?? null,
      taxableValue: figures?.taxableValue ?? null,
      roomCgst: figures?.roomCgst ?? null,
      roomSgst: figures?.roomSgst ?? null,
      foodCgst: figures?.foodCgst ?? null,
      foodSgst: figures?.foodSgst ?? null,
      cgstAmount: figures?.cgstAmount ?? null,
      sgstAmount: figures?.sgstAmount ?? null,
      totalTax: figures?.totalTax ?? null,
      roundOff: figures?.roundOff ?? null,
      billedAmount: figures?.billedAmount ?? null,
      // What the bill deducted as advance and what was collected on it. The
      // advance deducted is the booking's advance as it stood at issue; a
      // receipt raised after the bill would leave it behind, so the register
      // shows the booking's figure and the bill's separately.
      advancePaid: billed ? Number(row.advance_paid ?? 0) : null,
      balanceCollected,
      balancePaymentMethod: row.balance_payment_method || null,
      balanceTenders: billed
        ? mergeTenders(
            splitAcross(balanceCollected, tenders.balance.get(String(row.id)), row.balance_payment_method)
          )
        : [],
      // Left unpaid after the bill's own deductions — 0 on a settled bill.
      balanceDue: billed
        ? round2(figures.billedAmount - Number(row.advance_paid ?? 0) - balanceCollected)
        : null,
      createdAt: row.created_at,
    };
  });

  const byStatus = Object.fromEntries(BOOKING_STATUSES.map((s) => [s, 0]));
  // What cancelled stays would have added, kept aside rather than discarded so
  // the report can name the figure it is leaving out. A number an owner can see
  // and dismiss is very different from one that silently went missing.
  const cancelled = { count: 0, bookedValue: 0, advanceHeld: 0, refunded: 0, chargesKept: 0 };
  const summary = {
    totalBookings: bookings.length,
    activeBookings: 0,
    roomNights: 0,
    // What the stays were priced at, versus what an issued bill actually
    // charged. They diverge whenever a bill is still pending, so an owner
    // reading only one of the two would draw the wrong conclusion.
    bookedValue: 0,
    unbilledCount: 0,
    unbilledValue: 0,
    billedAmount: 0,
    billedCount: 0,
    // Money attached to the stays listed in this register — i.e. keyed to
    // check-in date, so an advance for one of these stays may well have been
    // taken in an earlier period. These reconcile with the rows on the page.
    // What was actually banked in the period is `collections` below, which is
    // dated by when each payment moved and deliberately does not match these.
    stayAdvance: 0,
    stayBalance: 0,
    stayBalanceDue: 0,
  };
  const bills = emptyBillTotals();
  const byDocumentType = Object.fromEntries(DOCUMENT_TYPES.map((t) => [t, emptyBillTotals()]));

  for (const booking of bookings) {
    if (byStatus[booking.status] === undefined) byStatus[booking.status] = 0;
    byStatus[booking.status] += 1;

    if (booking.status === 'CANCELLED') {
      cancelled.count += 1;
      cancelled.bookedValue = round2(cancelled.bookedValue + booking.totalPrice);
      cancelled.advanceHeld = round2(cancelled.advanceHeld + booking.advanceAmount);
      // Where the held money went, on the stays whose cancellation settled it.
      // The two need not add to advanceHeld: older cancellations recorded
      // neither figure, and their advances stay unaccounted for.
      cancelled.refunded = round2(cancelled.refunded + (booking.refundAmount ?? 0));
      cancelled.chargesKept = round2(cancelled.chargesKept + (booking.cancellationCharge ?? 0));
      continue;
    }

    summary.activeBookings += 1;
    summary.roomNights += booking.nights;
    summary.bookedValue = round2(summary.bookedValue + booking.totalPrice);
    summary.stayAdvance = round2(summary.stayAdvance + booking.advanceAmount);

    if (booking.billedAmount == null) {
      summary.unbilledCount += 1;
      summary.unbilledValue = round2(summary.unbilledValue + booking.totalPrice);
      continue;
    }

    summary.billedCount += 1;
    summary.billedAmount = round2(summary.billedAmount + booking.billedAmount);
    summary.stayBalance = round2(summary.stayBalance + booking.balanceCollected);
    summary.stayBalanceDue = round2(summary.stayBalanceDue + booking.balanceDue);
    addBill(bills, booking);
    if (!byDocumentType[booking.documentType]) byDocumentType[booking.documentType] = emptyBillTotals();
    addBill(byDocumentType[booking.documentType], booking);
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
  summary.cancellationChargesKept = collections.cancellationChargesKept;
  summary.totalCollected = collections.totalCollected;

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
      // Every issued bill in the register, footed; and the same split by the
      // kind of document, which is what a return is filled in from.
      bills,
      byDocumentType,
      // Kept under its old name for readers that still look here. Same figures
      // as `bills`, plus the aliases they used.
      tax: {
        ...bills,
        roomSubtotal: bills.roomTaxable,
        foodSubtotal: bills.foodTaxable,
      },
    },
    bookings,
  };
}

const EVENT_STATUSES = ['ENQUIRY', 'TENTATIVE', 'CONFIRMED', 'SETTLED', 'CANCELLED', 'EXPIRED'];

function emptyEventTotals() {
  return { count: 0, venueCharge: 0, cateringAmount: 0, addonsTotal: 0, discountAmount: 0, totalAmount: 0, advanceAmount: 0, balanceDue: 0 };
}

function addEventTotals(totals, ev) {
  totals.count += 1;
  totals.venueCharge = round2(totals.venueCharge + ev.venueCharge);
  totals.cateringAmount = round2(totals.cateringAmount + ev.cateringAmount);
  totals.addonsTotal = round2(totals.addonsTotal + ev.addonsTotal);
  totals.discountAmount = round2(totals.discountAmount + ev.discountAmount);
  totals.totalAmount = round2(totals.totalAmount + ev.totalAmount);
  totals.advanceAmount = round2(totals.advanceAmount + ev.advanceAmount);
  totals.balanceDue = round2(totals.balanceDue + ev.balanceDue);
}

// A function belongs to the period it *starts* in, the same reading the
// booking register gives a stay: a function running past midnight is counted
// once, on the evening it begins, not on every day it touches.
async function getEventsReport(lodgeId, fromDate, toDate) {
  const pool = await getPool();

  const lodgeResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query('SELECT name FROM dbo.lodges WHERE id = @lodgeId');

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('fromDate', sql.DateTimeOffset, new Date(`${fromDate}T00:00:00+05:30`))
    .input('toDate', sql.DateTimeOffset, (() => {
      const after = new Date(`${toDate}T00:00:00+05:30`);
      after.setUTCDate(after.getUTCDate() + 1);
      return after;
    })())
    .query(`
      SELECT e.id, e.event_type, e.title, e.organiser_name, e.organiser_phone,
             e.start_at, e.end_at, e.expected_pax, e.guaranteed_pax, e.final_pax,
             e.venue_charge, e.catering_amount, e.addons_total, e.discount_amount,
             e.total_amount, e.advance_amount, e.advance_payment_method,
             e.status, e.cancel_reason, e.refund_amount, e.cancellation_charge,
             v.name AS venue_name,
             i.invoice_number, i.document_type, i.created_at AS invoice_created_at
      FROM dbo.event_bookings e
      JOIN dbo.event_venues v ON v.id = e.venue_id
      OUTER APPLY (
        SELECT TOP 1 invoice_number, document_type, created_at
        FROM dbo.invoices
        WHERE event_booking_id = e.id AND status = 'ISSUED'
        ORDER BY created_at DESC
      ) i
      WHERE e.lodge_id = @lodgeId AND e.start_at >= @fromDate AND e.start_at < @toDate
      ORDER BY e.start_at ASC
    `);

  const events = result.recordset.map((row) => {
    const advanceAmount = row.advance_amount != null ? Number(row.advance_amount) : 0;
    const totalAmount = Number(row.total_amount);
    return {
      id: row.id,
      eventType: row.event_type,
      title: row.title,
      organiserName: row.organiser_name,
      organiserPhone: row.organiser_phone,
      venueName: row.venue_name,
      startAt: row.start_at,
      endAt: row.end_at,
      expectedPax: Number(row.expected_pax),
      guaranteedPax: Number(row.guaranteed_pax),
      finalPax: row.final_pax == null ? null : Number(row.final_pax),
      venueCharge: Number(row.venue_charge),
      cateringAmount: Number(row.catering_amount),
      addonsTotal: Number(row.addons_total),
      discountAmount: Number(row.discount_amount),
      totalAmount,
      advanceAmount,
      advancePaymentMethod: row.advance_payment_method || null,
      balanceDue: round2(totalAmount - advanceAmount),
      status: row.status,
      cancelReason: row.cancel_reason || null,
      refundAmount: row.refund_amount != null ? Number(row.refund_amount) : null,
      cancellationCharge: row.cancellation_charge != null ? Number(row.cancellation_charge) : null,
      invoiceNumber: row.invoice_number || null,
      documentType: row.document_type || null,
      invoiceDate: row.invoice_created_at || null,
    };
  });

  const byStatus = Object.fromEntries(EVENT_STATUSES.map((s) => [s, 0]));
  const cancelled = { count: 0, advanceHeld: 0, refunded: 0, chargesKept: 0 };
  const totals = emptyEventTotals();
  const byEventType = {};

  for (const ev of events) {
    if (byStatus[ev.status] === undefined) byStatus[ev.status] = 0;
    byStatus[ev.status] += 1;

    if (ev.status === 'CANCELLED') {
      cancelled.count += 1;
      cancelled.advanceHeld = round2(cancelled.advanceHeld + ev.advanceAmount);
      cancelled.refunded = round2(cancelled.refunded + (ev.refundAmount ?? 0));
      cancelled.chargesKept = round2(cancelled.chargesKept + (ev.cancellationCharge ?? 0));
      continue;
    }
    if (ev.status === 'EXPIRED') continue;

    addEventTotals(totals, ev);
    if (!byEventType[ev.eventType]) byEventType[ev.eventType] = emptyEventTotals();
    addEventTotals(byEventType[ev.eventType], ev);
  }

  return {
    fromDate,
    toDate,
    generatedAt: new Date().toISOString(),
    lodgeName: lodgeResult.recordset[0]?.name || '',
    summary: {
      totalEvents: events.length,
      byStatus,
      cancelled,
      totals,
      byEventType,
    },
    events,
  };
}

// ---------------------------------------------------------------------------
// Food orders
// ---------------------------------------------------------------------------

const ORDER_STATUSES = ['PENDING', 'QUEUED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED'];
const ORDER_SOURCES = ['ROOM', 'TABLE', 'COUNTER'];

// An order belongs to the period by its order_date — the IST calendar day it
// was placed on, the same day the kitchen's own counters key off of. Delivered
// and cancelled orders are counted; a live order still in the queue when this
// report is pulled counts too, under whatever status it is currently in.
async function getFoodOrdersReport(lodgeId, fromDate, toDate) {
  const pool = await getPool();

  const lodgeResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query('SELECT name FROM dbo.lodges WHERE id = @lodgeId');

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('fromDate', sql.Date, fromDate)
    .input('toDate', sql.Date, toDate)
    .query(`
      SELECT o.id, o.order_number, o.order_date, o.source, o.guest_name, o.guest_phone,
             o.status, o.subtotal, o.placed_at, o.delivered_at, o.cancelled_at, o.cancel_reason,
             r.room_number, t.label AS table_label,
             i.invoice_number, i.document_type
      FROM dbo.food_orders o
      LEFT JOIN dbo.rooms r ON r.id = o.room_id
      LEFT JOIN dbo.dining_tables t ON t.id = o.table_id
      LEFT JOIN dbo.invoices i ON i.id = o.invoice_id AND i.status = 'ISSUED'
      WHERE o.lodge_id = @lodgeId AND o.order_date BETWEEN @fromDate AND @toDate
      ORDER BY o.placed_at ASC
    `);

  const orderIds = result.recordset.map((row) => row.id);
  const itemCounts = new Map();
  if (orderIds.length > 0) {
    const itemsRequest = pool.request();
    orderIds.forEach((id, i) => itemsRequest.input(`o${i}`, sql.BigInt, id));
    const itemsResult = await itemsRequest.query(`
      SELECT order_id, SUM(quantity) AS qty
      FROM dbo.food_order_items
      WHERE order_id IN (${orderIds.map((_, i) => `@o${i}`).join(', ')})
      GROUP BY order_id
    `);
    for (const row of itemsResult.recordset) itemCounts.set(String(row.order_id), Number(row.qty));
  }

  const orders = result.recordset.map((row) => ({
    id: row.id,
    orderNumber: row.order_number,
    orderDate: toIsoDate(row.order_date),
    source: row.source,
    roomNumber: row.room_number || null,
    tableLabel: row.table_label || null,
    guestName: row.guest_name || null,
    guestPhone: row.guest_phone || null,
    status: row.status,
    itemCount: itemCounts.get(String(row.id)) || 0,
    subtotal: Number(row.subtotal),
    placedAt: row.placed_at,
    deliveredAt: row.delivered_at || null,
    cancelledAt: row.cancelled_at || null,
    cancelReason: row.cancel_reason || null,
    invoiceNumber: row.invoice_number || null,
    documentType: row.document_type || null,
    billed: row.invoice_number != null,
  }));

  const byStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0]));
  const bySource = Object.fromEntries(ORDER_SOURCES.map((s) => [s, 0]));
  let deliveredCount = 0;
  let deliveredValue = 0;
  let cancelledCount = 0;
  let billedCount = 0;
  let billedValue = 0;
  let unbilledDeliveredValue = 0;

  for (const order of orders) {
    if (byStatus[order.status] === undefined) byStatus[order.status] = 0;
    byStatus[order.status] += 1;
    if (bySource[order.source] === undefined) bySource[order.source] = 0;
    bySource[order.source] += 1;

    if (order.status === 'CANCELLED') {
      cancelledCount += 1;
      continue;
    }
    if (order.status === 'DELIVERED') {
      deliveredCount += 1;
      deliveredValue = round2(deliveredValue + order.subtotal);
    }
    if (order.billed) {
      billedCount += 1;
      billedValue = round2(billedValue + order.subtotal);
    } else if (order.status === 'DELIVERED') {
      unbilledDeliveredValue = round2(unbilledDeliveredValue + order.subtotal);
    }
  }

  return {
    fromDate,
    toDate,
    generatedAt: new Date().toISOString(),
    lodgeName: lodgeResult.recordset[0]?.name || '',
    summary: {
      totalOrders: orders.length,
      byStatus,
      bySource,
      deliveredCount,
      deliveredValue,
      cancelledCount,
      billedCount,
      billedValue,
      unbilledDeliveredValue,
    },
    orders,
  };
}

// ---------------------------------------------------------------------------
// Analytics overview — cross-stream aggregates for the Overview/Functions/Food
// tabs. Kept separate from the register-style reports above: those answer
// "list every booking/event/order", this answers "how did the property do,
// shaped for a chart" — different enough queries that bolting them onto the
// existing reports would mean fetching (and discarding) a full register just
// to draw a line chart.
// ---------------------------------------------------------------------------

// An invoice's revenue, split into the stream it belongs to. STAY and EVENT
// invoices are told apart by event_booking_id (mirrors billing.service's
// mapInvoice kind test); an EVENT invoice's "room" columns actually hold the
// venue/catering charge, never room revenue, so it is never added to
// roomRevenue even when event_booking_id is set. food_subtotal is added to
// foodRevenue regardless of which invoice carries it — a stay's invoice can
// include room-service food, and that slice is food revenue wherever it rides.
const STREAM_REVENUE_EXPR = `
  SUM(CASE WHEN i.event_booking_id IS NULL THEN i.room_subtotal + i.cgst_amount + i.sgst_amount ELSE 0 END) AS room_revenue,
  SUM(CASE WHEN i.event_booking_id IS NOT NULL THEN i.room_subtotal + i.cgst_amount + i.sgst_amount ELSE 0 END) AS function_revenue,
  SUM(ISNULL(i.food_subtotal, 0) + ISNULL(i.food_cgst_amount, 0) + ISNULL(i.food_sgst_amount, 0)) AS food_revenue
`;

// Revenue per calendar day, split by stream, dated by when the bill was
// issued — the same basis Overview's hero and getCollectionsInPeriod use,
// since a chart of "how the month went" has to move with when money was
// actually billed, not with when a stay happened to start.
async function getDailyRevenueByStream(pool, lodgeId, fromDate, toDate) {
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('fromDate', sql.Date, fromDate)
    .input('toDate', sql.Date, toDate)
    .query(`
      SELECT CAST(i.created_at AS DATE) AS day, ${STREAM_REVENUE_EXPR}
      FROM dbo.invoices i
      WHERE i.lodge_id = @lodgeId AND i.status = 'ISSUED'
        AND CAST(i.created_at AS DATE) BETWEEN @fromDate AND @toDate
      GROUP BY CAST(i.created_at AS DATE)
    `);

  const byDate = new Map();
  for (const row of result.recordset) {
    byDate.set(toIsoDate(row.day), {
      roomRevenue: round2(Number(row.room_revenue)),
      functionRevenue: round2(Number(row.function_revenue)),
      foodRevenue: round2(Number(row.food_revenue)),
    });
  }
  return byDate;
}

// Occupied rooms per calendar day, optionally narrowed to one room category —
// the per-day overlap loop getOccupancyReport already runs, generalised so
// occupancyByCategory can reuse it instead of re-deriving the same logic.
async function getOccupiedRoomsByDate(pool, lodgeId, fromDate, toDate, categoryId = null) {
  const request = pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('fromDate', sql.Date, fromDate)
    .input('toDate', sql.Date, toDate);
  if (categoryId != null) request.input('categoryId', sql.BigInt, categoryId);

  const categoryJoin = categoryId != null ? 'JOIN dbo.rooms r ON r.id = b.room_id' : '';
  const categoryFilter = categoryId != null ? 'AND r.category_id = @categoryId' : '';

  const result = await request.query(`
    SELECT b.room_id, b.check_in_date, b.check_out_date
    FROM dbo.bookings b
    ${categoryJoin}
    WHERE b.lodge_id = @lodgeId AND b.status IN ('CHECKED_IN', 'CHECKED_OUT')
      AND b.check_in_date < DATEADD(day, 1, @toDate) AND b.check_out_date > @fromDate
      ${categoryFilter}
  `);

  const dates = datesInRange(fromDate, toDate);
  const occupiedByDate = new Map(dates.map((d) => [d, new Set()]));
  for (const row of result.recordset) {
    const stayStart = toIsoDate(row.check_in_date);
    const stayEnd = toIsoDate(row.check_out_date);
    for (const date of dates) {
      if (date >= stayStart && date < stayEnd) occupiedByDate.get(date).add(row.room_id);
    }
  }
  return occupiedByDate;
}

// event_bookings.start_at is DATETIMEOFFSET, not DATE — comparing it to a
// plain @fromDate/@toDate would compare across types and silently coerce.
// getEventsReport already carries this exact pair; reused here so the
// pipeline/venue queries bound a function's day the same way its own report
// does, IST midnight to IST midnight.
function eventDateBounds(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00+05:30`);
  const to = new Date(`${toDate}T00:00:00+05:30`);
  to.setUTCDate(to.getUTCDate() + 1);
  return { from, to };
}

// The immediately preceding span of the same length — "the 7 days before
// this 7-day range", "the 30 days before this month". The default comparison,
// since it works for any range the date pickers can produce, not just a
// whole calendar month.
function shiftPriorPeriod(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T00:00:00Z`);
  const days = Math.round((to - from) / 86400000) + 1;
  const priorTo = new Date(from);
  priorTo.setUTCDate(priorTo.getUTCDate() - 1);
  const priorFrom = new Date(priorTo);
  priorFrom.setUTCDate(priorFrom.getUTCDate() - (days - 1));
  return { fromDate: toIsoDate(priorFrom), toDate: toIsoDate(priorTo) };
}

// The same span exactly one year earlier — "September 2025" for "September
// 2026". Read literally off the calendar (subtract a year from each date)
// rather than by day-count, so a whole-month range compares against the same
// whole month last year even when the two years' month lengths differ.
function shiftPriorYear(fromDate, toDate) {
  const shiftYear = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return `${y - 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  return { fromDate: shiftYear(fromDate), toDate: shiftYear(toDate) };
}

const COMPARE_MODES = ['previous_period', 'previous_year'];

async function getAnalyticsOverview(lodgeId, fromDate, toDate, compareMode = 'previous_period') {
  const pool = await getPool();

  const lodgeResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query('SELECT name FROM dbo.lodges WHERE id = @lodgeId');

  const totalRoomsResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query('SELECT COUNT(*) AS total FROM dbo.rooms WHERE lodge_id = @lodgeId AND is_active = 1');
  const totalRooms = totalRoomsResult.recordset[0].total;

  const dates = datesInRange(fromDate, toDate);
  const [revenueByDate, occupiedByDate] = await Promise.all([
    getDailyRevenueByStream(pool, lodgeId, fromDate, toDate),
    getOccupiedRoomsByDate(pool, lodgeId, fromDate, toDate),
  ]);

  const dailyTrend = dates.map((date) => {
    const rev = revenueByDate.get(date) || { roomRevenue: 0, functionRevenue: 0, foodRevenue: 0 };
    const occupiedRooms = occupiedByDate.get(date).size;
    return {
      date,
      roomRevenue: rev.roomRevenue,
      functionRevenue: rev.functionRevenue,
      foodRevenue: rev.foodRevenue,
      totalRevenue: round2(rev.roomRevenue + rev.functionRevenue + rev.foodRevenue),
      occupiedRooms,
      totalRooms,
      occupancyPercent: totalRooms > 0 ? round2((occupiedRooms / totalRooms) * 100) : 0,
    };
  });

  const priorRange = compareMode === 'previous_year'
    ? shiftPriorYear(fromDate, toDate)
    : shiftPriorPeriod(fromDate, toDate);
  const priorRevenueByDate = await getDailyRevenueByStream(pool, lodgeId, priorRange.fromDate, priorRange.toDate);
  const priorDailyTrend = datesInRange(priorRange.fromDate, priorRange.toDate).map((date) => {
    const rev = priorRevenueByDate.get(date) || { roomRevenue: 0, functionRevenue: 0, foodRevenue: 0 };
    return {
      date,
      totalRevenue: round2(rev.roomRevenue + rev.functionRevenue + rev.foodRevenue),
    };
  });

  const revenueByRoomCategoryResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('fromDate', sql.Date, fromDate)
    .input('toDate', sql.Date, toDate)
    .query(`
      SELECT rc.id AS category_id, rc.name AS category_name,
             SUM(i.room_subtotal + i.cgst_amount + i.sgst_amount) AS revenue
      FROM dbo.invoices i
      JOIN dbo.bookings b ON b.id = i.booking_id
      JOIN dbo.rooms r ON r.id = b.room_id
      JOIN dbo.room_categories rc ON rc.id = r.category_id
      WHERE i.lodge_id = @lodgeId AND i.status = 'ISSUED' AND i.event_booking_id IS NULL
        AND CAST(i.created_at AS DATE) BETWEEN @fromDate AND @toDate
      GROUP BY rc.id, rc.name
      ORDER BY revenue DESC
    `);
  const revenueByRoomCategory = revenueByRoomCategoryResult.recordset.map((row) => ({
    categoryId: row.category_id,
    categoryName: row.category_name,
    revenue: round2(Number(row.revenue)),
  }));

  const revenueByFunctionTypeResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('fromDate', sql.Date, fromDate)
    .input('toDate', sql.Date, toDate)
    .query(`
      SELECT e.event_type, COUNT(*) AS cnt,
             SUM(i.room_subtotal + i.cgst_amount + i.sgst_amount + ISNULL(i.food_subtotal, 0) + ISNULL(i.food_cgst_amount, 0) + ISNULL(i.food_sgst_amount, 0)) AS revenue
      FROM dbo.invoices i
      JOIN dbo.event_bookings e ON e.id = i.event_booking_id
      WHERE i.lodge_id = @lodgeId AND i.status = 'ISSUED'
        AND CAST(i.created_at AS DATE) BETWEEN @fromDate AND @toDate
      GROUP BY e.event_type
      ORDER BY revenue DESC
    `);
  const revenueByFunctionType = revenueByFunctionTypeResult.recordset.map((row) => ({
    eventType: row.event_type,
    count: row.cnt,
    revenue: round2(Number(row.revenue)),
  }));

  // Payment mix across all three streams, invoices only (advances are a
  // deposit against a bill not yet issued, so mixing them in here would count
  // some of this period's money twice once the bill it belongs to lands in a
  // later period's mix).
  const paymentMixResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('fromDate', sql.Date, fromDate)
    .input('toDate', sql.Date, toDate)
    .query(`
      SELECT pl.method, SUM(pl.amount) AS amount
      FROM dbo.payment_lines pl
      JOIN dbo.invoices i ON i.id = pl.invoice_id
      WHERE pl.lodge_id = @lodgeId AND i.lodge_id = @lodgeId AND i.status = 'ISSUED'
        AND CAST(i.created_at AS DATE) BETWEEN @fromDate AND @toDate
      GROUP BY pl.method
    `);
  const paymentMixByMethod = new Map(
    paymentMixResult.recordset.map((row) => [row.method, round2(Number(row.amount))])
  );
  const paymentMix = [...PAYMENT_METHODS, 'UNRECORDED']
    .filter((m) => paymentMixByMethod.has(m))
    .map((method) => ({ method, amount: paymentMixByMethod.get(method) }));

  const topGuestsResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('fromDate', sql.Date, fromDate)
    .input('toDate', sql.Date, toDate)
    .query(`
      SELECT TOP 10 b.guest_name, b.guest_phone,
             SUM(b.total_price) AS spend, COUNT(*) AS cnt
      FROM dbo.bookings b
      WHERE b.lodge_id = @lodgeId AND b.status <> 'CANCELLED'
        AND b.check_in_date BETWEEN @fromDate AND @toDate
      GROUP BY b.guest_name, b.guest_phone
      ORDER BY spend DESC
    `);
  const topGuests = topGuestsResult.recordset.map((row) => ({
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    totalSpend: round2(Number(row.spend)),
    bookingCount: row.cnt,
  }));

  // Pipeline is by *value on offer at each stage*, not billed revenue — a
  // CONFIRMED function's total_amount hasn't been billed yet, and the point
  // of this table is to show what is moving through the stages, not what has
  // landed (that's revenueByFunctionType and the GST report's job).
  const pipelineBounds = eventDateBounds(fromDate, toDate);
  const pipelineResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('fromDate', sql.DateTimeOffset, pipelineBounds.from)
    .input('toDate', sql.DateTimeOffset, pipelineBounds.to)
    .query(`
      SELECT status, COUNT(*) AS cnt, SUM(total_amount) AS value
      FROM dbo.event_bookings
      WHERE lodge_id = @lodgeId AND start_at >= @fromDate AND start_at < @toDate
      GROUP BY status
    `);
  const pipelineByStatus = new Map(
    pipelineResult.recordset.map((row) => [row.status, { count: row.cnt, value: round2(Number(row.value)) }])
  );
  const functionsPipeline = EVENT_STATUSES.map((status) => ({
    status,
    count: pipelineByStatus.get(status)?.count ?? 0,
    value: pipelineByStatus.get(status)?.value ?? 0,
  }));

  // Forward-looking regardless of the report's own date range — "what's
  // coming up" is a different question to "how did the period do", and an
  // owner asking it does not want it narrowed to whatever month they last
  // had the reports page open on.
  const upcomingResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT TOP 20 e.id, e.title, e.event_type, e.start_at, e.end_at, e.status,
             e.total_amount, e.advance_amount, v.name AS venue_name
      FROM dbo.event_bookings e
      JOIN dbo.event_venues v ON v.id = e.venue_id
      WHERE e.lodge_id = @lodgeId AND e.status IN ('CONFIRMED', 'TENTATIVE')
        AND e.start_at >= SYSDATETIMEOFFSET()
      ORDER BY e.start_at ASC
    `);
  const upcomingFunctions = upcomingResult.recordset.map((row) => ({
    id: row.id,
    title: row.title,
    eventType: row.event_type,
    venueName: row.venue_name,
    startAt: row.start_at,
    endAt: row.end_at,
    status: row.status,
    totalAmount: round2(Number(row.total_amount)),
    advanceAmount: round2(Number(row.advance_amount)),
  }));

  const venueBounds = eventDateBounds(fromDate, toDate);
  const venueUtilizationResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('fromDate', sql.DateTimeOffset, venueBounds.from)
    .input('toDate', sql.DateTimeOffset, venueBounds.to)
    .query(`
      SELECT v.id AS venue_id, v.name AS venue_name, COUNT(*) AS cnt
      FROM dbo.event_bookings e
      JOIN dbo.event_venues v ON v.id = e.venue_id
      WHERE e.lodge_id = @lodgeId AND e.start_at >= @fromDate AND e.start_at < @toDate
        AND e.status NOT IN ('CANCELLED', 'EXPIRED')
      GROUP BY v.id, v.name
      ORDER BY cnt DESC
    `);
  const venueUtilization = venueUtilizationResult.recordset.map((row) => ({
    venueId: row.venue_id,
    venueName: row.venue_name,
    eventCount: row.cnt,
  }));

  const ordersByHourResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('fromDate', sql.Date, fromDate)
    .input('toDate', sql.Date, toDate)
    .query(`
      SELECT DATEPART(HOUR, placed_at) AS hr, COUNT(*) AS cnt
      FROM dbo.food_orders
      WHERE lodge_id = @lodgeId AND order_date BETWEEN @fromDate AND @toDate
      GROUP BY DATEPART(HOUR, placed_at)
    `);
  const ordersByHourMap = new Map(ordersByHourResult.recordset.map((row) => [row.hr, row.cnt]));
  const ordersByHour = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    orderCount: ordersByHourMap.get(hour) ?? 0,
  }));

  const topFoodItemsResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('fromDate', sql.Date, fromDate)
    .input('toDate', sql.Date, toDate)
    .query(`
      SELECT TOP 10 foi.item_name,
             SUM(foi.quantity) AS qty,
             SUM(foi.quantity * foi.unit_price) AS revenue
      FROM dbo.food_order_items foi
      JOIN dbo.food_orders fo ON fo.id = foi.order_id
      WHERE fo.lodge_id = @lodgeId AND fo.order_date BETWEEN @fromDate AND @toDate
        AND fo.status <> 'CANCELLED'
      GROUP BY foi.item_name
      ORDER BY revenue DESC
    `);
  const topFoodItems = topFoodItemsResult.recordset.map((row) => ({
    itemName: row.item_name,
    quantity: Number(row.qty),
    revenue: round2(Number(row.revenue)),
  }));

  return {
    fromDate,
    toDate,
    generatedAt: new Date().toISOString(),
    lodgeName: lodgeResult.recordset[0]?.name || '',
    compareMode,
    dailyTrend,
    priorPeriod: { fromDate: priorRange.fromDate, toDate: priorRange.toDate, dailyTrend: priorDailyTrend },
    revenueByRoomCategory,
    revenueByFunctionType,
    paymentMix,
    topGuests,
    functionsPipeline,
    upcomingFunctions,
    venueUtilization,
    ordersByHour,
    topFoodItems,
  };
}

// Room-specific figures the Rooms tab needs beyond the booking register:
// RevPAR, average length of stay, cancellation rate, an occupancy trend line,
// a length-of-stay histogram, and occupancy broken out by category.
async function getRoomsAnalytics(lodgeId, fromDate, toDate) {
  const pool = await getPool();
  const dates = datesInRange(fromDate, toDate);

  const categoriesResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT rc.id AS category_id, rc.name AS category_name, COUNT(r.id) AS room_count
      FROM dbo.room_categories rc
      JOIN dbo.rooms r ON r.category_id = rc.id AND r.is_active = 1
      WHERE rc.lodge_id = @lodgeId AND rc.is_active = 1
      GROUP BY rc.id, rc.name
    `);
  const totalRooms = categoriesResult.recordset.reduce((sum, row) => sum + row.room_count, 0);

  const occupiedByDate = await getOccupiedRoomsByDate(pool, lodgeId, fromDate, toDate);
  const occupancyTrend = dates.map((date) => {
    const occupiedRooms = occupiedByDate.get(date).size;
    return {
      date,
      occupiedRooms,
      totalRooms,
      occupancyPercent: totalRooms > 0 ? round2((occupiedRooms / totalRooms) * 100) : 0,
    };
  });

  const occupiedRoomNights = occupancyTrend.reduce((sum, d) => sum + d.occupiedRooms, 0);
  const totalRoomNights = totalRooms * dates.length;

  const roomRevenueResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('fromDate', sql.Date, fromDate)
    .input('toDate', sql.Date, toDate)
    .query(`
      SELECT SUM(i.room_subtotal + i.cgst_amount + i.sgst_amount) AS revenue
      FROM dbo.invoices i
      WHERE i.lodge_id = @lodgeId AND i.status = 'ISSUED' AND i.event_booking_id IS NULL
        AND i.booking_id IS NOT NULL
        AND CAST(i.created_at AS DATE) BETWEEN @fromDate AND @toDate
    `);
  const roomRevenue = round2(Number(roomRevenueResult.recordset[0].revenue ?? 0));
  const revpar = totalRoomNights > 0 ? round2(roomRevenue / totalRoomNights) : 0;

  const stayStatsResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('fromDate', sql.Date, fromDate)
    .input('toDate', sql.Date, toDate)
    .query(`
      SELECT status, DATEDIFF(day, check_in_date, check_out_date) AS nights
      FROM dbo.bookings
      WHERE lodge_id = @lodgeId AND check_in_date BETWEEN @fromDate AND @toDate
    `);
  let cancelledCount = 0;
  let activeCount = 0;
  let nightsSum = 0;
  // Nights <= 0 (a same-day booking) has no bucket of its own and files
  // under '1' — the shortest stay this histogram distinguishes.
  const losBuckets = { '1': 0, '2': 0, '3': 0, '4+': 0 };
  for (const row of stayStatsResult.recordset) {
    if (row.status === 'CANCELLED') {
      cancelledCount += 1;
      continue;
    }
    activeCount += 1;
    nightsSum += row.nights;
    const bucket = row.nights >= 4 ? '4+' : String(Math.max(1, row.nights));
    losBuckets[bucket] += 1;
  }
  const totalStays = cancelledCount + activeCount;
  const alos = activeCount > 0 ? round2(nightsSum / activeCount) : 0;
  const cancellationRate = totalStays > 0 ? round2((cancelledCount / totalStays) * 100) : 0;
  const losHistogram = ['1', '2', '3', '4+'].map((bucket) => ({ bucket, count: losBuckets[bucket] }));

  // Occupancy by category runs the same per-day overlap loop once per
  // category — categories per lodge number in the single digits, so this
  // stays a handful of queries rather than needing a combined GROUP BY.
  const occupancyByCategory = [];
  for (const cat of categoriesResult.recordset) {
    const catOccupiedByDate = await getOccupiedRoomsByDate(pool, lodgeId, fromDate, toDate, cat.category_id);
    const occupiedNights = dates.reduce((sum, d) => sum + catOccupiedByDate.get(d).size, 0);
    const availableNights = cat.room_count * dates.length;
    occupancyByCategory.push({
      categoryId: cat.category_id,
      categoryName: cat.category_name,
      occupiedNights,
      availableNights,
      occupancyPercent: availableNights > 0 ? round2((occupiedNights / availableNights) * 100) : 0,
    });
  }

  return {
    fromDate,
    toDate,
    generatedAt: new Date().toISOString(),
    revpar,
    alos,
    cancellationRate,
    occupancyTrend,
    losHistogram,
    occupancyByCategory,
  };
}

module.exports = {
  getOccupancyReport,
  getGstSummary,
  getBookingsReport,
  getEventsReport,
  getFoodOrdersReport,
  getAnalyticsOverview,
  getRoomsAnalytics,
  splitAcross,
  billFigures,
  mergeTenders,
  COMPARE_MODES,
};
