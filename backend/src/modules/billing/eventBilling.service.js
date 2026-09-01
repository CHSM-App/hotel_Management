const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const { toClockTime } = require('../rooms/checkoutPolicy.service');
const {
  round2,
  taxWithin,
  getFoodRate,
  computeFoodTax,
  buildBreakdown,
  solveDiscountForTarget,
  insertPaymentLines,
  getInvoice,
  findActiveEventInvoice,
} = require('./billing.service');
const { paymentLinesOf } = require('../bookings/bookings.schema');
const eventsService = require('../events/events.service');
const { priceEvent } = require('../events/eventPricing');

// The final bill for a function.
//
// Same document, same series, same arithmetic as a stay's bill — what differs
// is what sits on it. The venue side (hall hire plus everything sold with it)
// rides in the invoice's room_subtotal column on SAC 997212 at a flat rate;
// the catering rides in food_subtotal on the food rate. buildBreakdown
// apportions a discount across the two and derives the printed rates exactly
// as it does for a stay with a restaurant tab, so nothing below re-invents
// the tax. See migration 046 for why the columns keep their old names.

// Hall hire is a flat rate, not banded like accommodation: one row, read the
// way the food rate is.
async function getVenueRate(pool) {
  const result = await pool.request().query(`
    SELECT TOP 1 rate_percent, sac_code FROM dbo.gst_slabs
    WHERE is_active = 1 AND supply_type = 'VENUE'
    ORDER BY id
  `);
  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('No venue GST rate is configured. Contact Vengurla Tech.', 500);
  }
  return { ratePercent: Number(row.rate_percent), sacCode: row.sac_code };
}

async function loadEventForBilling(lodgeId, eventBookingId, request = null) {
  const req = request ?? (await getPool()).request();
  const result = await req
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('eventId', sql.BigInt, eventBookingId)
    .query(`
      SELECT e.*, v.name AS venue_name,
             l.is_gst_registered, l.gstin, l.is_specified_premises, l.checkin_mode, l.check_out_time,
             l.name AS lodge_name, l.phone AS lodge_phone, l.address AS lodge_address,
             l.name_mr AS lodge_name_mr, l.address_mr AS lodge_address_mr,
             l.city AS lodge_city, l.state AS lodge_state,
             (SELECT STRING_AGG(ar.receipt_number, ', ') WITHIN GROUP (ORDER BY ar.id)
              FROM dbo.advance_receipts ar
              WHERE ar.event_booking_id = e.id AND ar.status = 'ISSUED') AS advance_receipt_numbers,
             (SELECT a.label, a.quantity, a.unit_amount AS unitAmount, a.agreed_amount AS agreedAmount,
                     a.is_extra AS isExtra, a.needs_pricing AS needsPricing
              FROM dbo.event_booking_addons a WHERE a.event_booking_id = e.id ORDER BY a.id
              FOR JSON PATH) AS addons_json
      FROM dbo.event_bookings e
      JOIN dbo.event_venues v ON v.id = e.venue_id
      JOIN dbo.lodges l ON l.id = e.lodge_id
      WHERE e.id = @eventId AND e.lodge_id = @lodgeId
    `);
  const row = result.recordset[0];
  if (!row) throw new ApiError('Event booking not found.', 404);
  return row;
}

function addonsOf(row) {
  try {
    return JSON.parse(row.addons_json || '[]');
  } catch {
    return [];
  }
}

