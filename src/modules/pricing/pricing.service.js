const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');

function round2(n) {
  return Math.round(n * 100) / 100;
}

function toIsoDate(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

// checkOutDate is exclusive — a stay from the 13th to the 17th is four
// nights (13, 14, 15, 16), the same convention bookings price on.
function datesInRange(checkInDate, checkOutDate) {
  const dates = [];
  const cur = new Date(`${checkInDate}T00:00:00Z`);
  const end = new Date(`${checkOutDate}T00:00:00Z`);
  while (cur < end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function loadRoom(pool, lodgeId, roomId) {
  const roomResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roomId', sql.BigInt, roomId)
    .query(`
      SELECT r.id, r.room_number, r.dormitory_price,
             c.name AS category_name, c.base_price AS category_base_price
      FROM dbo.rooms r
      JOIN dbo.room_categories c ON c.id = r.category_id
      WHERE r.id = @roomId AND r.lodge_id = @lodgeId
    `);

  const room = roomResult.recordset[0];
  if (!room) {
    throw new ApiError('Room not found.', 404);
  }
  return room;
}

// A bed carries no price of its own — every bed in a dormitory room charges
// the room's own rate (loadRoom's dormitory_price). This only confirms the
// bed is real and actually belongs to roomId, so a bedId from a different
// room (or a different lodge's room) can't be priced in — the same
// lodge/room ownership check loadRoom already does for rooms — and supplies
// the label the bill line names.
async function loadBed(pool, roomId, bedId) {
  if (bedId == null) return null;
  const bedResult = await pool
    .request()
    .input('roomId', sql.BigInt, roomId)
    .input('bedId', sql.BigInt, bedId)
    .query('SELECT id, bed_label FROM dbo.dormitory_beds WHERE id = @bedId AND room_id = @roomId');

  const bed = bedResult.recordset[0];
  if (!bed) {
    throw new ApiError('Bed not found.', 404);
  }
  return { label: bed.bed_label };
}

// One or more beds in the same room, same shape as loadBed but for a
// booking that holds several beds at once. Order follows bedIds so the bill
// lists beds in the order they were picked, not id order.
async function loadBeds(pool, roomId, bedIds) {
  if (!bedIds || bedIds.length === 0) return [];
  const beds = await Promise.all(bedIds.map((bedId) => loadBed(pool, roomId, bedId)));
  return beds;
}

// Every season that touches any night in [checkInDate, checkOutDate) is
// fetched once for the whole range — a 30-night quote must not turn into 30
// round trips. end_date is inclusive in the table, start_date is compared
// against the exclusive checkout.
async function loadSeasons(pool, lodgeId, checkInDate, checkOutDate) {
  const seasonsResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('fromDate', sql.Date, checkInDate)
    .input('toDate', sql.Date, checkOutDate)
    .query(`
      SELECT name, adjustment_percent, start_date, end_date
      FROM dbo.seasons
      WHERE lodge_id = @lodgeId AND is_active = 1
        AND start_date < @toDate AND end_date >= @fromDate
      ORDER BY start_date ASC
    `);

  return seasonsResult.recordset.map((row) => ({
    name: row.name,
    percent: Number(row.adjustment_percent),
    startDate: toIsoDate(row.start_date),
    endDate: toIsoDate(row.end_date),
  }));
}

// A selection is "which extra, and how many of it" — three extra beds is one
// charge taken three times, not three charges. Callers may pass either shape:
// a bare id (or a legacy id array) means one of them, which is what every
// extra meant before quantities existed.
function normalizeSelections(selections) {
  const byId = new Map();
  for (const selection of selections || []) {
    const id = Number(typeof selection === 'object' && selection !== null ? selection.id : selection);
    if (!Number.isInteger(id) || id <= 0) continue;
    const rawQuantity = typeof selection === 'object' && selection !== null ? selection.quantity : 1;
    const quantity = Number(rawQuantity ?? 1);
    if (!Number.isFinite(quantity) || quantity < 1) continue;
    // What reception agreed for THIS booking, when they overrode it. Undefined
    // means "whatever the lodge charges", which is every extra that was not
    // haggled over. Zero is kept — a free extra is a real thing to give away.
    const rawPrice =
      typeof selection === 'object' && selection !== null ? selection.agreedAmount : undefined;
    // Trimmed before the emptiness test, because Number('   ') is 0 — a box
    // holding only spaces would otherwise make the extra free rather than
    // falling back to the lodge price.
    const hasPrice = rawPrice != null && String(rawPrice).trim() !== '';
    const agreedValue = hasPrice ? Number(rawPrice) : NaN;
    const agreed =
      hasPrice && Number.isFinite(agreedValue) && agreedValue >= 0 ? round2(agreedValue) : undefined;

    // The same id arriving twice is the desk asking for more of it, not a
    // duplicate to discard — chargeIds=3,3 is two extra beds. The last agreed
    // price wins, because the two halves describe one line.
    const prev = byId.get(id);
    byId.set(id, {
      quantity: (prev ? prev.quantity : 0) + Math.floor(quantity),
      agreedAmount: agreed !== undefined ? agreed : prev && prev.agreedAmount,
    });
  }
  return Array.from(byId, ([id, v]) => ({ id, quantity: v.quantity, agreedAmount: v.agreedAmount }));
}

// Accepts the query-string form used by /price-quote and /simulate:
// "3,5:2" is one of charge 3 and two of charge 5, and "5:2@80" is two of
// charge 5 at an agreed ₹80 each. The price is suffixed rather than given its
// own parameter so one string still describes the whole extras list.
function parseChargeSelections(raw) {
  return normalizeSelections(
    String(raw || '')
      .split(',')
      .map((part) => {
        const [spec, price] = String(part).split('@');
        const [id, quantity] = spec.split(':');
        return {
          id: Number(String(id).trim()),
          quantity: quantity == null ? 1 : Number(quantity),
          // Left undefined when absent, which normalizeSelections reads as
          // "charge whatever the lodge charges".
          agreedAmount: price == null || price.trim() === '' ? undefined : Number(price),
        };
      })
  );
}

async function loadCharges(pool, lodgeId, selections) {
  const wanted = normalizeSelections(selections);
  if (wanted.length === 0) return [];

  const chargesResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT id, name, charge_per_night, is_counter
      FROM dbo.switchable_charges
      WHERE lodge_id = @lodgeId AND is_active = 1
    `);

  const selectionById = new Map(wanted.map((s) => [s.id, s]));
  return chargesResult.recordset
    .filter((row) => selectionById.has(Number(row.id)))
    .map((row) => {
      const selection = selectionById.get(Number(row.id));
      const quantity = selection.quantity;
      const unitAmount = Number(row.charge_per_night);
      // What reception agreed for the whole line, per night. Replaces rate ×
      // count rather than standing in for the rate: "₹100 for the extra beds"
      // cannot be expressed as a per-bed figure when three of them divide it
      // into 33.33, which multiplies back to 99.99.
      const agreedAmount = selection.agreedAmount;
      return {
        id: Number(row.id),
        name: row.name,
        // Whether this extra is taken in counts (extra beds) or is simply on
        // or off (AC) — which decides whether its line shows the arithmetic.
        isCounter: !!row.is_counter,
        quantity,
        unitAmount,
        agreedAmount,
        amount: agreedAmount !== undefined ? round2(agreedAmount) : round2(unitAmount * quantity),
      };
    });
}

// The night's starting rate: whatever reception agreed for this booking if
// they overrode it, else the room's own rate if it has one (a dormitory
// room's own price — every bed in it, and a buyout of the whole room, all
// charge this same figure), else the category's own price. A non-positive
// or unparseable override is ignored rather than pricing a stay at zero.
//
// bed only ever supplies the label baseLabel prints, not the price — every
// bed in a room shares one rate, so there is nothing on the bed itself left
// to price against.
function basePriceOf(room, basePriceOverride) {
  const override = Number(basePriceOverride);
  if (basePriceOverride != null && Number.isFinite(override) && override > 0) return override;
  if (room.dormitory_price != null) return Number(room.dormitory_price);
  return Number(room.category_base_price);
}

// Rupees as they read on a bill line: Indian grouping, and no trailing .00 on
// the whole numbers most rates are.
function money(amount) {
  return `₹${Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

// The rate itself, not the words "base price". Every other line on the bill
// says what one night of that thing costs, and a guest checking their bill is
// multiplying those rates by the nights — "Deluxe — base price × 4 nights"
// gives them nothing to multiply.
//
// Named by the bed, not the category, when this stay is for one bed: "Bed
// L1 ₹450" is what the guest actually holds, and printing the category
// there ("Mixed Dorm ₹450") would read as the whole room's rate. The label
// itself carries no "Bed" prefix — it's already a name on its own ("L1",
// "Corner bed"), not a number that needs the word in front to read.
function baseLabel(room, basePriceOverride, bed = null) {
  const price = basePriceOf(room, basePriceOverride);
  const suffix = price === Number(room.category_base_price) ? '' : ' (custom)';
  if (bed) return `${bed.label} ${money(price)}${suffix}`;
  return `${room.category_name} ${money(price)}${suffix}`;
}

function seasonLabel(season) {
  return `${season.name} (${season.percent > 0 ? '+' : ''}${season.percent}%)`;
}

// Every extra states its nightly rate, and a counted one states the count too:
// "Extra bed 1 × ₹300" and "AC/Heater ₹200" against four nights each explain
// themselves, where a bare name and a total is a line a guest will argue with.
//
// The count shows on an uncounted extra somebody asked for more than one of,
// which the booking form can't do but the query-string form (chargeIds=3,3)
// can — better an odd-looking line than a quantity silently off the bill.
function chargeLabel(charge) {
  // An agreed line prints no rate: there isn't one. Showing "3 × ₹33.33" beside
  // an agreed ₹100 invites the guest to multiply it back and find a paisa
  // missing, which is the arithmetic this model exists to avoid.
  if (charge.agreedAmount !== undefined) {
    return charge.quantity > 1 ? `${charge.name} × ${charge.quantity}` : charge.name;
  }
  return charge.isCounter || charge.quantity > 1
    ? `${charge.name} ${charge.quantity} × ${money(charge.unitAmount)}`
    : `${charge.name} ${money(charge.unitAmount)}`;
}

// One night's line-by-line breakdown, from data already in memory. beds is
// zero or more dormitory beds this booking holds; each gets its own base
// price line at the room's rate, same as booking that many beds separately
// would total — an empty array (a whole-room or non-dormitory stay) falls
// back to the single room-rate line baseLabel already produced.
function priceNight(room, seasons, charges, dateStr, basePriceOverride = null, beds = []) {
  const lines = [];
  const nightRate = basePriceOf(room, basePriceOverride);
  let subtotal = 0;
  if (beds.length > 0) {
    for (const bed of beds) {
      lines.push({ label: baseLabel(room, basePriceOverride, bed), amount: nightRate, isBase: true });
      subtotal += nightRate;
    }
  } else {
    lines.push({ label: baseLabel(room, basePriceOverride, null), amount: nightRate, isBase: true });
    subtotal = nightRate;
  }

  for (const season of seasons) {
    if (dateStr < season.startDate || dateStr > season.endDate) continue;
    const amount = round2(subtotal * (season.percent / 100));
    lines.push({ label: seasonLabel(season), amount });
    subtotal += amount;
  }

  // Switchable charges (AC, extra bed) are added after the season
  // adjustment, flat — a ₹500 AC charge stays ₹500 during a +25% festival,
  // it never compounds with the season percentage.
  for (const charge of charges) {
    // chargeId and quantity ride along so the booking form can offer this
    // line as an editable total — a label alone cannot say which extra it is.
    lines.push({
      label: chargeLabel(charge),
      amount: charge.amount,
      chargeId: charge.id,
      quantity: charge.quantity,
    });
    subtotal += charge.amount;
  }

  return { date: dateStr, lines, total: round2(subtotal) };
}

// bedId is a single id for back-compat; bedIds (an array) is the multi-bed
// form. Passing both is not expected — bedIds wins when both are given.
async function simulate(
  lodgeId,
  roomId,
  dateStr,
  chargeSelections = [],
  basePriceOverride = null,
  bedId = null,
  bedIds = null
) {
  const pool = await getPool();
  const room = await loadRoom(pool, lodgeId, roomId);
  const beds = bedIds && bedIds.length > 0 ? await loadBeds(pool, roomId, bedIds) : bedId != null ? [await loadBed(pool, roomId, bedId)] : [];
  const seasons = await loadSeasons(pool, lodgeId, dateStr, addDays(dateStr, 1));
  const charges = await loadCharges(pool, lodgeId, chargeSelections);

  const night = priceNight(room, seasons, charges, dateStr, basePriceOverride, beds);

  return {
    roomNumber: room.room_number,
    date: dateStr,
    lines: night.lines,
    total: night.total,
  };
}

// A whole stay in one call. `lines` is the same shape the single-date
// simulate returns — each label summed across the nights it applied to — so
// the panel can show a stay total the same way it shows one night.
// bedId is a single id for back-compat; bedIds (an array) is the multi-bed
// form. Passing both is not expected — bedIds wins when both are given.
async function simulateRange(
  lodgeId,
  roomId,
  checkInDate,
  checkOutDate,
  chargeSelections = [],
  basePriceOverride = null,
  bedId = null,
  bedIds = null
) {
  const pool = await getPool();
  const room = await loadRoom(pool, lodgeId, roomId);
  const beds = bedIds && bedIds.length > 0 ? await loadBeds(pool, roomId, bedIds) : bedId != null ? [await loadBed(pool, roomId, bedId)] : [];
  const seasons = await loadSeasons(pool, lodgeId, checkInDate, checkOutDate);
  const charges = await loadCharges(pool, lodgeId, chargeSelections);

  const nights = datesInRange(checkInDate, checkOutDate).map((date) =>
    priceNight(room, seasons, charges, date, basePriceOverride, beds)
  );

  // Seeded in the order a night is priced — base (one label per bed, or the
  // single room line), then seasons, then extras — so a season that only
  // covers the tail of the stay still reads above the extras instead of
  // wherever the first night happened to put it.
  const totals = new Map();
  const baseLabels = beds.length > 0 ? beds.map((bed) => baseLabel(room, basePriceOverride, bed)) : [baseLabel(room, basePriceOverride, null)];
  for (const label of [...baseLabels, ...seasons.map(seasonLabel)]) {
    if (!totals.has(label)) totals.set(label, { label, amount: 0, nights: 0, isBase: baseLabels.includes(label) });
  }
  for (const charge of charges) {
    const label = chargeLabel(charge);
    if (!totals.has(label)) {
      totals.set(label, { label, amount: 0, nights: 0, chargeId: charge.id, quantity: charge.quantity });
    }
  }

  let total = 0;
  for (const night of nights) {
    for (const line of night.lines) {
      const prev =
        totals.get(line.label) ||
        {
          label: line.label,
          amount: 0,
          nights: 0,
          isBase: line.isBase,
          chargeId: line.chargeId,
          quantity: line.quantity,
        };
      prev.amount = round2(prev.amount + line.amount);
      prev.nights += 1;
      totals.set(line.label, prev);
    }
    total += night.total;
  }

  return {
    roomNumber: room.room_number,
    checkInDate,
    checkOutDate,
    nightCount: nights.length,
    nights,
    lines: Array.from(totals.values()).filter((line) => line.nights > 0),
    total: round2(total),
  };
}

module.exports = { simulate, simulateRange, normalizeSelections, parseChargeSelections };
