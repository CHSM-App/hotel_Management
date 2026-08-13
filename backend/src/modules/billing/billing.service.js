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

// The labelled parts a room charge is made of — base rate, season uplift, each
// switched-on extra — summed across the nights each one applied to. Same shape
// the price simulator produces, so a bill reads back the way the stay was
// quoted instead of collapsing to one figure the guest can only dispute whole.
//
// Read from the booking's own snapshot rather than re-priced: a season edited
// after checkout must not change a bill. Comes back empty for stays booked
// before the lines were snapshotted, and for food bills, which have no room —
// callers fall back to the single "Room charges" line those already showed.
function roomChargeLines(booking) {
  if (!booking.nightly_breakdown) return [];
  let nights;
  try {
    nights = JSON.parse(booking.nightly_breakdown);
  } catch {
    return [];
  }
  if (!Array.isArray(nights)) return [];

  const totals = new Map();
  for (const night of nights) {
    for (const line of night.lines ?? []) {
      const prev = totals.get(line.label) ?? { label: line.label, amount: 0, nights: 0 };
      prev.amount = round2(prev.amount + Number(line.amount));
      prev.nights += 1;
      totals.set(line.label, prev);
    }
  }
  return Array.from(totals.values());
}

async function getGstSlabs(pool) {
  const result = await pool
    .request()
    .query(`
      SELECT max_amount, rate_percent, sac_code FROM dbo.gst_slabs
      WHERE is_active = 1 AND supply_type = 'ACCOMMODATION'
      ORDER BY CASE WHEN max_amount IS NULL THEN 1 ELSE 0 END, max_amount ASC
    `);
  return result.recordset.map((r) => ({
    maxAmount: r.max_amount == null ? null : Number(r.max_amount),
    ratePercent: Number(r.rate_percent),
    sacCode: r.sac_code,
  }));
}

// Food is a flat rate decided by the premises, not banded by the value of the
// meal: 18% with ITC inside specified premises, 5% without outside them. Rows
// rather than a constant for the same reason the accommodation slabs are rows —
// a rate change is an UPDATE, not a deploy.
async function getFoodRate(pool, isSpecifiedPremises) {
  const result = await pool
    .request()
    .input('specified', sql.Bit, isSpecifiedPremises ? 1 : 0)
    .query(`
      SELECT TOP 1 rate_percent, sac_code FROM dbo.gst_slabs
      WHERE is_active = 1 AND supply_type = 'FOOD'
        AND (applies_to_specified IS NULL OR applies_to_specified = @specified)
      ORDER BY CASE WHEN applies_to_specified IS NULL THEN 1 ELSE 0 END
    `);
  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('No food GST rate is configured. Contact Vengurla Tech.', 500);
  }
  return { ratePercent: Number(row.rate_percent), sacCode: row.sac_code };
}

// One rate across the whole food subtotal, so unlike accommodation there's no
// per-line banding to walk. Halved into CGST/SGST and each half rounded
// independently, matching the accommodation rule that exists to keep GSTR-1
// reconciliation clean.
function computeFoodTax(subtotal, ratePercent) {
  const cgstAmount = round2((subtotal * (ratePercent / 100)) / 2);
  const sgstAmount = round2((subtotal * (ratePercent / 100)) / 2);
  return { cgstAmount, sgstAmount, taxable: ratePercent > 0 && subtotal > 0 };
}

