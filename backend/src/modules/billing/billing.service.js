const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const { toClockTime } = require('../rooms/checkoutPolicy.service');

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
// `amount` and `amounts` are both post-discount: a bill-level discount reduces
// what was actually charged, and GST is due on that, not on the sticker price.
function lateChargeTax(amount, amounts, slabs, isGstSide) {
  if (amount <= 0 || !isGstSide) {
    return { cgstAmount: 0, sgstAmount: 0, taxable: false, ratePercent: 0 };
  }
  const ratePercent = ratePercentFor(amounts[amounts.length - 1] ?? 0, slabs);
  return {
    cgstAmount: round2((amount * (ratePercent / 100)) / 2),
    sgstAmount: round2((amount * (ratePercent / 100)) / 2),
    taxable: ratePercent > 0,
    ratePercent,
  };
}

// A discount is agreed on the whole bill, but tax isn't computed on the whole
// bill: a stay is banded night by night on its own rate and food is taxed flat
// on its own subtotal. So the reduction has to be pushed back down onto the
// parts before either is worked out — each part gives up its own share of the
// discount in proportion to its size.
//
// Pushing it down rather than subtracting it from the grand total is what
// makes the document defensible. GST is charged on the transaction value, so a
// night discounted below a slab boundary is genuinely taxed in the lower band
// and a discounted food line is genuinely taxed on less. Subtracting after tax
// would over-collect from the guest and over-report to GSTR-1.
//
// Rounding drift lands on the largest part, which is always big enough to
// absorb it — parking it on "the last one" would go negative on a bill whose
// last part is a ₹0 food side.
function netOfDiscount(amounts, discount, gross) {
  if (discount <= 0 || gross <= 0) return amounts.map(round2);

  const shares = amounts.map((amount) => round2((discount * amount) / gross));
  const drift = round2(discount - shares.reduce((sum, share) => sum + share, 0));
  if (drift !== 0) {
    let biggest = 0;
    amounts.forEach((amount, index) => {
      if (amount > amounts[biggest]) biggest = index;
    });
    shares[biggest] = round2(shares[biggest] + drift);
  }
  return amounts.map((amount, index) => round2(amount - shares[index]));
}

// What the desk asked to take off, held to what there is to take it off.
function cappedDiscount(requested, gross) {
  const amount = Number(requested);
  return round2(Math.min(Math.max(Number.isFinite(amount) ? amount : 0, 0), gross));
}

// The desk decides what the guest hands over — "make it ₹1,500" — and this
// works out the discount that lands there.
//
// It has to be searched rather than calculated. GST bands accommodation per
// night, so taking money off can move a night into a lower slab and change its
// rate; and the GST-side total is rounded to whole rupees. `payable` is
// therefore a non-increasing STEP function of the discount, with no inverse to
// compute — only a boundary to find.
//
// Bisected over integer paise, which both avoids float drift and bounds the
// loop at ~log2(gross × 100) — under 25 turns for any bill this system will
// ever write. `payable` must be pure, or those turns are 25 round trips to the
// database; that is what the hoisted slabs and food rate are for.
//
// Lands at or *below* the target and reports what it actually reached, because
// the steps mean an exact figure often isn't available. Under-shooting is the
// right direction to miss in: the guest is asked for no more than the number
// they were promised.
function solveDiscountForTarget(target, grossSubtotal, payable) {
  const wanted = Math.max(Number(target) || 0, 0);
  const maxPaise = Math.round(grossSubtotal * 100);
  if (maxPaise <= 0) return { discount: 0, achieved: payable(0) };

  // Already at or under it — nothing to take off. Said explicitly so a target
  // above the bill doesn't bisect its way to a spurious paisa of discount.
  if (payable(0) <= wanted) return { discount: 0, achieved: payable(0) };

  // Even giving the whole bill away can't reach it (an advance larger than the
  // stay would do this). Hand back the most that can be given.
  const maxDiscount = round2(grossSubtotal);
  if (payable(maxDiscount) > wanted) {
    return { discount: maxDiscount, achieved: payable(maxDiscount) };
  }

  // Invariant: payable(lo) > wanted, payable(hi) <= wanted. Converges on the
  // smallest discount that gets there, which is the one to give.
  let lo = 0;
  let hi = maxPaise;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (payable(round2(mid / 100)) <= wanted) hi = mid;
    else lo = mid;
  }
  const discount = round2(hi / 100);
  return { discount, achieved: payable(discount) };
}

