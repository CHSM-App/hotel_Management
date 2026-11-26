// Writes flutter_frontend/test/fixtures/pricing_golden.json.
//
// The Flutter app prices stays and bills on the device when there is no
// network (lib/domain/pricing/*). That arithmetic must agree with the server's
// to the paisa, or a guest billed offline is asked for a different amount when
// the same bill is issued at sync. So the expected values here are not written
// by hand: every one comes from the REAL server functions —
// bookings.service.priceStay (through a fake database), billing.service
// .priceStayBill, and lateCheckout.js — run over a few hundred generated
// scenarios. The Dart tests then require an exact match.
//
//   node scripts/dump-pricing-fixtures.js
//
// Deterministic (seeded), so a diff in the output is a diff in the server's
// arithmetic, never in the dice.

const fs = require('node:fs');
const path = require('node:path');

// The services destructure getPool at load time, so it is replaced before they
// are first required. Nothing here touches a real database.
const connection = require('../src/config/connection');
let fake = null;
connection.getPool = async () => ({
  request() {
    const inputs = {};
    return {
      input(name, _type, value) {
        inputs[name] = value;
        return this;
      },
      async query(text) {
        return { recordset: fake(text, inputs) };
      },
    };
  },
});

const bookingsService = require('../src/modules/bookings/bookings.service');
const billingService = require('../src/modules/billing/billing.service');
const lateCheckout = require('../src/modules/bookings/lateCheckout');

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(20261117);
const pick = (list) => list[Math.floor(R() * list.length)];
const int = (lo, hi) => lo + Math.floor(R() * (hi - lo + 1));
const chance = (p) => R() < p;

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const CHARGES = [
  { id: 1, name: 'AC/Heater', chargePerNight: 200, isCounter: false, hiddenWhenChargeId: null },
  { id: 2, name: 'Extra bed', chargePerNight: 300, isCounter: true, hiddenWhenChargeId: null },
  { id: 3, name: 'Geyser', chargePerNight: 149.5, isCounter: false, hiddenWhenChargeId: null },
  { id: 4, name: 'Non-AC', chargePerNight: 0, isCounter: false, hiddenWhenChargeId: 1 },
];

async function quoteScenario() {
  const base = pick([800, 999, 1000, 1200, 1500, 2200, 3000, 4500, 7500, 7501]);
  const checkIn = addDays('2026-11-01', int(0, 40));
  const nights = int(1, 6);
  const checkOut = addDays(checkIn, nights);

  const seasons = [];
  for (let i = int(0, 3); i > 0; i--) {
    const start = addDays(checkIn, int(-3, nights + 2));
    seasons.push({
      name: pick(['Diwali', 'Peak', 'Monsoon', 'Wedding']),
      percent: pick([-20, -10, 5, 10, 12.5, 25, 33.33]),
      startDate: start,
      endDate: addDays(start, int(0, 9)),
      isActive: true,
    });
  }
  seasons.sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));

  const selections = [];
  const usable = CHARGES.filter((c) => c.id !== 4);
  for (const c of usable) {
    if (!chance(0.45)) continue;
    const sel = { id: c.id, quantity: c.isCounter ? int(1, 3) : 1 };
    if (chance(0.3)) sel.agreedAmount = pick([0, 100, 250, 333.33]);
    selections.push(sel);
  }

  const room = { categoryBasePrice: base, categoryName: pick(['Deluxe', 'Standard', 'Suite']) };
  const basePriceOverride = pick([null, null, null, 1000, 1234.56]);
  const discount = pick([0, 0, 0, 100, 250.5, 1000, 99999]);

  fake = (text, inputs) => {
    if (text.includes('FROM dbo.rooms r')) {
      return [
        { id: 1, room_number: '101', dormitory_price: null, category_name: room.categoryName, category_base_price: base },
      ];
    }
    if (text.includes('FROM dbo.seasons')) {
      return seasons
        .filter((s) => s.startDate < inputs.toDate && s.endDate >= inputs.fromDate)
        .map((s) => ({
          name: s.name,
          adjustment_percent: s.percent,
          start_date: s.startDate,
          end_date: s.endDate,
        }));
    }
    if (text.includes('FROM dbo.switchable_charges')) {
      return CHARGES.map((c) => ({
        id: c.id,
        name: c.name,
        charge_per_night: c.chargePerNight,
        is_counter: c.isCounter ? 1 : 0,
        hidden_when_charge_id: c.hiddenWhenChargeId,
      }));
    }
    throw new Error(`fixture db: unexpected query ${text.slice(0, 60)}`);
  };

  const out = await bookingsService.priceStay(1, 1, checkIn, checkOut, selections, basePriceOverride, discount, null, null);
  return {
    input: { room, seasons, charges: CHARGES, selections, checkIn, checkOut, basePriceOverride, discount },
    expected: {
      nights: out.nights.map((n) => ({ date: n.date, total: n.total })),
      charges: out.charges.map((c) => ({
        label: c.label,
        amount: c.amount,
        isBase: c.isBase,
        chargeId: c.chargeId ?? null,
        quantity: c.quantity ?? null,
      })),
      grossTotal: out.grossTotal,
      discountAmount: out.discountAmount,
      totalPrice: out.totalPrice,
    },
  };
}

