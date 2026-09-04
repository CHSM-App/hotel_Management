const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const { toClockTime } = require('../rooms/checkoutPolicy.service');
const lateCheckout = require('../bookings/lateCheckout');
// The one normaliser turning 'however this request expressed its payment' into
// the list of lines to store. Lives with the other payment rules in bookings.
const { paymentLinesOf } = require('../bookings/bookings.schema');

function round2(n) {
  return Math.round(n * 100) / 100;
}

// How a document was tendered, always as a list.
//
// A document written before dbo.payment_lines existed has no rows there, and
// neither does one paid by a single method through a client that still sends
// the old flat fields. Both are read as a one-line split built from the
// document's own summary columns, so every consumer — the printed bill, the
// receipt, the screen — has exactly one shape to handle instead of two.
function readPaymentLines(json, fallbackMethod, fallbackAmount, fallbackReference) {
  if (json) {
    try {
      const rows = JSON.parse(json);
      if (Array.isArray(rows) && rows.length > 0) {
        return rows.map((r) => ({
          method: r.method,
          amount: Number(r.amount),
          reference: r.reference ?? null,
        }));
      }
    } catch {
      // A malformed payload must not take the bill down with it: the summary
      // columns below still describe the payment well enough to print.
    }
  }
  if (!fallbackMethod || !(Number(fallbackAmount) > 0)) return [];
  return [{ method: fallbackMethod, amount: Number(fallbackAmount), reference: fallbackReference ?? null }];
}

// Every price in this system is what the guest hands over — GST is already
// inside it, not added on top of it. So tax is extracted from an amount rather
// than applied to one:
//
//     tax = inclusive x rate / (100 + rate)
//
// The forward form (amount x rate / 100) would answer a different question —
// what to *add* to a tax-exclusive price — and using it on an inclusive one
// over-collects from the guest and over-reports to GSTR-1. At 12% on a Rs 5,000
// inclusive price this returns Rs 535.71, leaving Rs 4,464.29 taxable, and
// 4,464.29 x 12% = 535.71 back again. The forward form would have returned
// Rs 600 and made the guest pay Rs 5,600 for a Rs 5,000 room.
//
// Not rounded here. Both callers halve the result into CGST and SGST and round
// each half independently, and rounding twice would lose a paisa on the way.
function taxWithin(inclusiveAmount, ratePercent) {
  if (!ratePercent) return 0;
  return (inclusiveAmount * ratePercent) / (100 + ratePercent);
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
// Catering on an issued function bill, as one itemised plate line — read off
// the snapshot, and priced at what the bill actually carried so a reprint
// after a head-count edit still shows the figure that was issued.
function cateringItemsOf(row, invoice) {
  if (!(invoice.foodSubtotal > 0)) return [];
  try {
    const line = (JSON.parse(row.event_breakdown)?.lines ?? []).find((l) => l.side === 'FOOD');
    const quantity = line?.quantity || 1;
    return [{ name: 'Catering (per plate)', quantity, unitPrice: round2(invoice.foodSubtotal / quantity), lineTotal: invoice.foodSubtotal }];
  } catch {
    return [{ name: 'Catering', quantity: 1, unitPrice: invoice.foodSubtotal, lineTotal: invoice.foodSubtotal }];
  }
}

// The venue-side lines of a function's quote, read off the booking's own
// snapshot the way roomChargeLines reads a stay's. Catering is the food side
// and is itemised separately.
function eventChargeLinesOf(json) {
  try {
    const lines = JSON.parse(json)?.lines ?? [];
    return lines
      .filter((line) => line.side === 'VENUE')
      .map((line) => ({ label: line.quantity > 1 ? `${line.label} × ${line.quantity}` : line.label, amount: Number(line.amount), nights: 1 }));
  } catch {
    return [];
  }
}

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
  const cgstAmount = round2(taxWithin(subtotal, ratePercent) / 2);
  const sgstAmount = round2(taxWithin(subtotal, ratePercent) / 2);
  return { cgstAmount, sgstAmount, taxable: ratePercent > 0 && subtotal > 0 };
}

// Food is never loaded onto a stay bill, so there is no by-booking loader here
// any more — every delivered, unbilled order reaches its bill through
// loadUnbilledTabOrders, keyed on the tab that owes for it.

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
    cgstAmount += round2(taxWithin(amount, ratePercent) / 2);
    sgstAmount += round2(taxWithin(amount, ratePercent) / 2);
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
    cgstAmount: round2(taxWithin(amount, ratePercent) / 2),
    sgstAmount: round2(taxWithin(amount, ratePercent) / 2),
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
             l.late_grace_minutes,
             l.name AS lodge_name, l.phone AS lodge_phone, l.address AS lodge_address,
             l.name_mr AS lodge_name_mr, l.address_mr AS lodge_address_mr,
             l.city AS lodge_city, l.state AS lodge_state,
             (SELECT STRING_AGG(ar.receipt_number, ', ') WITHIN GROUP (ORDER BY ar.id)
              FROM dbo.advance_receipts ar
              WHERE ar.booking_id = b.id AND ar.status = 'ISSUED') AS advance_receipt_numbers
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