async function loadBookingForBilling(lodgeId, bookingId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('bookingId', sql.BigInt, bookingId)
    .query(`
      SELECT b.*, r.room_number, c.name AS category_name,
             l.is_gst_registered, l.gstin, l.is_specified_premises, l.checkin_mode, l.check_out_time,
             l.name AS lodge_name, l.phone AS lodge_phone, l.address AS lodge_address,
             l.city AS lodge_city, l.state AS lodge_state
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
// Both sides are reported at their *gross* — what was sold, matching the
// itemised lines printed above them — with the discount shown once as its own
// line. The tax handed in was already computed on the discounted amounts by
// the caller, so the document still adds up: gross room + gross food − discount
// + tax + round off = total. Deriving the printed tax rates needs the net,
// which is why the split is recomputed here rather than only in the caller.
//
// `food` is optional so every room-only caller keeps its old shape.
function buildBreakdown({ roomSubtotal, cgstAmount, sgstAmount, isGstSide, food = null, discountAmount = 0 }) {
  const foodSubtotal = food ? round2(food.subtotal) : 0;
  const foodCgst = food ? food.cgstAmount : 0;
  const foodSgst = food ? food.sgstAmount : 0;

  const grossSubtotal = round2(roomSubtotal + foodSubtotal);
  const discount = cappedDiscount(discountAmount, grossSubtotal);
  const [roomNet, foodNet] = netOfDiscount([round2(roomSubtotal), foodSubtotal], discount, grossSubtotal);

  const subtotal = round2(grossSubtotal - discount);
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
    // Off the discounted amount the tax was actually charged on, so a
    // discounted bill still prints "CGST (6%)" rather than a rate nobody's
    // schedule contains.
    cgstRatePercent: ratePercentFromAmount(cgstAmount, roomNet),
    sgstRatePercent: ratePercentFromAmount(sgstAmount, roomNet),
    // The taxable value per SAC — gross less that SAC's share of the discount.
    // Already computed above for the rates; published because a tax invoice has
    // to state what each rate was charged on, and the alternative is the
    // document re-deriving the apportionment and drifting from this one.
    roomTaxable: roomNet,

    // Food side, zeroed when there is none.
    foodSubtotal,
    foodCgstAmount: foodCgst,
    foodSgstAmount: foodSgst,
    foodCgstRatePercent: ratePercentFromAmount(foodCgst, foodNet),
    foodSgstRatePercent: ratePercentFromAmount(foodSgst, foodNet),
    foodTaxable: foodNet,
    foodSacCode: food?.sacCode ?? null,

    // What the desk took off this document, and what that came to as a
    // percentage of everything on it before tax — the two ways the same
    // decision gets described, both printed.
    discountAmount: discount,
    discountPercent: grossSubtotal > 0 ? round2((discount / grossSubtotal) * 100) : 0,
    grossSubtotal,

    // What tax was charged on, after the discount. Kept under its old name
    // because that is what it has always meant.
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

// Everything a stay bill is made of, priced twice — once as a GST document and
// once as a cash receipt — for whichever side the desk picks. Shared by the
// preview and the issue path so the bill that gets written is provably the one
// that was shown.
//
// The discount is re-derived here rather than adjusted client-side, for the
// same reason dropping the late charge is: taking money off can move a night
// into a lower GST band and change the round-off, so the whole document has to
// be recomputed, not patched.
// Pure. Everything it needs is already in memory — the loaded booking, the
// loaded orders, the GST slabs and the food rate — which is what lets
// solveDiscountForTarget call it twenty-odd times without touching the
// database. buildStayBill is the wrapper that fetches those two lookups.
function priceStayBill(booking, foodOrders, { includeLateCheckout, discountAmount, slabs, foodRate }) {
  // What was sold, before anything comes off it.
  const grossNights = nightlyAmounts(booking);
  const nightsSubtotal = round2(grossNights.reduce((sum, n) => sum + n, 0));
  const grossLate = includeLateCheckout ? round2(Number(booking.late_checkout_charge) || 0) : 0;
  const grossFood = foodSubtotalOf(foodOrders);
  const grossSubtotal = round2(nightsSubtotal + grossLate + grossFood);

  // What it is actually being charged at, which is what GST is due on. The
  // nights, the overstay and the food each give up their share of the discount
  // before any of them is banded or taxed.
  const discount = cappedDiscount(discountAmount, grossSubtotal);
  const net = netOfDiscount([...grossNights, grossLate, grossFood], discount, grossSubtotal);
  const netNights = net.slice(0, grossNights.length);
  const netLate = net[grossNights.length];
  const netFood = net[grossNights.length + 1];

  const { cgstAmount, sgstAmount, anyTaxable } = computeGstBreakdown(netNights, slabs);
  const late = lateChargeTax(netLate, netNights, slabs, true);
  const food = foodSideOf(foodOrders, netFood, foodRate);

  // The room block on the document: the nights plus the overstay, gross. The
  // overstay is carried inside the accommodation subtotal so its SAC and its
  // tax stay correct, and shown as its own line so a guest can see it named.
  const roomSubtotal = round2(nightsSubtotal + grossLate);

  const gst = booking.is_gst_registered
    ? {
        // A stay under the nil threshold is a bill of supply — unless food was
        // served, which is taxable at 5% or 18% regardless of the room rate and
        // therefore makes the whole document a tax invoice.
        documentType: anyTaxable || late.taxable || food?.taxable ? 'TAX_INVOICE' : 'BILL_OF_SUPPLY',
        ...buildBreakdown({
          roomSubtotal,
          cgstAmount: round2(cgstAmount + late.cgstAmount),
          sgstAmount: round2(sgstAmount + late.sgstAmount),
          isGstSide: true,
          food,
          discountAmount: discount,
        }),
      }
    : null;

  const nonGst = {
    documentType: 'CASH_RECEIPT',
    ...buildBreakdown({
      roomSubtotal,
      cgstAmount: 0,
      sgstAmount: 0,
      isGstSide: false,
      food: food ? { ...food, cgstAmount: 0, sgstAmount: 0 } : null,
      discountAmount: discount,
    }),
  };

  return { gst, nonGst, grossNights, nightsSubtotal, grossLate, grossSubtotal, discount };
}

// The two lookups the pricing needs, then the pricing. Callers that price the
// same bill repeatedly fetch these once and call priceStayBill directly.
async function loadPricingContext(pool, booking, foodOrders) {
  return {
    slabs: await getGstSlabs(pool),
    foodRate: foodOrders.length ? await getFoodRate(pool, booking.is_specified_premises) : null,
  };
}

async function buildStayBill(pool, booking, foodOrders, opts) {
  const context = opts.slabs ? { slabs: opts.slabs, foodRate: opts.foodRate } : await loadPricingContext(pool, booking, foodOrders);
  return priceStayBill(booking, foodOrders, { ...opts, ...context });
}

async function previewBill(
  lodgeId,
  bookingId,
  { includeLateCheckout = true, discountAmount = 0, targetTotal = 0 } = {}
) {
  const pool = await getPool();
  const booking = await loadBookingForBilling(lodgeId, bookingId);

  if (booking.status !== 'CHECKED_OUT') {
    throw new ApiError('This booking must be checked out before it can be billed.', 409);
  }

  const active = await findActiveInvoice(pool.request(), bookingId);

  // Anything the guest ate and was served during the stay, not yet billed.
  const foodOrders = await loadUnbilledOrders(pool.request(), lodgeId, { bookingId });
  const foodItems = await loadFoodItemsForOrders(pool.request(), foodOrders.map((o) => o.id));

  const advancePaid = booking.advance_amount != null ? Number(booking.advance_amount) : 0;

  // A target is the desk saying what the guest hands over; the discount that
  // produces it has to be searched for. Both DB reads the pricing needs are
  // hoisted out first, so the search costs no queries at all.
  let applied = discountAmount;
  let targetAchieved = null;
  let context = null;
  if (targetTotal > 0) {
    context = await loadPricingContext(pool, booking, foodOrders);
    const priced = (d) =>
      priceStayBill(booking, foodOrders, { includeLateCheckout, discountAmount: d, ...context });
    const sideOf = (b) => b.gst ?? b.nonGst;
    // What the guest hands over, not the bill's own total — the advance is
    // already in the property's hands.
    const payable = (d) => round2(sideOf(priced(d)).totalAmount - advancePaid);
    const solved = solveDiscountForTarget(targetTotal, sideOf(priced(0)).grossSubtotal, payable);
    applied = solved.discount;
    targetAchieved = solved.achieved;
  }

  const bill = await buildStayBill(pool, booking, foodOrders, {
    includeLateCheckout,
    discountAmount: applied,
    ...(context ?? {}),
  });
  const { gst, nonGst, grossNights, nightsSubtotal } = bill;

  return {
    bookingId: booking.id,
    guestName: booking.guest_name,
    roomNumber: booking.room_number,
    categoryName: booking.category_name,
    nights: grossNights.length,
    // Split out of the accommodation subtotal so the bill can show what the
    // nights cost and what the overstay cost as two separate lines.
    nightsSubtotal,
    // What those nights were made of. Sums to nightsSubtotal, not to the
    // accommodation subtotal — the late charge is its own line beside it.
    roomCharges: roomChargeLines(booking),
    lateCheckoutCharge: bill.grossLate,
    // Everything on this bill before tax and before anything comes off it —
    // the figure a percentage discount is a percentage *of*, so the screen can
    // convert between "10%" and "₹520" without guessing at the base.
    discountBase: bill.grossSubtotal,
    discountAmount: bill.discount,
    // What the guest was actually brought to, when a target was asked for.
    // Often not the exact figure typed: GST bands per night and the total
    // rounds to the rupee, so the screen has to be able to say so.
    targetAchieved,
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
    // The document itself, ready to render. Built for the side this property
    // actually issues on — a registered lodge writes tax invoices, an
    // unregistered one has nothing but the cash receipt.
    document: buildPreviewDocument({
      row: booking,
      side: gst ?? nonGst,
      billingSide: booking.is_gst_registered ? 'GST' : 'NON_GST',
      foodItems,
      lateCheckoutCharge: bill.grossLate,
      kind: 'STAY',
    }),
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

// What the food on a bill is worth before anything comes off it.
function foodSubtotalOf(orders) {
  return round2(orders.reduce((sum, o) => sum + o.subtotal, 0));
}

// Turns a set of unbilled orders into the food side of a bill, or null when
// there's nothing to charge.
//
// `taxableSubtotal` is the food's share of the bill after any discount — what
// the tax is due on. The returned `subtotal` stays gross, because that is what
// the itemised lines above it on the document add up to; the discount is shown
// once, on its own line, for the bill as a whole.
// Pure once the rate is in hand — see priceStayBill for why that matters.
function foodSideOf(orders, taxableSubtotal, rate) {
  if (orders.length === 0) return null;
  const subtotal = foodSubtotalOf(orders);
  const taxedOn = taxableSubtotal == null ? subtotal : round2(taxableSubtotal);
  const tax = computeFoodTax(taxedOn, rate.ratePercent);
  return {
    subtotal,
    cgstAmount: tax.cgstAmount,
    sgstAmount: tax.sgstAmount,
    taxable: tax.taxable,
    ratePercent: rate.ratePercent,
    sacCode: rate.sacCode,
  };
}

async function buildFoodSide(pool, isSpecifiedPremises, orders, taxableSubtotal = null, rate = null) {
  if (orders.length === 0) return null;
  return foodSideOf(orders, taxableSubtotal, rate ?? (await getFoodRate(pool, isSpecifiedPremises)));
}

async function issueInvoice(lodgeId, userId, bookingId, input) {
  const pool = await getPool();
  const booking = await loadBookingForBilling(lodgeId, bookingId);

  if (booking.status !== 'CHECKED_OUT') {
    throw new ApiError('This booking must be checked out before it can be billed.', 409);
  }

  const billingSide = booking.is_gst_registered ? input.billingSide || 'GST' : 'NON_GST';

  // Whether the overstay charge lands on this document at all is the billing
  // desk's call, taken in the preview and posted back with the rest of the
  // bill. The charge itself is read off the booking, where reception's decision
  // was recorded at checkout — never recomputed from the policy here, or a
  // lodge that edited its late-fee percentages would silently restate bills
  // issued last month.
  const includeLateCheckout = input.includeLateCheckout !== false;
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

    // Priced by the same code the preview ran, so the document written here is
    // the one the desk agreed to on screen.
    const bill = await buildStayBill(pool, booking, foodOrders, {
      includeLateCheckout,
      discountAmount: input.discountAmount ?? 0,
    });
    const side = billingSide === 'GST' ? bill.gst : bill.nonGst;
    const { documentType, ...breakdown } = side;

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
      .input('balanceReference', sql.NVarChar, input.paymentReference ?? null)
      .input('foodSubtotal', sql.Decimal(10, 2), breakdown.foodSubtotal)
      .input('foodCgstAmount', sql.Decimal(10, 2), breakdown.foodCgstAmount)
      .input('foodSgstAmount', sql.Decimal(10, 2), breakdown.foodSgstAmount)
      .input('lateCheckoutCharge', sql.Decimal(10, 2), bill.grossLate)
      .input('discountAmount', sql.Decimal(10, 2), breakdown.discountAmount)
      .input('discountPercent', sql.Decimal(5, 2), breakdown.discountPercent)
      .input('createdBy', sql.BigInt, userId ?? null)
      .query(`
        INSERT INTO dbo.invoices
          (lodge_id, booking_id, document_type, billing_side, invoice_number, room_subtotal,
           cgst_amount, sgst_amount, food_subtotal, food_cgst_amount, food_sgst_amount,
           late_checkout_charge, discount_amount, discount_percent, round_off, total_amount,
           advance_paid, balance_collected, balance_payment_method, balance_reference, created_by)
        OUTPUT inserted.id
        VALUES
          (@lodgeId, @bookingId, @documentType, @billingSide, @invoiceNumber, @roomSubtotal,
           @cgstAmount, @sgstAmount, @foodSubtotal, @foodCgstAmount, @foodSgstAmount,
           @lateCheckoutCharge, @discountAmount, @discountPercent, @roundOff, @totalAmount,
           @advancePaid, @balanceCollected, @balancePaymentMethod, @balanceReference, @createdBy)
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

  // The stored subtotals are gross — what was sold, matching the itemised
  // lines on the document — and the discount is its own stored line. Tax was
  // charged on the discounted amounts, so the printed rate has to be backed
  // out of those, which means re-splitting the discount the way it was
  // apportioned when the bill was issued. Display only; the amounts themselves
  // are read straight off the row, never recomputed.
  const discountAmount = Number(row.discount_amount ?? 0);
  const [roomNet, foodNet] = netOfDiscount(
    [roomSubtotal, foodSubtotal],
    discountAmount,
    round2(roomSubtotal + foodSubtotal)
  );

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
    cgstRatePercent: ratePercentFromAmount(Number(row.cgst_amount), roomNet),
    sgstRatePercent: ratePercentFromAmount(Number(row.sgst_amount), roomNet),
    // See buildBreakdown: the taxable value the rates above were charged on.
    // Re-derived from the stored columns by the same apportionment that
    // produced them, so a bill reprinted years later states the same figures
    // it was issued with.
    roomTaxable: roomNet,
    foodSubtotal,
    foodCgstAmount: foodCgst,
    foodSgstAmount: foodSgst,
    foodCgstRatePercent: ratePercentFromAmount(foodCgst, foodNet),
    foodSgstRatePercent: ratePercentFromAmount(foodSgst, foodNet),
    foodTaxable: foodNet,
    // What the desk took off this bill, and the percentage it was agreed as.
    // 0 on every bill written before discounts existed, which prints nothing.
    discountAmount,
    discountPercent: Number(row.discount_percent ?? 0),
    roundOff: Number(row.round_off),
    totalAmount: Number(row.total_amount),
    advancePaid: Number(row.advance_paid),
    balanceCollected: Number(row.balance_collected),
    balancePaymentMethod: row.balance_payment_method,
    // The UPI/card transaction number for what was collected. NULL on cash and
    // on every bill issued before this was recorded.
    balanceReference: row.balance_reference ?? null,
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
    // The property's own checkout rule, so the terms printed on the bill are
    // the terms it actually enforces rather than a fixed line of text.
    checkinMode: row.checkin_mode ?? null,
    checkOutTime: toClockTime(row.check_out_time),
  };
}