const SLAB_SETS = [
  [
    { maxAmount: 1000, ratePercent: 0 },
    { maxAmount: 7500, ratePercent: 5 },
    { maxAmount: null, ratePercent: 18 },
  ],
  [
    { maxAmount: 2000, ratePercent: 12 },
    { maxAmount: null, ratePercent: 18 },
  ],
];

function billScenario() {
  const nightCount = int(1, 6);
  const amounts = Array.from({ length: nightCount }, () =>
    pick([500, 999, 1000, 1001, 1200, 2500, 7499, 7500, 7501, 9000, 1234.56, 2999.99])
  );
  const late = pick([0, 0, 150, 800, 1234.5]);
  const includeLate = chance(0.7);
  const discount = pick([0, 0, 100, 333.33, 2000, 100000]);
  const gstRegistered = chance(0.7);
  const food = chance(0.3) ? [{ subtotal: pick([250, 480.5, 1200]) }] : [];
  const slabs = pick(SLAB_SETS);
  const foodRate = { ratePercent: pick([5, 18]), sacCode: '996331' };

  const booking = {
    nightly_breakdown: JSON.stringify(amounts.map((total, i) => ({ date: addDays('2026-11-01', i), total, lines: [] }))),
    late_checkout_charge: late,
    is_gst_registered: gstRegistered,
  };
  const bill = billingService.priceStayBill(booking, food, {
    includeLateCheckout: includeLate,
    discountAmount: discount,
    slabs,
    foodRate,
    services: [],
  });
  return {
    input: { amounts, late, includeLate, discount, gstRegistered, food, slabs, foodRate },
    expected: { gst: bill.gst, nonGst: bill.nonGst, grossSubtotal: bill.grossSubtotal, discount: bill.discount },
  };
}

function lateScenario() {
  const mode = pick(['CYCLE', 'NIGHT_BASED', 'HOUR_24', 'HYBRID']);
  const checkInDate = addDays('2026-11-01', int(0, 20));
  const planned = int(1, 4);
  const checkOutDate = addDays(checkInDate, planned);
  const checkOutTime = pick(['09:00:00', '11:00:00', '12:00:00']);
  const checkInTime = pick(['12:00:00', '14:00:00']);
  const earlyArrivalFrom = pick([null, '05:00:00', '08:00:00']);
  // Arrival as a real instant: the property's wall clock is IST (UTC+5:30).
  const arrivalHour = int(0, 23);
  const arrivalMinute = pick([0, 15, 30, 45]);
  const arrivedIst = `${checkInDate}T${String(arrivalHour).padStart(2, '0')}:${String(arrivalMinute).padStart(2, '0')}:00+05:30`;
  const actualCheckInAt = new Date(arrivedIst).toISOString();
  const deadlineGuess = lateCheckout.atLocalTime(checkOutDate, checkOutTime).getTime();
  const at = new Date(deadlineGuess + int(-300, 3000) * 60000).toISOString();
  const policy = {
    lateGraceMinutes: pick([0, 15, 30, 60]),
    lateHalfDayPercent: pick([25, 50]),
    lateFullDayAfterMinutes: pick([240, 360]),
    lateFullDayPercent: pick([75, 100]),
  };
  const lastNightRate = pick([800, 1200, 2500, 3999.5]);

  const deadline = lateCheckout.checkoutDeadline({
    checkinMode: mode,
    checkOutTime,
    checkInTime,
    earlyArrivalFrom,
    checkInDate,
    checkOutDate,
    actualCheckInAt,
  });
  const minutesLate = lateCheckout.overdueMinutes(deadline, new Date(at));
  const plannedNights = lateCheckout.nightsBetween(checkInDate, checkOutDate);
  const isCycle = mode === 'CYCLE' && actualCheckInAt;
  const actualNights = isCycle
    ? lateCheckout.cycleNights({
        checkOutTime,
        actualCheckInAt,
        at: new Date(at),
        graceMinutes: policy.lateGraceMinutes,
      })
    : plannedNights;
  const extraNights = Math.max(0, actualNights - plannedNights);
  const suggestion = isCycle
    ? lateCheckout.suggestCycleCharge(extraNights, lastNightRate)
    : lateCheckout.suggestLateCharge(policy, minutesLate, lastNightRate);

  return {
    input: { mode, checkInDate, checkOutDate, checkOutTime, checkInTime, earlyArrivalFrom, actualCheckInAt, at, policy, lastNightRate },
    expected: {
      plannedNights,
      actualNights,
      extraNights,
      deadline: deadline.toISOString(),
      minutesLate,
      lateLabel: lateCheckout.lateLabel(minutesLate),
      isLate: minutesLate > 0,
      isChargeable: suggestion.amount > 0,
      suggestedCharge: suggestion.amount,
      band: suggestion.band,
      percent: suggestion.percent,
    },
  };
}

(async () => {
  const quotes = [];
  for (let i = 0; i < 300; i++) quotes.push(await quoteScenario());
  const bills = Array.from({ length: 300 }, billScenario);
  const late = Array.from({ length: 150 }, lateScenario);

  const target = path.join(__dirname, '../../flutter_frontend/test/fixtures/pricing_golden.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ generatedBy: 'backend/scripts/dump-pricing-fixtures.js', quotes, bills, late }));
  console.log(`wrote ${quotes.length} quotes, ${bills.length} bills, ${late.length} late checkouts -> ${target}`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