// Delivered food that hasn't been put on a bill yet. DELIVERED is the gate on
// purpose — the charge posts when the guest actually receives the food, so a
// cancelled or still-cooking order can never reach a folio.
async function loadUnbilledOrders(request, lodgeId, { bookingId = null, tableId = null }) {
  const scope = bookingId ? 'AND o.booking_id = @bookingId' : 'AND o.table_id = @tableId';
  request.input('lodgeId', sql.BigInt, lodgeId);
  if (bookingId) request.input('bookingId', sql.BigInt, bookingId);
  else request.input('tableId', sql.BigInt, tableId);

  const result = await request.query(`
    SELECT o.id, o.order_number, o.subtotal, o.placed_at, o.source,
           r.room_number, t.label AS table_label
    FROM dbo.food_orders o
    LEFT JOIN dbo.rooms r ON r.id = o.room_id
    LEFT JOIN dbo.dining_tables t ON t.id = o.table_id
    WHERE o.lodge_id = @lodgeId AND o.status = 'DELIVERED' AND o.invoice_id IS NULL ${scope}
    ORDER BY o.placed_at ASC
  `);

  return result.recordset.map((row) => ({
    id: row.id,
    orderNumber: row.order_number,
    subtotal: Number(row.subtotal),
    placedAt: row.placed_at,
    roomNumber: row.room_number,
    tableLabel: row.table_label,
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

// A late checkout charge is part of the accommodation supply, not a penalty
// standing beside it — so it rides on the same SAC as the room and is taxed,
// not added on tax-free after the fact.
//
// The rate is the one the room's *final* night fell in, rather than the band
// the charge itself would land in on its own. GST bands accommodation on the
// nightly tariff, and ₹800 of late checkout on a ₹4,000 room is still a ₹4,000
// room being occupied; billing it at the ₹800 band would understate the tax.
//
// `include` is the billing desk's call. Reception records what was agreed at
// the door, but the bill is written later and by someone else — a manager who
// decides the overstay isn't worth charging drops the line here rather than
// having to send the guest back to the desk. Excluding it zeroes the line for
// this document only; the booking keeps what reception agreed, and the minutes
// behind it, so a waiver at billing stays distinguishable from a guest who
// left on time.
function lateChargeSide(booking, amounts, slabs, isGstSide, include = true) {
  const amount = include ? round2(Number(booking.late_checkout_charge) || 0) : 0;
  if (amount <= 0) {
    return { amount: 0, cgstAmount: 0, sgstAmount: 0, taxable: false, ratePercent: 0 };
  }
  const ratePercent = isGstSide ? ratePercentFor(amounts[amounts.length - 1] ?? 0, slabs) : 0;
  return {
    amount,
    cgstAmount: round2((amount * (ratePercent / 100)) / 2),
    sgstAmount: round2((amount * (ratePercent / 100)) / 2),
    taxable: ratePercent > 0,
    ratePercent,
  };
}

async function loadBookingForBilling(lodgeId, bookingId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT b.*, r.room_number, c.name AS category_name,
             l.is_gst_registered, l.gstin, l.is_specified_premises
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

// A bill can carry two supplies at different rates and on different SACs:
// accommodation (996311, banded by nightly rate) and food (996331, flat by
// premises). They're kept apart all the way to the document because GSTR-1
// reports them separately — only the grand total merges them, and the rounding
// to whole rupees happens once, on that total.
//
// `food` is optional so every existing room-only caller keeps its old shape.
function buildBreakdown(roomSubtotal, cgstAmount, sgstAmount, isGstSide, food = null) {
  const foodSubtotal = food ? round2(food.subtotal) : 0;
  const foodCgst = food ? food.cgstAmount : 0;
  const foodSgst = food ? food.sgstAmount : 0;

  const subtotal = round2(roomSubtotal + foodSubtotal);
  const totalCgst = round2(cgstAmount + foodCgst);
  const totalSgst = round2(sgstAmount + foodSgst);

  const preRound = subtotal + totalCgst + totalSgst;
  const totalAmount = isGstSide ? Math.round(preRound) : round2(preRound);
  const roundOff = round2(totalAmount - preRound);

  return {
    // Accommodation side. Named `subtotal` rather than `roomSubtotal` because
    // every existing caller and the bill document already read it that way.
    subtotal: round2(roomSubtotal),
    cgstAmount,
    sgstAmount,
    cgstRatePercent: ratePercentFromAmount(cgstAmount, roomSubtotal),
    sgstRatePercent: ratePercentFromAmount(sgstAmount, roomSubtotal),

    // Food side, zeroed when there is none.
    foodSubtotal,
    foodCgstAmount: foodCgst,
    foodSgstAmount: foodSgst,
    foodCgstRatePercent: ratePercentFromAmount(foodCgst, foodSubtotal),
    foodSgstRatePercent: ratePercentFromAmount(foodSgst, foodSubtotal),
    foodSacCode: food?.sacCode ?? null,

    combinedSubtotal: subtotal,
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

async function previewBill(lodgeId, bookingId, { includeLateCheckout = true } = {}) {
  const pool = await getPool();
  const booking = await loadBookingForBilling(lodgeId, bookingId);

  if (booking.status !== 'CHECKED_OUT') {
    throw new ApiError('This booking must be checked out before it can be billed.', 409);
  }

  const active = await findActiveInvoice(pool.request(), bookingId);
  const amounts = nightlyAmounts(booking);
  const nightsSubtotal = round2(amounts.reduce((sum, n) => sum + n, 0));
  const slabs = await getGstSlabs(pool);
  const { cgstAmount, sgstAmount, anyTaxable } = computeGstBreakdown(amounts, slabs);

  // Whatever reception agreed at the desk, shown as its own line but carried
  // inside the accommodation subtotal so the SAC and the tax stay correct.
  // Recomputed rather than adjusted client-side when the desk drops it: taking
  // the charge off can move the stay into a lower GST band and change the
  // round-off, so the whole document has to be re-derived, not patched.
  const late = lateChargeSide(booking, amounts, slabs, true, includeLateCheckout);
  const subtotal = round2(nightsSubtotal + late.amount);

  // Anything the guest ate and was served during the stay, not yet billed.
  const foodOrders = await loadUnbilledOrders(pool.request(), lodgeId, { bookingId });
  const food = await buildFoodSide(pool, booking.is_specified_premises, foodOrders);
  const foodItems = await loadFoodItemsForOrders(pool.request(), foodOrders.map((o) => o.id));

  const gst = booking.is_gst_registered
    ? {
        // A stay under the nil threshold is a bill of supply — unless food was
        // served, which is taxable at 5% or 18% regardless of the room rate and
        // therefore makes the whole document a tax invoice.
        documentType: anyTaxable || late.taxable || food?.taxable ? 'TAX_INVOICE' : 'BILL_OF_SUPPLY',
        ...buildBreakdown(
          subtotal,
          round2(cgstAmount + late.cgstAmount),
          round2(sgstAmount + late.sgstAmount),
          true,
          food
        ),
      }
    : null;
  const nonGst = {
    documentType: 'CASH_RECEIPT',
    ...buildBreakdown(subtotal, 0, 0, false, food ? { ...food, cgstAmount: 0, sgstAmount: 0 } : null),
  };

  return {
    bookingId: booking.id,
    guestName: booking.guest_name,
    roomNumber: booking.room_number,
    categoryName: booking.category_name,
    nights: amounts.length,
    // Split out of the accommodation subtotal so the bill can show what the
    // nights cost and what the overstay cost as two separate lines.
    nightsSubtotal,
    // What those nights were made of. Sums to nightsSubtotal, not to the
    // accommodation subtotal — the late charge is its own line beside it.
    roomCharges: roomChargeLines(booking),
    lateCheckoutCharge: late.amount,
    // What reception agreed at checkout, regardless of whether this preview is
    // carrying it. The desk needs the number visible to decide against it —
    // dropping the charge must not also hide what is being dropped.
    lateCheckoutAgreed: round2(Number(booking.late_checkout_charge) || 0),
    includeLateCheckout,
    lateCheckoutMinutes: booking.late_checkout_minutes ?? null,
    advancePaid: booking.advance_amount != null ? Number(booking.advance_amount) : 0,
    isGstRegistered: !!booking.is_gst_registered,
    gstin: booking.gstin,
    foodOrders,
    foodItems,
    gst,
    nonGst,
    alreadyInvoiced: !!active,
  };
}

// The dishes behind a food subtotal, collapsed for the printed bill: a table
// that ordered three thalis across three separate rounds should read as one
// "Fish thali  3 × 300" line, not three identical rows.
//
// Grouped by name *and* unit price, so if an item's price changed between two
// orders they stay on separate lines — each order line snapshots the price it
// was actually sold at, and the bill has to show what was charged.
function groupFoodItems(rows) {
  return rows.map((row) => ({
    name: row.item_name,
    unitPrice: Number(row.unit_price),
    quantity: Number(row.quantity),
    lineTotal: Number(row.line_total),
  }));
}

const FOOD_ITEM_COLUMNS = `
  fi.item_name, fi.unit_price,
  SUM(fi.quantity) AS quantity, SUM(fi.line_total) AS line_total
`;

// Items for orders about to be billed, before any invoice exists.
async function loadFoodItemsForOrders(request, orderIds) {
  if (orderIds.length === 0) return [];
  orderIds.forEach((id, i) => request.input(`fi${i}`, sql.BigInt, id));
  const result = await request.query(`
    SELECT ${FOOD_ITEM_COLUMNS}
    FROM dbo.food_order_items fi
    WHERE fi.order_id IN (${orderIds.map((_, i) => `@fi${i}`).join(', ')})
    GROUP BY fi.item_name, fi.unit_price
    ORDER BY fi.item_name ASC
  `);
  return groupFoodItems(result.recordset);
}

// Items for invoices already issued. Fetched for a whole page of invoices in
// one query rather than per row — the bills list renders the document straight
// from its own payload, so an N+1 here would be a query per bill on screen.
async function loadFoodItemsByInvoice(pool, invoiceIds) {
  if (invoiceIds.length === 0) return new Map();
  const request = pool.request();
  invoiceIds.forEach((id, i) => request.input(`inv${i}`, sql.BigInt, id));
  const result = await request.query(`
    SELECT o.invoice_id, ${FOOD_ITEM_COLUMNS}
    FROM dbo.food_order_items fi
    JOIN dbo.food_orders o ON o.id = fi.order_id
    WHERE o.invoice_id IN (${invoiceIds.map((_, i) => `@inv${i}`).join(', ')})
    GROUP BY o.invoice_id, fi.item_name, fi.unit_price
    ORDER BY fi.item_name ASC
  `);

  const byInvoice = new Map();
  for (const row of result.recordset) {
    const key = String(row.invoice_id);
    const list = byInvoice.get(key) || [];
    list.push(...groupFoodItems([row]));
    byInvoice.set(key, list);
  }
  return byInvoice;
}

// Turns a set of unbilled orders into the food side of a bill, or null when
// there's nothing to charge.
async function buildFoodSide(pool, isSpecifiedPremises, orders) {
  if (orders.length === 0) return null;
  const subtotal = round2(orders.reduce((sum, o) => sum + o.subtotal, 0));
  const { ratePercent, sacCode } = await getFoodRate(pool, isSpecifiedPremises);
  const { cgstAmount, sgstAmount, taxable } = computeFoodTax(subtotal, ratePercent);
  return { subtotal, cgstAmount, sgstAmount, taxable, ratePercent, sacCode };
}

async function issueInvoice(lodgeId, userId, bookingId, input) {
  const pool = await getPool();
  const booking = await loadBookingForBilling(lodgeId, bookingId);

  if (booking.status !== 'CHECKED_OUT') {
    throw new ApiError('This booking must be checked out before it can be billed.', 409);
  }

  const billingSide = booking.is_gst_registered ? input.billingSide || 'GST' : 'NON_GST';

  const amounts = nightlyAmounts(booking);
  const nightsSubtotal = round2(amounts.reduce((sum, n) => sum + n, 0));
  const slabs = await getGstSlabs(pool);

  // Read off the booking, which is where reception's decision was recorded at
  // checkout — never recomputed from the policy here, or a lodge that edited
  // its late-fee percentages would silently restate bills issued last month.
  // Whether it lands on this document at all is the billing desk's call, taken
  // in the preview and posted back with the rest of the bill.
  const late = lateChargeSide(
    booking,
    amounts,
    slabs,
    billingSide === 'GST',
    input.includeLateCheckout !== false
  );
  const subtotal = round2(nightsSubtotal + late.amount);

  const advancePaid = booking.advance_amount != null ? Number(booking.advance_amount) : 0;

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const existing = await findActiveInvoice(new sql.Request(transaction), bookingId);
    if (existing) {
      throw new ApiError('This booking already has an issued bill. Void it before reissuing.', 409);
    }

    // Re-read inside the transaction rather than reusing the preview's list:
    // reception may deliver one more order between opening the bill and
    // issuing it, and the charge belongs on this document, not stranded.
    const foodOrders = await loadUnbilledOrders(new sql.Request(transaction), lodgeId, { bookingId });
    const food = await buildFoodSide(pool, booking.is_specified_premises, foodOrders);

    let documentType;
    let breakdown;
    if (billingSide === 'GST') {
      const { cgstAmount, sgstAmount, anyTaxable } = computeGstBreakdown(amounts, slabs);
      documentType = anyTaxable || late.taxable || food?.taxable ? 'TAX_INVOICE' : 'BILL_OF_SUPPLY';
      breakdown = buildBreakdown(
        subtotal,
        round2(cgstAmount + late.cgstAmount),
        round2(sgstAmount + late.sgstAmount),
        true,
        food
      );
    } else {
      documentType = 'CASH_RECEIPT';
      breakdown = buildBreakdown(subtotal, 0, 0, false, food ? { ...food, cgstAmount: 0, sgstAmount: 0 } : null);
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
      .input('foodSubtotal', sql.Decimal(10, 2), breakdown.foodSubtotal)
      .input('foodCgstAmount', sql.Decimal(10, 2), breakdown.foodCgstAmount)
      .input('foodSgstAmount', sql.Decimal(10, 2), breakdown.foodSgstAmount)
      .input('lateCheckoutCharge', sql.Decimal(10, 2), late.amount)
      .input('createdBy', sql.BigInt, userId ?? null)
      .query(`
        INSERT INTO dbo.invoices
          (lodge_id, booking_id, document_type, billing_side, invoice_number, room_subtotal,
           cgst_amount, sgst_amount, food_subtotal, food_cgst_amount, food_sgst_amount,
           late_checkout_charge, round_off, total_amount, advance_paid, balance_collected,
           balance_payment_method, created_by)
        OUTPUT inserted.id
        VALUES
          (@lodgeId, @bookingId, @documentType, @billingSide, @invoiceNumber, @roomSubtotal,
           @cgstAmount, @sgstAmount, @foodSubtotal, @foodCgstAmount, @foodSgstAmount,
           @lateCheckoutCharge, @roundOff, @totalAmount, @advancePaid, @balanceCollected,
           @balancePaymentMethod, @createdBy)
      `);

    const invoiceId = inserted.recordset[0].id;

    // Stamping the orders is what stops them being billed twice — a later
    // "close table" or reissue skips anything already carrying an invoice_id.
    if (foodOrders.length > 0) {
      const stampRequest = new sql.Request(transaction).input('invoiceId', sql.BigInt, invoiceId);
      foodOrders.forEach((o, i) => stampRequest.input(`fo${i}`, sql.BigInt, o.id));
      await stampRequest.query(`
        UPDATE dbo.food_orders SET invoice_id = @invoiceId
        WHERE id IN (${foodOrders.map((_, i) => `@fo${i}`).join(', ')})
      `);
    }

    await transaction.commit();
    return getInvoice(lodgeId, invoiceId);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

// Dates come back NULL on a food-only bill, so they're formatted defensively —
// the previous unconditional .toISOString() would have thrown on the first
// restaurant invoice ever listed.
function isoDate(value) {
  if (!value) return null;
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function mapInvoice(row) {
  const roomSubtotal = Number(row.room_subtotal);
  const foodSubtotal = Number(row.food_subtotal ?? 0);
  const foodCgst = Number(row.food_cgst_amount ?? 0);
  const foodSgst = Number(row.food_sgst_amount ?? 0);

  return {
    id: row.id,
    bookingId: row.booking_id,
    // A bill is a food bill when no stay backs it. The screen and the printed
    // document both branch on this rather than sniffing at null fields.
    kind: row.booking_id == null ? 'FOOD' : 'STAY',
    tableLabel: row.table_label ?? null,
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    numGuests: row.num_guests,
    roomNumber: row.room_number,
    categoryName: row.category_name,
    checkInDate: isoDate(row.check_in_date),
    checkOutDate: isoDate(row.check_out_date),
    actualCheckInAt: row.actual_check_in_at,
    actualCheckOutAt: row.actual_check_out_at,
    documentType: row.document_type,
    billingSide: row.billing_side,
    invoiceNumber: row.invoice_number,
    roomSubtotal,
    // Carried inside roomSubtotal for tax purposes, but reported separately so
    // the printed bill can show the nights and the overstay as two lines.
    lateCheckoutCharge: Number(row.late_checkout_charge ?? 0),
    nightsSubtotal: round2(roomSubtotal - Number(row.late_checkout_charge ?? 0)),
    // Aggregated here rather than shipping the raw per-night snapshot: the list
    // renders the printed document straight from this payload, and three
    // label/amount pairs per bill cost far less than every night's JSON.
    roomCharges: roomChargeLines(row),
    lateCheckoutMinutes: row.late_checkout_minutes ?? null,
    cgstAmount: Number(row.cgst_amount),
    sgstAmount: Number(row.sgst_amount),
    cgstRatePercent: ratePercentFromAmount(Number(row.cgst_amount), roomSubtotal),
    sgstRatePercent: ratePercentFromAmount(Number(row.sgst_amount), roomSubtotal),
    foodSubtotal,
    foodCgstAmount: foodCgst,
    foodSgstAmount: foodSgst,
    foodCgstRatePercent: ratePercentFromAmount(foodCgst, foodSubtotal),
    foodSgstRatePercent: ratePercentFromAmount(foodSgst, foodSubtotal),
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
      SELECT i.*, dt.label AS table_label, b.guest_name, b.guest_phone, b.num_guests, b.check_in_date, b.check_out_date,
             b.actual_check_in_at, b.actual_check_out_at, b.late_checkout_minutes,
             b.nightly_breakdown,
             r.room_number, c.name AS category_name,
             l.gstin, l.is_gst_registered, l.name AS lodge_name,
             l.phone AS lodge_phone, l.address AS lodge_address, l.city AS lodge_city, l.state AS lodge_state
      FROM dbo.invoices i
      -- LEFT, because a restaurant bill has no stay behind it. An inner join
      -- here silently hid every food-only invoice from the list and the detail.
      LEFT JOIN dbo.bookings b ON b.id = i.booking_id
      LEFT JOIN dbo.rooms r ON r.id = b.room_id
      LEFT JOIN dbo.room_categories c ON c.id = r.category_id
      LEFT JOIN dbo.dining_tables dt ON dt.id = i.table_id
      JOIN dbo.lodges l ON l.id = i.lodge_id
      WHERE i.id = @invoiceId AND i.lodge_id = @lodgeId
    `);
  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('Bill not found.', 404);
  }
  const items = await loadFoodItemsByInvoice(pool, [invoiceId]);
  return { ...mapInvoice(row), foodItems: items.get(String(invoiceId)) || [] };
}

async function listInvoices(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT TOP 200 i.*, dt.label AS table_label, b.guest_name, b.guest_phone, b.num_guests, b.check_in_date, b.check_out_date,
             b.actual_check_in_at, b.actual_check_out_at, b.late_checkout_minutes,
             b.nightly_breakdown,
             r.room_number, c.name AS category_name,
             l.gstin, l.is_gst_registered, l.name AS lodge_name,
             l.phone AS lodge_phone, l.address AS lodge_address, l.city AS lodge_city, l.state AS lodge_state
      FROM dbo.invoices i
      -- LEFT, because a restaurant bill has no stay behind it. An inner join
      -- here silently hid every food-only invoice from the list and the detail.
      LEFT JOIN dbo.bookings b ON b.id = i.booking_id
      LEFT JOIN dbo.rooms r ON r.id = b.room_id
      LEFT JOIN dbo.room_categories c ON c.id = r.category_id
      LEFT JOIN dbo.dining_tables dt ON dt.id = i.table_id
      JOIN dbo.lodges l ON l.id = i.lodge_id
      WHERE i.lodge_id = @lodgeId
      ORDER BY i.created_at DESC
    `);

  // The bills list renders the printed document straight from this payload, so
  // the item lines have to travel with it — fetched for the whole page in one
  // query rather than one per bill.
  const invoices = result.recordset.map(mapInvoice);
  const items = await loadFoodItemsByInvoice(pool, invoices.filter((i) => i.foodSubtotal > 0).map((i) => i.id));
  return invoices.map((invoice) => ({
    ...invoice,
    foodItems: items.get(String(invoice.id)) || [],
  }));
}

async function voidInvoice(lodgeId, invoiceId, reason) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await new sql.Request(transaction)
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

    // Release the food back to unbilled. A void that left orders stamped would
    // silently destroy the charge: the reissued bill wouldn't pick them up and
    // the table would never be asked to pay for what it ate. The invoice row
    // itself stays put — issued documents are voided in place, never deleted.
    await new sql.Request(transaction)
      .input('invoiceId', sql.BigInt, invoiceId)
      .query('UPDATE dbo.food_orders SET invoice_id = NULL WHERE invoice_id = @invoiceId');

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  return getInvoice(lodgeId, invoiceId);
}

// ---------------------------------------------------------------------------
// Food bills — a closed table, or counter orders with no stay behind them
// ---------------------------------------------------------------------------

// Every table (and the counter) currently holding delivered, unbilled food.
// This is the restaurant's equivalent of the checked-out-and-unbilled queue:
// what's waiting to be paid for.
async function listOpenFoodTabs(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT o.table_id, t.label AS table_label,
             COUNT(*) AS order_count, SUM(o.subtotal) AS subtotal,
             MIN(o.placed_at) AS opened_at, MAX(o.delivered_at) AS last_delivered_at
      FROM dbo.food_orders o
      LEFT JOIN dbo.dining_tables t ON t.id = o.table_id
      WHERE o.lodge_id = @lodgeId AND o.status = 'DELIVERED' AND o.invoice_id IS NULL
        -- Room-service food is not settled here; it rides on the stay's bill at
        -- checkout, so it must not also appear as an open tab.
        AND o.booking_id IS NULL
      GROUP BY o.table_id, t.label
      ORDER BY MIN(o.placed_at) ASC
    `);

  return result.recordset.map((row) => ({
    tableId: row.table_id,
    // Counter orders have no table; they're grouped together under one tab.
    tableLabel: row.table_label || 'Counter / takeaway',
    orderCount: row.order_count,
    subtotal: Number(row.subtotal),
    openedAt: row.opened_at,
    lastDeliveredAt: row.last_delivered_at,
  }));
}

async function loadLodgeForBilling(pool, lodgeId) {
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query('SELECT is_gst_registered, gstin, is_specified_premises FROM dbo.lodges WHERE id = @lodgeId');
  const row = result.recordset[0];
  if (!row) throw new ApiError('Lodge not found.', 404);
  return row;
}

// tableId null means the counter tab.
async function loadUnbilledTabOrders(request, lodgeId, tableId) {
  request.input('lodgeId', sql.BigInt, lodgeId);
  const scope = tableId == null ? 'AND o.table_id IS NULL' : 'AND o.table_id = @tableId';
  if (tableId != null) request.input('tableId', sql.BigInt, tableId);

  const result = await request.query(`
    SELECT o.id, o.order_number, o.subtotal, o.placed_at, t.label AS table_label
    FROM dbo.food_orders o
    LEFT JOIN dbo.dining_tables t ON t.id = o.table_id
    WHERE o.lodge_id = @lodgeId AND o.status = 'DELIVERED' AND o.invoice_id IS NULL
      AND o.booking_id IS NULL ${scope}
    ORDER BY o.placed_at ASC
  `);

  return result.recordset.map((row) => ({
    id: row.id,
    orderNumber: row.order_number,
    subtotal: Number(row.subtotal),
    placedAt: row.placed_at,
    tableLabel: row.table_label,
  }));
}

async function previewFoodBill(lodgeId, tableId) {
  const pool = await getPool();
  const lodge = await loadLodgeForBilling(pool, lodgeId);
  const orders = await loadUnbilledTabOrders(pool.request(), lodgeId, tableId);

  if (orders.length === 0) {
    throw new ApiError('Nothing to bill here — no delivered orders are waiting.', 409);
  }

  const food = await buildFoodSide(pool, lodge.is_specified_premises, orders);
  const foodItems = await loadFoodItemsForOrders(pool.request(), orders.map((o) => o.id));

  const gst = lodge.is_gst_registered
    ? {
        // Food is always taxable, so a GST-registered restaurant always issues
        // a tax invoice — there's no nil band to fall through to a bill of
        // supply the way a cheap room night does.
        documentType: 'TAX_INVOICE',
        ...buildBreakdown(0, 0, 0, true, food),
      }
    : null;
  const nonGst = {
    documentType: 'CASH_RECEIPT',
    ...buildBreakdown(0, 0, 0, false, { ...food, cgstAmount: 0, sgstAmount: 0 }),
  };

  return {
    tableId: tableId ?? null,
    tableLabel: orders[0].tableLabel || 'Counter / takeaway',
    orders,
    foodItems,
    isGstRegistered: !!lodge.is_gst_registered,
    gstin: lodge.gstin,
    gst,
    nonGst,
  };
}

// Closes a table: sweeps every delivered, unbilled order on it into one
// document and stamps them so a second close can't bill them again.
async function issueFoodInvoice(lodgeId, userId, tableId, input) {
  const pool = await getPool();
  const lodge = await loadLodgeForBilling(pool, lodgeId);
  const billingSide = lodge.is_gst_registered ? input.billingSide || 'GST' : 'NON_GST';

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    // Read inside the transaction: two staff closing the same table at once
    // must not produce two bills for the same food.
    const orders = await loadUnbilledTabOrders(new sql.Request(transaction), lodgeId, tableId);
    if (orders.length === 0) {
      throw new ApiError('Nothing to bill here — no delivered orders are waiting.', 409);
    }

    const food = await buildFoodSide(pool, lodge.is_specified_premises, orders);

    const documentType = billingSide === 'GST' ? 'TAX_INVOICE' : 'CASH_RECEIPT';
    const breakdown =
      billingSide === 'GST'
        ? buildBreakdown(0, 0, 0, true, food)
        : buildBreakdown(0, 0, 0, false, { ...food, cgstAmount: 0, sgstAmount: 0 });

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

    // Same series as room bills on purpose: GST wants one continuous invoice
    // sequence per registration, not a separate run per revenue stream.
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

    const inserted = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('tableId', sql.BigInt, tableId ?? null)
      .input('documentType', sql.NVarChar, documentType)
      .input('billingSide', sql.NVarChar, billingSide)
      .input('invoiceNumber', sql.NVarChar, `${prefix}${number}`)
      .input('foodSubtotal', sql.Decimal(10, 2), breakdown.foodSubtotal)
      .input('foodCgstAmount', sql.Decimal(10, 2), breakdown.foodCgstAmount)
      .input('foodSgstAmount', sql.Decimal(10, 2), breakdown.foodSgstAmount)
      .input('roundOff', sql.Decimal(10, 2), breakdown.roundOff)
      .input('totalAmount', sql.Decimal(10, 2), breakdown.totalAmount)
      .input('balanceCollected', sql.Decimal(10, 2), input.collectedAmount ?? 0)
      .input('balancePaymentMethod', sql.NVarChar, input.paymentMethod ?? null)
      .input('createdBy', sql.BigInt, userId ?? null)
      .query(`
        INSERT INTO dbo.invoices
          (lodge_id, booking_id, table_id, document_type, billing_side, invoice_number,
           room_subtotal, cgst_amount, sgst_amount,
           food_subtotal, food_cgst_amount, food_sgst_amount,
           round_off, total_amount, advance_paid, balance_collected,
           balance_payment_method, created_by)
        OUTPUT inserted.id
        VALUES
          (@lodgeId, NULL, @tableId, @documentType, @billingSide, @invoiceNumber,
           0, 0, 0,
           @foodSubtotal, @foodCgstAmount, @foodSgstAmount,
           @roundOff, @totalAmount, 0, @balanceCollected,
           @balancePaymentMethod, @createdBy)
      `);

    const invoiceId = inserted.recordset[0].id;

    const stampRequest = new sql.Request(transaction).input('invoiceId', sql.BigInt, invoiceId);
    orders.forEach((o, i) => stampRequest.input(`fo${i}`, sql.BigInt, o.id));
    await stampRequest.query(`
      UPDATE dbo.food_orders SET invoice_id = @invoiceId
      WHERE id IN (${orders.map((_, i) => `@fo${i}`).join(', ')}) AND invoice_id IS NULL
    `);

    await transaction.commit();
    return getInvoice(lodgeId, invoiceId);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

module.exports = {
  listBillableBookings,
  previewBill,
  issueInvoice,
  getInvoice,
  listInvoices,
  voidInvoice,
  listOpenFoodTabs,
  previewFoodBill,
  issueFoodInvoice,
};