// The bill as it will print, before it exists. Deliberately the same field
// names mapInvoice produces from an issued row, so one component renders both
// — a preview that goes through its own code path is a preview that can lie
// about the document it is previewing.
//
// The number and the date are the two things a preview genuinely doesn't have.
// The series is allocated at issue time on purpose, so abandoned previews
// don't burn invoice numbers out of a sequence that has to be gapless.
function buildPreviewDocument({ row, side, billingSide, foodItems, lateCheckoutCharge, kind, tableLabel }) {
  const roomSubtotal = side.subtotal;
  return {
    kind,
    tableLabel: tableLabel ?? null,
    invoiceNumber: null,
    createdAt: null,
    status: 'PREVIEW',
    documentType: side.documentType,
    billingSide,

    lodgeName: row.lodge_name,
    lodgePhone: row.lodge_phone,
    lodgeAddress: row.lodge_address,
    lodgeCity: row.lodge_city,
    lodgeState: row.lodge_state,
    gstin: row.gstin,
    isGstRegistered: !!row.is_gst_registered,
    checkinMode: row.checkin_mode ?? null,
    checkOutTime: toClockTime(row.check_out_time),

    guestName: row.guest_name ?? null,
    guestPhone: row.guest_phone ?? null,
    numGuests: row.num_guests ?? null,
    roomNumber: row.room_number ?? null,
    categoryName: row.category_name ?? null,
    checkInDate: isoDate(row.check_in_date),
    checkOutDate: isoDate(row.check_out_date),
    actualCheckInAt: row.actual_check_in_at ?? null,
    actualCheckOutAt: row.actual_check_out_at ?? null,
    lateCheckoutMinutes: row.late_checkout_minutes ?? null,

    roomSubtotal,
    lateCheckoutCharge,
    nightsSubtotal: round2(roomSubtotal - lateCheckoutCharge),
    roomCharges: roomChargeLines(row),
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
    foodItems,

    discountAmount: side.discountAmount,
    discountPercent: side.discountPercent,
    roundOff: side.roundOff,
    totalAmount: side.totalAmount,

    advancePaid: row.advance_amount != null ? Number(row.advance_amount) : 0,
    // Not known yet — the desk types it in the modal, and the screen overlays
    // what it has typed onto this before rendering.
    balanceCollected: 0,
    balancePaymentMethod: null,
    balanceReference: null,
    voidReason: null,
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
             l.gstin, l.is_gst_registered, l.checkin_mode, l.check_out_time, l.name AS lodge_name,
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
             l.gstin, l.is_gst_registered, l.checkin_mode, l.check_out_time, l.name AS lodge_name,
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
    .query(`
      SELECT is_gst_registered, gstin, is_specified_premises,
             name AS lodge_name, phone AS lodge_phone, address AS lodge_address,
             city AS lodge_city, state AS lodge_state
      FROM dbo.lodges WHERE id = @lodgeId
    `);
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

// A table bill is the food side on its own — no room, no overstay — so the
// discount has nothing to share itself between and simply comes off the food.
// Pure, for the same reason priceStayBill is.
function priceFoodBill(lodge, orders, discountAmount, foodRate) {
  const grossSubtotal = foodSubtotalOf(orders);
  const discount = cappedDiscount(discountAmount, grossSubtotal);
  const food = foodSideOf(orders, round2(grossSubtotal - discount), foodRate);

  const gst = lodge.is_gst_registered
    ? {
        // Food is always taxable, so a GST-registered restaurant always issues
        // a tax invoice — there's no nil band to fall through to a bill of
        // supply the way a cheap room night does.
        documentType: 'TAX_INVOICE',
        ...buildBreakdown({ roomSubtotal: 0, cgstAmount: 0, sgstAmount: 0, isGstSide: true, food, discountAmount: discount }),
      }
    : null;
  const nonGst = {
    documentType: 'CASH_RECEIPT',
    ...buildBreakdown({
      roomSubtotal: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      isGstSide: false,
      food: { ...food, cgstAmount: 0, sgstAmount: 0 },
      discountAmount: discount,
    }),
  };

  return { gst, nonGst, grossSubtotal, discount };
}

async function buildFoodBill(pool, lodge, orders, discountAmount, foodRate = null) {
  return priceFoodBill(lodge, orders, discountAmount, foodRate ?? (await getFoodRate(pool, lodge.is_specified_premises)));
}

async function previewFoodBill(lodgeId, tableId, { discountAmount = 0, targetTotal = 0 } = {}) {
  const pool = await getPool();
  const lodge = await loadLodgeForBilling(pool, lodgeId);
  const orders = await loadUnbilledTabOrders(pool.request(), lodgeId, tableId);

  if (orders.length === 0) {
    throw new ApiError('Nothing to bill here — no delivered orders are waiting.', 409);
  }

  const foodItems = await loadFoodItemsForOrders(pool.request(), orders.map((o) => o.id));

  // No advance on a table tab, so what the customer hands over is the total.
  const foodRate = await getFoodRate(pool, lodge.is_specified_premises);
  let applied = discountAmount;
  let targetAchieved = null;
  if (targetTotal > 0) {
    const priced = (d) => priceFoodBill(lodge, orders, d, foodRate);
    const sideOf = (b) => b.gst ?? b.nonGst;
    const solved = solveDiscountForTarget(
      targetTotal,
      sideOf(priced(0)).grossSubtotal,
      (d) => sideOf(priced(d)).totalAmount
    );
    applied = solved.discount;
    targetAchieved = solved.achieved;
  }

  const bill = await buildFoodBill(pool, lodge, orders, applied, foodRate);

  return {
    tableId: tableId ?? null,
    tableLabel: orders[0].tableLabel || 'Counter / takeaway',
    orders,
    foodItems,
    isGstRegistered: !!lodge.is_gst_registered,
    gstin: lodge.gstin,
    // The base a percentage discount is a percentage of — see previewBill.
    discountBase: bill.grossSubtotal,
    discountAmount: bill.discount,
    targetAchieved,
    gst: bill.gst,
    nonGst: bill.nonGst,
    document: buildPreviewDocument({
      row: lodge,
      side: bill.gst ?? bill.nonGst,
      billingSide: lodge.is_gst_registered ? 'GST' : 'NON_GST',
      foodItems,
      lateCheckoutCharge: 0,
      kind: 'FOOD',
      tableLabel: orders[0].tableLabel || 'Counter / takeaway',
    }),
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

    const bill = await buildFoodBill(pool, lodge, orders, input.discountAmount ?? 0);
    const { documentType, ...breakdown } = billingSide === 'GST' ? bill.gst : bill.nonGst;

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
      .input('balanceReference', sql.NVarChar, input.paymentReference ?? null)
      .input('discountAmount', sql.Decimal(10, 2), breakdown.discountAmount)
      .input('discountPercent', sql.Decimal(5, 2), breakdown.discountPercent)
      .input('createdBy', sql.BigInt, userId ?? null)
      .query(`
        INSERT INTO dbo.invoices
          (lodge_id, booking_id, table_id, document_type, billing_side, invoice_number,
           room_subtotal, cgst_amount, sgst_amount,
           food_subtotal, food_cgst_amount, food_sgst_amount,
           discount_amount, discount_percent,
           round_off, total_amount, advance_paid, balance_collected,
           balance_payment_method, balance_reference, created_by)
        OUTPUT inserted.id
        VALUES
          (@lodgeId, NULL, @tableId, @documentType, @billingSide, @invoiceNumber,
           0, 0, 0,
           @foodSubtotal, @foodCgstAmount, @foodSgstAmount,
           @discountAmount, @discountPercent,
           @roundOff, @totalAmount, 0, @balanceCollected,
           @balancePaymentMethod, @balanceReference, @createdBy)
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
  // Exported so the guest register and the booking detail can itemise a stay
  // with the same labels and the same aggregation the bill will use. A stay
  // that reads one way on the booking screen and another on its invoice is a
  // dispute waiting to happen.
  roomChargeLines,
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