// The function re-priced from what is on it now — the final head count where
// it was given, the guarantee as the floor — and then taxed. Pure once the
// rates are in hand, which is what lets the target-total search below run
// without a query per turn.
function priceEventBill(row, { discountAmount, venueRate, foodRate }) {
  const pricing = priceEvent({
    venueCharge: Number(row.venue_charge),
    perPlateRate: Number(row.per_plate_rate),
    expectedPax: Number(row.expected_pax),
    guaranteedPax: Number(row.guaranteed_pax),
    finalPax: row.final_pax,
    addons: addonsOf(row),
    // The concession agreed at quoting is already inside the booking's own
    // total; the bill takes the desk's discount on top of that, the way a
    // stay's bill does. Re-applied here so the document shows it as one line.
    discountAmount: 0,
  });
  const venueGross = pricing.venueSubtotal;
  const cateringGross = pricing.cateringAmount;
  const grossSubtotal = round2(venueGross + cateringGross);
  const quotedDiscount = round2(Number(row.discount_amount) || 0);
  const discount = round2(Math.min(Math.max(Number(discountAmount) || 0, 0) + quotedDiscount, grossSubtotal));

  const sideFor = (isGstSide) => {
    // Push the discount down onto the two parts before taxing each, as the
    // stay bill does — GST is on the transaction value.
    const share = (part) => (grossSubtotal > 0 ? round2(part - (discount * part) / grossSubtotal) : part);
    const venueNet = share(venueGross);
    const cateringNet = share(cateringGross);
    const venueTax = isGstSide
      ? { cgst: round2(taxWithin(venueNet, venueRate.ratePercent) / 2), sgst: round2(taxWithin(venueNet, venueRate.ratePercent) / 2) }
      : { cgst: 0, sgst: 0 };
    const cateringTax = isGstSide && cateringGross > 0 ? computeFoodTax(cateringNet, foodRate.ratePercent) : { cgstAmount: 0, sgstAmount: 0 };
    const breakdown = buildBreakdown({
      roomSubtotal: venueGross,
      cgstAmount: venueTax.cgst,
      sgstAmount: venueTax.sgst,
      isGstSide,
      food:
        cateringGross > 0
          ? { subtotal: cateringGross, cgstAmount: cateringTax.cgstAmount, sgstAmount: cateringTax.sgstAmount, sacCode: foodRate.sacCode }
          : null,
      discountAmount: discount,
    });
    const taxable = isGstSide && (venueTax.cgst + venueTax.sgst + cateringTax.cgstAmount + cateringTax.sgstAmount) > 0;
    return {
      ...breakdown,
      documentType: isGstSide ? (taxable ? 'TAX_INVOICE' : 'BILL_OF_SUPPLY') : 'CASH_RECEIPT',
      venueSacCode: venueRate.sacCode,
    };
  };

  return {
    pricing,
    grossSubtotal,
    discount,
    quotedDiscount,
    gst: row.is_gst_registered ? sideFor(true) : null,
    nonGst: sideFor(false),
  };
}

// The lines the document itemises under the venue heading, in the shape the
// stay bill's roomCharges already prints.
function eventChargeLines(pricing) {
  return pricing.lines
    .filter((line) => line.side === 'VENUE')
    .map((line) => ({ label: line.quantity > 1 ? `${line.label} × ${line.quantity}` : line.label, amount: line.amount, nights: 1 }));
}

// Catering as an itemised "food" line, so the same table that prints a
// restaurant tab prints the plates.
function cateringItems(pricing) {
  const line = pricing.lines.find((l) => l.side === 'FOOD');
  if (!line || line.amount <= 0) return [];
  return [{ name: 'Catering (per plate)', quantity: line.quantity, unitPrice: line.unitAmount, lineTotal: line.amount }];
}