async function findActiveEventInvoice(request, lodgeId, eventBookingId) {
  const result = await request
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('eventId', sql.BigInt, eventBookingId)
    .query("SELECT id FROM dbo.invoices WHERE lodge_id = @lodgeId AND event_booking_id = @eventId AND status = 'ISSUED'");
  return result.recordset[0] || null;
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
function buildBreakdown({ roomSubtotal, cgstAmount, sgstAmount, food = null, discountAmount = 0 }) {
  const foodSubtotal = food ? round2(food.subtotal) : 0;
  const foodCgst = food ? food.cgstAmount : 0;
  const foodSgst = food ? food.sgstAmount : 0;

  const grossSubtotal = round2(roomSubtotal + foodSubtotal);
  const discount = cappedDiscount(discountAmount, grossSubtotal);
  const [roomGross, foodGross] = netOfDiscount(
    [round2(roomSubtotal), foodSubtotal],
    discount,
    grossSubtotal
  );

  // The taxable value of an inclusive amount is what is left once the tax
  // inside it comes out. Every figure below that a tax invoice has to state —
  // the per-SAC taxable value, and the rate derived from it — is computed
  // against these, not against the discounted gross. Printing the gross as the
  // taxable value would state a figure that doesn't reconcile: taxable x rate
  // would not come back to the tax charged.
  const roomNet = round2(roomGross - cgstAmount - sgstAmount);
  const foodNet = round2(foodGross - foodCgst - foodSgst);

  const subtotal = round2(grossSubtotal - discount);
  const totalCgst = round2(cgstAmount + foodCgst);
  const totalSgst = round2(sgstAmount + foodSgst);

  // The tax is already inside `subtotal` — it was extracted from these amounts,
  // not charged on top of them — so the total is the subtotal, full stop.
  // Adding totalCgst + totalSgst here is what the exclusive model did, and
  // doing it now would bill the guest the tax twice.
  //
  // Rounded to the whole rupee on both sides. It used to round only the GST
  // side, which left the cash receipt asking for paise nobody at a lodge desk
  // has, and — because the round off line prints only when it is non-zero —
  // left that receipt with no round off line at all while the tax invoice for
  // the same stay carried one: two documents off one booking, stating
  // different amounts and reconciling differently. The desk collects rupees,
  // so both documents are written in rupees, and both show the adjustment
  // that got them there.
  const preRound = subtotal;
  const totalAmount = Math.round(preRound);
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

// On a CYCLE property the nights are counted by the clock, so a guest who
// booked two and left after one has paid for a night the room can be re-let
// for. The bill still prices every booked night — that is what was sold — but
// the desk is told how much of it was never used, so it can take that off
// with the ordinary discount if the owner wants to. Null on every other mode,
// and on a stay with no arrival or departure on record to count between.
function earlyCheckoutOf(booking, grossNights) {
  if (booking.checkin_mode !== 'CYCLE') return null;
  if (!booking.actual_check_in_at || !booking.actual_check_out_at) return null;

  const plannedNights = grossNights.length;
  const actualNights = lateCheckout.cycleNights({
    checkOutTime: toClockTime(booking.check_out_time),
    actualCheckInAt: booking.actual_check_in_at,
    at: new Date(booking.actual_check_out_at),
    graceMinutes: booking.late_grace_minutes,
  });
  const unusedNights = Math.max(0, plannedNights - actualNights);
  if (unusedNights === 0) return null;

  // The nights not slept in are the last ones, priced at what they were sold at.
  const unusedAmount = round2(grossNights.slice(plannedNights - unusedNights).reduce((sum, n) => sum + n, 0));
  return { plannedNights, actualNights, unusedNights, unusedAmount };
}

async function buildStayBill(pool, booking, foodOrders, opts) {
  const context = opts.slabs ? { slabs: opts.slabs, foodRate: opts.foodRate } : await loadPricingContext(pool, booking, foodOrders);
  return priceStayBill(booking, foodOrders, { ...opts, ...context });
}

async function previewBill(
  lodgeId,
  bookingId,
  { includeLateCheckout = true, discountAmount = 0, targetTotal = 0, discountReason = null } = {}
) {
  const pool = await getPool();
  const booking = await loadBookingForBilling(lodgeId, bookingId);

  if (booking.status !== 'CHECKED_OUT') {
    throw new ApiError('This booking must be checked out before it can be billed.', 409);
  }

  const active = await findActiveInvoice(pool.request(), bookingId);

  // Food never rides on the stay bill. Room service is settled on its own food
  // bill against the room, whether or not anybody is checked into it — so the
  // guest's main bill is accommodation only, and the food they ordered to the
  // room is a separate document. Kept as empty lists rather than removed so
  // every consumer of this preview — the pricing, the document, the screen —
  // keeps its shape and simply prices a bill whose food side is nil.
  const foodOrders = [];
  const foodItems = [];

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
    // Set only when a CYCLE guest left before the nights they booked ran out.
    earlyCheckout: earlyCheckoutOf(booking, grossNights),
    advancePaid: booking.advance_amount != null ? Number(booking.advance_amount) : 0,
    advanceReceiptNumbers: booking.advance_receipt_numbers || null,
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
      discountReason: bill.discount > 0 ? discountReason : null,
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

  // Resolved once, before anything is written: a body may describe its payment
  // as lines or as the older single method, and everything below wants the one
  // shape.
  const paymentLines = paymentLinesOf(input, input.collectedAmount ?? 0);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const existing = await findActiveInvoice(new sql.Request(transaction), bookingId);
    if (existing) {
      throw new ApiError('This booking already has an issued bill. Void it before reissuing.', 409);
    }

    // No food on a stay bill — it is billed separately against the room, so
    // there is nothing to re-read here and nothing to stamp with this invoice.
    const foodOrders = [];

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
        .input('prefix', sql.NVarChar, '')
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
      // A summary of the lines, not a rival to them: the first tender. Kept so
      // every existing reader — the register, the printed bill, the legacy
      // report path — keeps working untouched.
      .input('balancePaymentMethod', sql.NVarChar, paymentLines[0]?.method ?? null)
      .input('balanceReference', sql.NVarChar, paymentLines[0]?.reference ?? null)
      .input('foodSubtotal', sql.Decimal(10, 2), breakdown.foodSubtotal)
      .input('foodCgstAmount', sql.Decimal(10, 2), breakdown.foodCgstAmount)
      .input('foodSgstAmount', sql.Decimal(10, 2), breakdown.foodSgstAmount)
      .input('lateCheckoutCharge', sql.Decimal(10, 2), bill.grossLate)
      .input('discountAmount', sql.Decimal(10, 2), breakdown.discountAmount)
      .input('discountPercent', sql.Decimal(5, 2), breakdown.discountPercent)
      // Only kept when there is a discount for it to explain.
      .input('discountReason', sql.NVarChar(100), breakdown.discountAmount > 0 ? input.discountReason ?? null : null)
      .input('createdBy', sql.BigInt, userId ?? null)
      .query(`
        INSERT INTO dbo.invoices
          (lodge_id, booking_id, document_type, billing_side, invoice_number, room_subtotal,
           cgst_amount, sgst_amount, food_subtotal, food_cgst_amount, food_sgst_amount,
           late_checkout_charge, discount_amount, discount_percent, discount_reason, round_off, total_amount,
           advance_paid, balance_collected, balance_payment_method, balance_reference, created_by)
        OUTPUT inserted.id
        VALUES
          (@lodgeId, @bookingId, @documentType, @billingSide, @invoiceNumber, @roomSubtotal,
           @cgstAmount, @sgstAmount, @foodSubtotal, @foodCgstAmount, @foodSgstAmount,
           @lateCheckoutCharge, @discountAmount, @discountPercent, @discountReason, @roundOff, @totalAmount,
           @advancePaid, @balanceCollected, @balancePaymentMethod, @balanceReference, @createdBy)
      `);

    const invoiceId = inserted.recordset[0].id;

    await insertPaymentLines(transaction, lodgeId, { invoiceId }, paymentLines);

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

// Writes how a settlement was tendered, one row per method.
//
// Takes the open transaction so the lines land with the document or not at all:
// a bill that exists while the record of how it was paid does not is worse than
// no bill, because the takings look settled and nothing says by what.
//
// A single-method payment gets one row, the same as a split gets two. That
// uniformity is the point — every reader then has one shape to handle, and the
// scalar columns on the document stay as a compatible summary rather than a
// second source of truth.
async function insertPaymentLines(transaction, lodgeId, parent, lines) {
  for (const line of lines) {
    await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('invoiceId', sql.BigInt, parent.invoiceId ?? null)
      .input('receiptId', sql.BigInt, parent.advanceReceiptId ?? null)
      .input('method', sql.NVarChar, line.method)
      .input('amount', sql.Decimal(10, 2), line.amount)
      .input('reference', sql.NVarChar, line.reference ?? null)
      .query(`
        INSERT INTO dbo.payment_lines
          (lodge_id, invoice_id, advance_receipt_id, method, amount, reference)
        VALUES (@lodgeId, @invoiceId, @receiptId, @method, @amount, @reference)
      `);
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
  const [roomGross, foodGross] = netOfDiscount(
    [roomSubtotal, foodSubtotal],
    discountAmount,
    round2(roomSubtotal + foodSubtotal)
  );

  // ...and then the tax that was sitting inside those amounts comes out, the
  // same way it did when the bill was issued. Prices are GST-inclusive, so the
  // discounted gross is not the taxable value — subtracting the stored tax is
  // what makes taxable x rate come back to the tax printed beside it. Reading
  // the stored tax rather than recomputing it keeps a bill reprinted years
  // later identical to the one issued, even if the slabs have moved since.
  const roomNet = round2(roomGross - Number(row.cgst_amount) - Number(row.sgst_amount));
  const foodNet = round2(foodGross - foodCgst - foodSgst);

  return {
    id: row.id,
    bookingId: row.booking_id,
    // A bill is a food bill when no stay backs it. The screen and the printed
    // document both branch on this rather than sniffing at null fields.
    kind: row.event_booking_id != null ? 'EVENT' : row.booking_id == null ? 'FOOD' : 'STAY',
    // What the food bill was raised against, in the header's own words. A room
    // tab is a food bill with no stay behind it, so it names its room here, and
    // a takeaway — which has neither a table nor a room — names its order, so a
    // reprint says which walk-in it settled rather than just "the counter".
    tableLabel:
      row.table_label ??
      (row.tab_room_number != null ? `Room ${row.tab_room_number}` : null) ??
      (row.takeaway_order_number != null ? `Takeaway #${row.takeaway_order_number}` : null),
    // The function behind an EVENT bill, for the document's register strip.
    eventBookingId: row.event_booking_id ?? null,
    eventTitle: row.event_title ?? null,
    eventType: row.event_type ?? null,
    venueName: row.venue_name ?? null,
    eventStartAt: row.event_start_at ?? null,
    eventEndAt: row.event_end_at ?? null,
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
    roomCharges: row.event_breakdown ? eventChargeLinesOf(row.event_breakdown) : roomChargeLines(row),
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
    discountReason: row.discount_reason ?? null,
    roundOff: Number(row.round_off),
    totalAmount: Number(row.total_amount),
    advancePaid: Number(row.advance_paid),
    // The receipt(s) that advance was taken against, cited on the printed bill
    // so the deduction is traceable to paper the guest already holds.
    advanceReceiptNumbers: row.advance_receipt_numbers || null,
    balanceCollected: Number(row.balance_collected),
    balancePaymentMethod: row.balance_payment_method,
    // The UPI/card transaction number for what was collected. NULL on cash and
    // on every bill issued before this was recorded.
    balanceReference: row.balance_reference ?? null,
    // Every way the balance was tendered. One entry on a single-method bill,
    // several on a split — see readPaymentLines.
    paymentLines: readPaymentLines(
      row.payment_lines,
      row.balance_payment_method,
      row.balance_collected,
      row.balance_reference
    ),
    status: row.status,
    voidReason: row.void_reason,
    voidedAt: row.voided_at,
    createdAt: row.created_at,
    gstin: row.gstin,
    isGstRegistered: !!row.is_gst_registered,
    lodgeName: row.lodge_name,
    lodgePhone: row.lodge_phone,
    lodgeAddress: row.lodge_address,
    // The Devanagari masthead, when the property stored one — the bill's
    // language toggle decides whether it prints; null means English only.
    lodgeNameMr: row.lodge_name_mr ?? null,
    lodgeAddressMr: row.lodge_address_mr ?? null,
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
function buildPreviewDocument({ row, side, billingSide, foodItems, lateCheckoutCharge, kind, tableLabel, discountReason = null }) {
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
    // The Devanagari masthead, when the property stored one — the bill's
    // language toggle decides whether it prints; null means English only.
    lodgeNameMr: row.lodge_name_mr ?? null,
    lodgeAddressMr: row.lodge_address_mr ?? null,
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
    discountReason,
    roundOff: side.roundOff,
    totalAmount: side.totalAmount,

    advancePaid: row.advance_amount != null ? Number(row.advance_amount) : 0,
    // Not known yet — the desk types it in the modal, and the screen overlays
    // what it has typed onto this before rendering.
    balanceCollected: 0,
    balancePaymentMethod: null,
    balanceReference: null,
    // Mirrors the issued shape so one component renders preview and bill alike.
    // Empty rather than absent: the screen overlays what the desk has typed.
    paymentLines: [],
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
      SELECT i.*, dt.label AS table_label, fr.room_number AS tab_room_number, tko.order_number AS takeaway_order_number,
             COALESCE(b.guest_name, eb.organiser_name, rb.guest_name, fo.guest_name) AS guest_name,
             COALESCE(b.guest_phone, eb.organiser_phone, rb.guest_phone, fo.guest_phone) AS guest_phone,
             COALESCE(b.num_guests, CASE WHEN eb.id IS NULL THEN NULL
                 ELSE (SELECT MAX(x) FROM (VALUES (ISNULL(eb.final_pax, eb.expected_pax)), (eb.guaranteed_pax)) AS t(x)) END, rb.num_guests) AS num_guests,
             b.check_in_date, b.check_out_date,
             eb.title AS event_title, eb.event_type, ev.name AS venue_name,
             eb.start_at AS event_start_at, eb.end_at AS event_end_at, eb.pricing_breakdown AS event_breakdown,
             b.actual_check_in_at, b.actual_check_out_at, b.late_checkout_minutes,
             b.nightly_breakdown,
             r.room_number, c.name AS category_name,
             l.gstin, l.is_gst_registered, l.checkin_mode, l.check_out_time, l.name AS lodge_name,
             l.phone AS lodge_phone, l.address AS lodge_address, l.city AS lodge_city, l.state AS lodge_state,
             l.name_mr AS lodge_name_mr, l.address_mr AS lodge_address_mr,
             (SELECT STRING_AGG(ar.receipt_number, ', ') WITHIN GROUP (ORDER BY ar.id)
              FROM dbo.advance_receipts ar
              WHERE (ar.booking_id = i.booking_id OR ar.event_booking_id = i.event_booking_id)
                AND ar.status = 'ISSUED') AS advance_receipt_numbers,
             (SELECT pl.method, pl.amount, pl.reference
              FROM dbo.payment_lines pl
              WHERE pl.invoice_id = i.id
              ORDER BY pl.id
              FOR JSON PATH) AS payment_lines
      FROM dbo.invoices i
      -- LEFT, because a restaurant bill has no stay behind it. An inner join
      -- here silently hid every food-only invoice from the list and the detail.
      LEFT JOIN dbo.bookings b ON b.id = i.booking_id
      LEFT JOIN dbo.rooms r ON r.id = b.room_id
      LEFT JOIN dbo.room_categories c ON c.id = r.category_id
      LEFT JOIN dbo.dining_tables dt ON dt.id = i.table_id
      -- LEFT for the same reason: a function's bill has no stay and no table.
      LEFT JOIN dbo.event_bookings eb ON eb.id = i.event_booking_id
      LEFT JOIN dbo.event_venues ev ON ev.id = eb.venue_id
      -- The room a food-only bill was raised against, which is not b.room_id:
      -- such a bill has no booking behind it at all.
      LEFT JOIN dbo.rooms fr ON fr.id = i.room_id
      -- Room service is charged to whoever was actually staying there: the stay
      -- on that room whose actual window covers when this bill was cut, or —
      -- failing that (a reprint pulled while the guest was still mid-stay, with
      -- no checkout timestamp yet) the most recent one checked in by then. A
      -- food-only invoice carries no booking_id of its own, so without this a
      -- room-service bill named nobody at all.
      OUTER APPLY (
        SELECT TOP 1 rb2.guest_name, rb2.guest_phone, rb2.num_guests
        FROM dbo.bookings rb2
        WHERE rb2.room_id = i.room_id AND rb2.actual_check_in_at IS NOT NULL
          AND rb2.actual_check_in_at <= i.created_at
          AND (rb2.actual_check_out_at IS NULL OR rb2.actual_check_out_at >= i.created_at)
        ORDER BY rb2.actual_check_in_at DESC
      ) rb
      -- A takeaway bill has neither a table nor a room to name it, so it is
      -- named by the one order it settled, reached through the back-link the
      -- invoice writes onto that order. The same order also carries whatever
      -- name and phone staff typed in at the till, which is the only record of
      -- a walk-in's identity that exists anywhere.
      OUTER APPLY (
        SELECT TOP 1 fo.order_number, fo.guest_name, fo.guest_phone
        FROM dbo.food_orders fo
        WHERE fo.invoice_id = i.id AND fo.source = 'COUNTER'
        ORDER BY fo.id
      ) tko
      OUTER APPLY (
        SELECT TOP 1 fo2.guest_name, fo2.guest_phone
        FROM dbo.food_orders fo2
        WHERE fo2.invoice_id = i.id AND fo2.guest_name IS NOT NULL
        ORDER BY fo2.id
      ) fo
      JOIN dbo.lodges l ON l.id = i.lodge_id
      WHERE i.id = @invoiceId AND i.lodge_id = @lodgeId
    `);
  const row = result.recordset[0];
  if (!row) {
    throw new ApiError('Bill not found.', 404);
  }
  const items = await loadFoodItemsByInvoice(pool, [invoiceId]);
  const invoice = mapInvoice(row);
  return { ...invoice, foodItems: invoice.kind === 'EVENT' ? cateringItemsOf(row, invoice) : items.get(String(invoiceId)) || [] };
}

async function listInvoices(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT TOP 200 i.*, dt.label AS table_label, fr.room_number AS tab_room_number, tko.order_number AS takeaway_order_number,
             COALESCE(b.guest_name, eb.organiser_name, rb.guest_name, fo.guest_name) AS guest_name,
             COALESCE(b.guest_phone, eb.organiser_phone, rb.guest_phone, fo.guest_phone) AS guest_phone,
             COALESCE(b.num_guests, CASE WHEN eb.id IS NULL THEN NULL
                 ELSE (SELECT MAX(x) FROM (VALUES (ISNULL(eb.final_pax, eb.expected_pax)), (eb.guaranteed_pax)) AS t(x)) END, rb.num_guests) AS num_guests,
             b.check_in_date, b.check_out_date,
             eb.title AS event_title, eb.event_type, ev.name AS venue_name,
             eb.start_at AS event_start_at, eb.end_at AS event_end_at, eb.pricing_breakdown AS event_breakdown,
             b.actual_check_in_at, b.actual_check_out_at, b.late_checkout_minutes,
             b.nightly_breakdown,
             r.room_number, c.name AS category_name,
             l.gstin, l.is_gst_registered, l.checkin_mode, l.check_out_time, l.name AS lodge_name,
             l.phone AS lodge_phone, l.address AS lodge_address, l.city AS lodge_city, l.state AS lodge_state,
             l.name_mr AS lodge_name_mr, l.address_mr AS lodge_address_mr,
             (SELECT STRING_AGG(ar.receipt_number, ', ') WITHIN GROUP (ORDER BY ar.id)
              FROM dbo.advance_receipts ar
              WHERE (ar.booking_id = i.booking_id OR ar.event_booking_id = i.event_booking_id)
                AND ar.status = 'ISSUED') AS advance_receipt_numbers,
             (SELECT pl.method, pl.amount, pl.reference
              FROM dbo.payment_lines pl
              WHERE pl.invoice_id = i.id
              ORDER BY pl.id
              FOR JSON PATH) AS payment_lines
      FROM dbo.invoices i
      -- LEFT, because a restaurant bill has no stay behind it. An inner join
      -- here silently hid every food-only invoice from the list and the detail.
      LEFT JOIN dbo.bookings b ON b.id = i.booking_id
      LEFT JOIN dbo.rooms r ON r.id = b.room_id
      LEFT JOIN dbo.room_categories c ON c.id = r.category_id
      LEFT JOIN dbo.dining_tables dt ON dt.id = i.table_id
      -- LEFT for the same reason: a function's bill has no stay and no table.
      LEFT JOIN dbo.event_bookings eb ON eb.id = i.event_booking_id
      LEFT JOIN dbo.event_venues ev ON ev.id = eb.venue_id
      -- The room a food-only bill was raised against, which is not b.room_id:
      -- such a bill has no booking behind it at all.
      LEFT JOIN dbo.rooms fr ON fr.id = i.room_id
      -- Room service is charged to whoever was actually staying there — see the
      -- matching OUTER APPLY in getInvoice() for why this can't just be b.
      OUTER APPLY (
        SELECT TOP 1 rb2.guest_name, rb2.guest_phone, rb2.num_guests
        FROM dbo.bookings rb2
        WHERE rb2.room_id = i.room_id AND rb2.actual_check_in_at IS NOT NULL
          AND rb2.actual_check_in_at <= i.created_at
          AND (rb2.actual_check_out_at IS NULL OR rb2.actual_check_out_at >= i.created_at)
        ORDER BY rb2.actual_check_in_at DESC
      ) rb
      -- A takeaway bill has neither a table nor a room to name it, so it is
      -- named by the one order it settled, reached through the back-link the
      -- invoice writes onto that order. The same order also carries whatever
      -- name and phone staff typed in at the till — see getInvoice().
      OUTER APPLY (
        SELECT TOP 1 fo.order_number, fo.guest_name, fo.guest_phone
        FROM dbo.food_orders fo
        WHERE fo.invoice_id = i.id AND fo.source = 'COUNTER'
        ORDER BY fo.id
      ) tko
      OUTER APPLY (
        SELECT TOP 1 fo2.guest_name, fo2.guest_phone
        FROM dbo.food_orders fo2
        WHERE fo2.invoice_id = i.id AND fo2.guest_name IS NOT NULL
        ORDER BY fo2.id
      ) fo
      JOIN dbo.lodges l ON l.id = i.lodge_id
      WHERE i.lodge_id = @lodgeId
      ORDER BY i.created_at DESC
    `);

  // The bills list renders the printed document straight from this payload, so
  // the item lines have to travel with it — fetched for the whole page in one
  // query rather than one per bill.
  const invoices = result.recordset.map(mapInvoice);
  const items = await loadFoodItemsByInvoice(pool, invoices.filter((i) => i.foodSubtotal > 0).map((i) => i.id));
  return invoices.map((invoice, index) => ({
    ...invoice,
    foodItems: invoice.kind === 'EVENT' ? cateringItemsOf(result.recordset[index], invoice) : items.get(String(invoice.id)) || [],
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

    // A function whose bill is voided goes back to confirmed, so it can be
    // billed again — the bill is what settled it.
    await new sql.Request(transaction)
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('invoiceId', sql.BigInt, invoiceId)
      .query(`
        UPDATE dbo.event_bookings SET status = 'CONFIRMED', updated_at = SYSDATETIMEOFFSET()
        WHERE lodge_id = @lodgeId AND status = 'SETTLED'
          AND id = (SELECT event_booking_id FROM dbo.invoices WHERE id = @invoiceId AND lodge_id = @lodgeId)
      `);

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
      SELECT o.source, o.table_id, o.room_id, t.label AS table_label, r.room_number,
             -- A counter order pays for itself, so it groups alone: the id is
             -- part of its key, and null for the two tabs that do accumulate.
             CASE WHEN o.source = 'COUNTER' THEN o.id END AS order_id,
             MAX(o.order_number) AS order_number,
             COUNT(*) AS order_count, SUM(o.subtotal) AS subtotal,
             MIN(o.placed_at) AS opened_at, MAX(o.delivered_at) AS last_delivered_at,
             -- Who a room tab is actually running for — the same guest the bill
             -- itself will name. A table tab has nobody behind it. A counter tab
             -- is always exactly one order (see tabIdentity), so MAX here is just
             -- that order's own guest_name/guest_phone, typed in at the till.
             COALESCE(rb.guest_name, MAX(o.guest_name)) AS guest_name,
             COALESCE(rb.guest_phone, MAX(o.guest_phone)) AS guest_phone
      FROM dbo.food_orders o
      LEFT JOIN dbo.dining_tables t ON t.id = o.table_id
      LEFT JOIN dbo.rooms r ON r.id = o.room_id
      OUTER APPLY (
        SELECT TOP 1 b.guest_name, b.guest_phone
        FROM dbo.bookings b
        WHERE o.source = 'ROOM' AND b.room_id = o.room_id AND b.status = 'CHECKED_IN'
        ORDER BY b.actual_check_in_at DESC
      ) rb
      WHERE o.lodge_id = @lodgeId AND o.status = 'DELIVERED' AND o.invoice_id IS NULL
        -- Every delivered, unbilled order is an open tab, including room
        -- service ordered against a live stay. Food is never folded into the
        -- stay bill, so a checked-in guest's room order has no other document
        -- to ride on: this queue is where it gets billed, and leaving it out
        -- would strand the charge with no way to collect it.
      GROUP BY o.source, o.table_id, o.room_id, t.label, r.room_number,
               CASE WHEN o.source = 'COUNTER' THEN o.id END,
               rb.guest_name, rb.guest_phone
      ORDER BY MIN(o.placed_at) ASC
    `);

  return result.recordset.map((row) => ({
    ...tabIdentity(row),
    guestName: row.guest_name ?? null,
    guestPhone: row.guest_phone ?? null,
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
             name_mr AS lodge_name_mr, address_mr AS lodge_address_mr,
             city AS lodge_city, state AS lodge_state
      FROM dbo.lodges WHERE id = @lodgeId
    `);
  const row = result.recordset[0];
  if (!row) throw new ApiError('Lodge not found.', 404);
  return row;
}

// A tab is one payer's running total, so the three ways food reaches someone
// who has no stay to charge it to are three separate tabs: a dining table, a
// room being served with nobody checked into it, and the counter. Merging any
// two of them would put one customer's food on another's bill.
//
// `source` is the discriminator, not a null table_id: the check constraint on
// food_orders guarantees it, and a room order has a null table_id too — which
// is exactly how room service used to end up inside the counter tab.
//
// A table and a room accumulate: the party sits there ordering more, and one
// bill closes the whole visit. The counter does not. Each takeaway is a
// stranger who pays and leaves, so it is a tab of exactly one order, keyed on
// that order's id — otherwise a day of walk-ins piles into a single 'counter'
// tab and the first person to be billed pays for all of them.
function tabIdentity(row) {
  if (row.source === 'TABLE') {
    return { tab: `table-${row.table_id}`, tableId: row.table_id, roomId: null, tableLabel: row.table_label };
  }
  if (row.source === 'ROOM') {
    return {
      tab: `room-${row.room_id}`,
      tableId: null,
      roomId: row.room_id,
      tableLabel: `Room ${row.room_number}`,
    };
  }
  // `id` is what the per-order loader selects, `order_id` what the grouped tab
  // list aliases it to; either identifies the one order this tab bills.
  const orderId = row.order_id ?? row.id ?? null;
  const orderNumber = row.order_number ?? null;
  return {
    tab: orderId == null ? 'counter' : `counter-${orderId}`,
    tableId: null,
    roomId: null,
    tableLabel: orderNumber == null ? 'Counter / takeaway' : `Takeaway #${orderNumber}`,
  };
}

// Turns the :tab path segment back into the SQL selecting exactly that tab's
// orders. Anything that isn't one of the three shapes is a bad request, not a
// server fault — rejected here rather than reaching the driver as a NaN bound
// to a BigInt, which is what surfaced as a 500.
function tabScope(request, tab) {
  const match = /^(table|room|counter)-(\d+)$/.exec(String(tab ?? ''));
  const id = match ? Number(match[2]) : NaN;
  if (!match || !Number.isSafeInteger(id) || id <= 0) {
    throw new ApiError('Unknown tab.', 400);
  }

  if (match[1] === 'table') {
    request.input('tableId', sql.BigInt, id);
    return "AND o.source = 'TABLE' AND o.table_id = @tableId";
  }
  if (match[1] === 'room') {
    request.input('roomId', sql.BigInt, id);
    return "AND o.source = 'ROOM' AND o.room_id = @roomId";
  }
  // One takeaway, one bill. Pinned to the order id rather than to
  // source='COUNTER', which would sweep every other walk-in still unbilled.
  request.input('orderId', sql.BigInt, id);
  return "AND o.source = 'COUNTER' AND o.id = @orderId";
}

async function loadUnbilledTabOrders(request, lodgeId, tab) {
  request.input('lodgeId', sql.BigInt, lodgeId);
  const scope = tabScope(request, tab);

  const result = await request.query(`
    SELECT o.id, o.order_number, o.subtotal, o.placed_at, o.source,
           o.table_id, o.room_id, t.label AS table_label, r.room_number,
           o.guest_name, o.guest_phone
    FROM dbo.food_orders o
    LEFT JOIN dbo.dining_tables t ON t.id = o.table_id
    LEFT JOIN dbo.rooms r ON r.id = o.room_id
    WHERE o.lodge_id = @lodgeId AND o.status = 'DELIVERED' AND o.invoice_id IS NULL
      ${scope}
    ORDER BY o.placed_at ASC
  `);

  return result.recordset.map((row) => ({
    id: row.id,
    orderNumber: row.order_number,
    subtotal: Number(row.subtotal),
    placedAt: row.placed_at,
    tableLabel: tabIdentity(row).tableLabel,
    // Only a counter/takeaway order carries its own name and phone — typed in
    // at the till because there is no booking or table to name it instead.
    guestName: row.guest_name ?? null,
    guestPhone: row.guest_phone ?? null,
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
        ...buildBreakdown({ roomSubtotal: 0, cgstAmount: 0, sgstAmount: 0, food, discountAmount: discount }),
      }
    : null;
  const nonGst = {
    documentType: 'CASH_RECEIPT',
    ...buildBreakdown({
      roomSubtotal: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      food: { ...food, cgstAmount: 0, sgstAmount: 0 },
      discountAmount: discount,
    }),
  };

  return { gst, nonGst, grossSubtotal, discount };
}

async function buildFoodBill(pool, lodge, orders, discountAmount, foodRate = null) {
  return priceFoodBill(lodge, orders, discountAmount, foodRate ?? (await getFoodRate(pool, lodge.is_specified_premises)));
}

async function previewFoodBill(lodgeId, tab, { discountAmount = 0, targetTotal = 0 } = {}) {
  const pool = await getPool();
  const lodge = await loadLodgeForBilling(pool, lodgeId);
  const orders = await loadUnbilledTabOrders(pool.request(), lodgeId, tab);

  if (orders.length === 0) {
    throw new ApiError('Nothing to bill here — no delivered orders are waiting.', 409);
  }

  // A room tab is food charged to whoever is actually staying there — the
  // same guest the checkout bill would name — so the preview looks the
  // guest up the same way resolveRoomBooking() does for the order itself.
  // A counter/takeaway tab has no booking behind it, but staff typed a name
  // and phone in at the till when the order was placed, and that travels
  // with the order itself. A table tab has neither, and stays blank.
  const roomMatch = /^room-(\d+)$/.exec(String(tab ?? ''));
  let guest = null;
  if (roomMatch) {
    const guestResult = await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('roomId', sql.BigInt, Number(roomMatch[1]))
      .query(`
        SELECT TOP 1 guest_name, guest_phone, num_guests
        FROM dbo.bookings
        WHERE lodge_id = @lodgeId AND room_id = @roomId AND status = 'CHECKED_IN'
        ORDER BY actual_check_in_at DESC
      `);
    guest = guestResult.recordset[0] ?? null;
  } else if (orders[0].guestName || orders[0].guestPhone) {
    guest = { guest_name: orders[0].guestName, guest_phone: orders[0].guestPhone };
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
    tab,
    tableLabel: orders[0].tableLabel,
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
      row: { ...lodge, ...guest },
      side: bill.gst ?? bill.nonGst,
      billingSide: lodge.is_gst_registered ? 'GST' : 'NON_GST',
      foodItems,
      lateCheckoutCharge: 0,
      kind: 'FOOD',
      tableLabel: orders[0].tableLabel,
    }),
  };
}

// Closes one tab — a table, a room being served with no stay behind it, or the
// counter: sweeps every delivered, unbilled order on *that tab* into one
// document and stamps them so a second close can't bill them again. Scoped to
// the one tab, so the other two keep their own orders and get their own bills.
async function issueFoodInvoice(lodgeId, userId, tab, input) {
  const pool = await getPool();
  const lodge = await loadLodgeForBilling(pool, lodgeId);
  const billingSide = lodge.is_gst_registered ? input.billingSide || 'GST' : 'NON_GST';

  // Same resolution as the stay bill: a table settles part cash, part UPI just
  // as a room does.
  const paymentLines = paymentLinesOf(input, input.collectedAmount ?? 0);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    // Read inside the transaction: two staff closing the same table at once
    // must not produce two bills for the same food.
    const orders = await loadUnbilledTabOrders(new sql.Request(transaction), lodgeId, tab);
    if (orders.length === 0) {
      throw new ApiError('Nothing to bill here — no delivered orders are waiting.', 409);
    }

    // Which of the three the tab is, so the document can name it. Derived from
    // the same segment the orders were selected by, so the bill can never claim
    // a table it did not sweep.
    const tabMatch = /^(table|room)-(\d+)$/.exec(String(tab ?? ''));
    const tabTableId = tabMatch?.[1] === 'table' ? Number(tabMatch[2]) : null;
    const tabRoomId = tabMatch?.[1] === 'room' ? Number(tabMatch[2]) : null;

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
        .input('prefix', sql.NVarChar, '')
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
      .input('tableId', sql.BigInt, tabTableId)
      .input('roomId', sql.BigInt, tabRoomId)
      .input('documentType', sql.NVarChar, documentType)
      .input('billingSide', sql.NVarChar, billingSide)
      .input('invoiceNumber', sql.NVarChar, `${prefix}${number}`)
      .input('foodSubtotal', sql.Decimal(10, 2), breakdown.foodSubtotal)
      .input('foodCgstAmount', sql.Decimal(10, 2), breakdown.foodCgstAmount)
      .input('foodSgstAmount', sql.Decimal(10, 2), breakdown.foodSgstAmount)
      .input('roundOff', sql.Decimal(10, 2), breakdown.roundOff)
      .input('totalAmount', sql.Decimal(10, 2), breakdown.totalAmount)
      .input('balanceCollected', sql.Decimal(10, 2), input.collectedAmount ?? 0)
      // A summary of the lines, not a rival to them: the first tender. Kept so
      // every existing reader — the register, the printed bill, the legacy
      // report path — keeps working untouched.
      .input('balancePaymentMethod', sql.NVarChar, paymentLines[0]?.method ?? null)
      .input('balanceReference', sql.NVarChar, paymentLines[0]?.reference ?? null)
      .input('discountAmount', sql.Decimal(10, 2), breakdown.discountAmount)
      .input('discountPercent', sql.Decimal(5, 2), breakdown.discountPercent)
      .input('createdBy', sql.BigInt, userId ?? null)
      .query(`
        INSERT INTO dbo.invoices
          (lodge_id, booking_id, table_id, room_id, document_type, billing_side, invoice_number,
           room_subtotal, cgst_amount, sgst_amount,
           food_subtotal, food_cgst_amount, food_sgst_amount,
           discount_amount, discount_percent,
           round_off, total_amount, advance_paid, balance_collected,
           balance_payment_method, balance_reference, created_by)
        OUTPUT inserted.id
        VALUES
          (@lodgeId, NULL, @tableId, @roomId, @documentType, @billingSide, @invoiceNumber,
           0, 0, 0,
           @foodSubtotal, @foodCgstAmount, @foodSgstAmount,
           @discountAmount, @discountPercent,
           @roundOff, @totalAmount, 0, @balanceCollected,
           @balancePaymentMethod, @balanceReference, @createdBy)
      `);

    const invoiceId = inserted.recordset[0].id;

    await insertPaymentLines(transaction, lodgeId, { invoiceId }, paymentLines);

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
  readPaymentLines,
  // Shared with eventBilling.service.js: a function's bill is the same
  // document as a stay's, built by the same arithmetic.
  buildBreakdown,
  cappedDiscount,
  computeFoodTax,
  getFoodRate,
  solveDiscountForTarget,
  findActiveEventInvoice,
  earlyCheckoutOf,
  // Shared with advanceReceipts.service.js: a receipt records how it was
  // tendered exactly as a bill does.
  insertPaymentLines,
  // Exported so the guest register and the booking detail can itemise a stay
  // with the same labels and the same aggregation the bill will use. A stay
  // that reads one way on the booking screen and another on its invoice is a
  // dispute waiting to happen.
  roomChargeLines,
  // The tax primitives, exported for the advance-receipt module. A receipt
  // voucher states the tax inside an advance, and it has to be the same tax the
  // final bill will report on the same money — computed by the same code, from
  // the same slabs, or the two documents disagree about a single stay.
  taxWithin,
  round2,
  // Shared with reports.service.js so the booking report states a bill's taxable
  // value by the same apportionment the bill itself was printed with.
  netOfDiscount,
  getGstSlabs,
  ratePercentFor,
  nightlyAmounts,
  listBillableBookings,
  previewBill,
  issueInvoice,
  getInvoice,
  listInvoices,
  voidInvoice,
  listOpenFoodTabs,
  previewFoodBill,
  issueFoodInvoice,
  // Exported for the tab-separation tests: which tab an order belongs to, and
  // which orders a tab selects, are the two halves of "one payer, one bill".
  tabIdentity,
  tabScope,
};