function isoInstant(value) {
  return value == null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// The document as it will print, in mapInvoice's field names so BillDocument
// renders preview and bill alike. Kind EVENT: the document swaps its register
// strip for the function's own facts.
function buildEventPreviewDocument({ row, side, billingSide, pricing, discountReason }) {
  return {
    kind: 'EVENT',
    eventBookingId: row.id,
    eventTitle: row.title,
    eventType: row.event_type,
    venueName: row.venue_name,
    eventStartAt: isoInstant(row.start_at),
    eventEndAt: isoInstant(row.end_at),
    tableLabel: null,
    invoiceNumber: null,
    createdAt: null,
    status: 'PREVIEW',
    documentType: side.documentType,
    billingSide,
    lodgeName: row.lodge_name,
    lodgePhone: row.lodge_phone,
    lodgeAddress: row.lodge_address,
    lodgeNameMr: row.lodge_name_mr ?? null,
    lodgeAddressMr: row.lodge_address_mr ?? null,
    lodgeCity: row.lodge_city,
    lodgeState: row.lodge_state,
    gstin: row.gstin,
    isGstRegistered: !!row.is_gst_registered,
    checkinMode: row.checkin_mode ?? null,
    checkOutTime: toClockTime(row.check_out_time),
    guestName: row.organiser_name,
    guestPhone: row.organiser_phone,
    numGuests: pricing.billablePax,
    roomNumber: null,
    categoryName: null,
    checkInDate: null,
    checkOutDate: null,
    actualCheckInAt: null,
    actualCheckOutAt: null,
    lateCheckoutMinutes: null,
    roomSubtotal: side.subtotal,
    lateCheckoutCharge: 0,
    nightsSubtotal: side.subtotal,
    roomCharges: eventChargeLines(pricing),
    venueSacCode: side.venueSacCode,
    cgstAmount: side.cgstAmount,
    sgstAmount: side.sgstAmount,
    cgstRatePercent: side.cgstRatePercent,
    sgstRatePercent: side.sgstRatePercent,
    roomTaxable: side.roomTaxable,
    foodSubtotal: side.foodSubtotal,
    foodCgstAmount: side.foodCgstAmount,
    foodSgstAmount: side.foodSgstAmount,
    foodCgstRatePercent: side.foodCgstRatePercent,
    foodSgstRatePercent: side.foodSgstRatePercent,
    foodTaxable: side.foodTaxable,
    foodItems: cateringItems(pricing),
    discountAmount: side.discountAmount,
    discountPercent: side.discountPercent,
    discountReason,
    roundOff: side.roundOff,
    totalAmount: side.totalAmount,
    advancePaid: row.advance_amount != null ? Number(row.advance_amount) : 0,
    advanceReceiptNumbers: row.advance_receipt_numbers || null,
    balanceCollected: 0,
    balancePaymentMethod: null,
    balanceReference: null,
    paymentLines: [],
    voidReason: null,
  };
}

// Extras the desk noted on the day, for the bill to remind them of — and
// the ones still without a price, which the bill will not issue over.
function extrasOf(row) {
  return addonsOf(row)
    .filter((a) => a.isExtra)
    .map((a) => ({ label: a.label, quantity: Number(a.quantity), amount: Number(a.agreedAmount), needsPricing: Boolean(a.needsPricing) }));
}

function assertBillable(row) {
  if (row.status === 'SETTLED') {
    throw new ApiError('This function already has an issued bill. Void it before reissuing.', 409);
  }
  if (row.status !== 'CONFIRMED') {
    throw new ApiError('Confirm the function before billing it.', 409);
  }
  const unpriced = extrasOf(row).filter((a) => a.needsPricing);
  if (unpriced.length > 0) {
    const list = unpriced.map((a) => (a.quantity > 1 ? `${a.label} × ${a.quantity}` : a.label)).join(', ');
    throw new ApiError(`Price the extras noted on the day before billing: ${list}. Open the function to set them.`, 409);
  }
}

async function previewEventBill(lodgeId, eventBookingId, { discountAmount = 0, targetTotal = 0, discountReason = null } = {}) {
  const pool = await getPool();
  const row = await loadEventForBilling(lodgeId, eventBookingId);
  assertBillable(row);
  const active = await findActiveEventInvoice(pool.request(), lodgeId, eventBookingId);

  const venueRate = await getVenueRate(pool);
  const foodRate = await getFoodRate(pool, !!row.is_specified_premises);
  const advancePaid = row.advance_amount != null ? Number(row.advance_amount) : 0;

  let applied = discountAmount;
  let targetAchieved = null;
  if (targetTotal > 0) {
    const priced = (d) => priceEventBill(row, { discountAmount: d, venueRate, foodRate });
    const sideOf = (b) => b.gst ?? b.nonGst;
    const payable = (d) => round2(sideOf(priced(d)).totalAmount - advancePaid);
    const solved = solveDiscountForTarget(targetTotal, sideOf(priced(0)).grossSubtotal, payable);
    applied = solved.discount;
    targetAchieved = solved.achieved;
  }

  const bill = priceEventBill(row, { discountAmount: applied, venueRate, foodRate });
  const billingSide = row.is_gst_registered ? 'GST' : 'NON_GST';
  const desk = round2(bill.discount - bill.quotedDiscount);

  return {
    eventBookingId: row.id,
    guestName: row.organiser_name,
    eventTitle: row.title,
    venueName: row.venue_name,
    billablePax: bill.pricing.billablePax,
    roomCharges: eventChargeLines(bill.pricing),
    // The stay-bill fields the billing screen reads, so one modal serves both.
    nightsSubtotal: bill.gst?.subtotal ?? bill.nonGst.subtotal,
    lateCheckoutCharge: 0,
    lateCheckoutAgreed: 0,
    includeLateCheckout: false,
    lateCheckoutMinutes: null,
    earlyCheckout: null,
    discountBase: bill.grossSubtotal,
    // What the desk is taking off on this bill, on top of the concession
    // already agreed when the function was quoted.
    discountAmount: desk,
    quotedDiscount: bill.quotedDiscount,
    targetAchieved,
    advancePaid,
    advanceReceiptNumbers: row.advance_receipt_numbers || null,
    // What was asked for on the day, so the biller sees it named rather
    // than buried among the quoted add-ons.
    extrasOnDay: extrasOf(row),
    isGstRegistered: !!row.is_gst_registered,
    gstin: row.gstin,
    foodOrders: [],
    foodItems: cateringItems(bill.pricing),
    gst: bill.gst,
    nonGst: bill.nonGst,
    document: buildEventPreviewDocument({
      row,
      side: bill.gst ?? bill.nonGst,
      billingSide,
      pricing: bill.pricing,
      discountReason: bill.discount > 0 ? discountReason ?? row.discount_reason ?? null : null,
    }),
    alreadyInvoiced: !!active,
  };
}

async function issueEventInvoice(lodgeId, userId, eventBookingId, input) {
  const pool = await getPool();
  const venueRate = await getVenueRate(pool);
  const paymentLines = paymentLinesOf(input, input.collectedAmount ?? 0);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const row = await loadEventForBilling(lodgeId, eventBookingId, new sql.Request(transaction));
    assertBillable(row);
    const existing = await findActiveEventInvoice(new sql.Request(transaction), lodgeId, eventBookingId);
    if (existing) {
      throw new ApiError('This function already has an issued bill. Void it before reissuing.', 409);
    }

    const billingSide = row.is_gst_registered ? input.billingSide || 'GST' : 'NON_GST';
    const foodRate = await getFoodRate(pool, !!row.is_specified_premises);
    const bill = priceEventBill(row, { discountAmount: input.discountAmount ?? 0, venueRate, foodRate });
    const side = billingSide === 'GST' ? bill.gst : bill.nonGst;
    const { documentType, ...breakdown } = side;
    const advancePaid = row.advance_amount != null ? Number(row.advance_amount) : 0;

    const seriesType = billingSide;
    const seriesResult = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('seriesType', sql.NVarChar, seriesType)
      .query('SELECT id FROM dbo.invoice_series WHERE lodge_id = @lodgeId AND series_type = @seriesType');
    if (seriesResult.recordset.length === 0) {
      await new sql.Request(transaction)
        .input('lodgeId', sql.BigInt, lodgeId)
        .input('seriesType', sql.NVarChar, seriesType)
        .query("INSERT INTO dbo.invoice_series (lodge_id, series_type, prefix, next_number) VALUES (@lodgeId, @seriesType, N'', 1)");
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

    const inserted = await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('eventId', sql.BigInt, eventBookingId)
      .input('documentType', sql.NVarChar, documentType)
      .input('billingSide', sql.NVarChar, billingSide)
      .input('invoiceNumber', sql.NVarChar, `${prefix}${number}`)
      .input('roomSubtotal', sql.Decimal(10, 2), breakdown.subtotal)
      .input('cgstAmount', sql.Decimal(10, 2), breakdown.cgstAmount)
      .input('sgstAmount', sql.Decimal(10, 2), breakdown.sgstAmount)
      .input('foodSubtotal', sql.Decimal(10, 2), breakdown.foodSubtotal)
      .input('foodCgstAmount', sql.Decimal(10, 2), breakdown.foodCgstAmount)
      .input('foodSgstAmount', sql.Decimal(10, 2), breakdown.foodSgstAmount)
      .input('roundOff', sql.Decimal(10, 2), breakdown.roundOff)
      .input('totalAmount', sql.Decimal(10, 2), breakdown.totalAmount)
      .input('advancePaid', sql.Decimal(10, 2), advancePaid)
      .input('balanceCollected', sql.Decimal(10, 2), input.collectedAmount ?? 0)
      .input('balancePaymentMethod', sql.NVarChar, paymentLines[0]?.method ?? null)
      .input('balanceReference', sql.NVarChar, paymentLines[0]?.reference ?? null)
      .input('discountAmount', sql.Decimal(10, 2), breakdown.discountAmount)
      .input('discountPercent', sql.Decimal(5, 2), breakdown.discountPercent)
      .input('discountReason', sql.NVarChar(100), breakdown.discountAmount > 0 ? input.discountReason ?? row.discount_reason ?? null : null)
      .input('createdBy', sql.BigInt, userId ?? null)
      .query(`
        INSERT INTO dbo.invoices
          (lodge_id, booking_id, event_booking_id, document_type, billing_side, invoice_number, room_subtotal,
           cgst_amount, sgst_amount, food_subtotal, food_cgst_amount, food_sgst_amount,
           discount_amount, discount_percent, discount_reason, round_off, total_amount,
           advance_paid, balance_collected, balance_payment_method, balance_reference, created_by)
        OUTPUT inserted.id
        VALUES
          (@lodgeId, NULL, @eventId, @documentType, @billingSide, @invoiceNumber, @roomSubtotal,
           @cgstAmount, @sgstAmount, @foodSubtotal, @foodCgstAmount, @foodSgstAmount,
           @discountAmount, @discountPercent, @discountReason, @roundOff, @totalAmount,
           @advancePaid, @balanceCollected, @balancePaymentMethod, @balanceReference, @createdBy)
      `);
    const invoiceId = inserted.recordset[0].id;
    await insertPaymentLines(transaction, lodgeId, { invoiceId }, paymentLines);
    // The bill settles the function, on the same transaction: no bill without
    // the status moving, no status moving without the bill.
    await eventsService.markSettled(transaction, lodgeId, eventBookingId);
    await transaction.commit();
    return getInvoice(lodgeId, invoiceId);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

module.exports = {
  getVenueRate,
  loadEventForBilling,
  priceEventBill,
  previewEventBill,
  issueEventInvoice,
  eventChargeLines,
  cateringItems,
};
