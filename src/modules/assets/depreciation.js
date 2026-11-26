// WDV (written down value / declining balance) depreciation at Income Tax
// Act block rates — what hotels and their CAs actually use, unlike
// straight-line. Pure functions, no DB access, so the P/L report and any
// other caller share one implementation.
//
// Indian financial year: 1 Apr to 31 Mar. An asset first used for less than
// 180 days in its year of purchase gets only half the block rate for that
// year (Income Tax Act, standard block-of-assets rule); every full year
// after gets the whole rate, applied to the opening WDV (cost less whatever
// has already been written off). Retiring an asset stops depreciation from
// the start of the financial year *after* the one it died in — the FY it
// died in still depreciates normally, same as the Act's own block treatment
// (a mid-year disposal doesn't pro-rate the block's depreciation for that
// year).

// The mssql driver hands DATE columns back as JS Date objects (UTC
// midnight), the API layer and tests pass 'YYYY-MM-DD' strings — normalise
// both to the string form every function below works in.
function toIso(d) {
  if (d == null || d === '') return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

function fyStart(dateIso) {
  // FY 2025-26 runs 1 Apr 2025 – 31 Mar 2026. A date in Jan–Mar belongs to
  // the FY that started the previous calendar April.
  const d = new Date(`${toIso(dateIso)}T00:00:00Z`);
  const year = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${year}-04-01`;
}

function fyEnd(fyStartIso) {
  const year = Number(fyStartIso.slice(0, 4)) + 1;
  return `${year}-03-31`;
}

function daysBetweenInclusive(fromIso, toIsoStr) {
  const from = new Date(`${fromIso}T00:00:00Z`);
  const to = new Date(`${toIsoStr}T00:00:00Z`);
  return Math.round((to - from) / 86400000) + 1;
}

function addDays(dateIso, days) {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

const max = (a, b) => (a > b ? a : b);
const min = (a, b) => (a < b ? a : b);

// null/undefined = no rate assigned yet; 0 is a real rate (a block that
// doesn't depreciate) and must not be skipped.
function missingReason(asset) {
  if (asset.purchaseCost == null) return 'No purchase cost on file';
  if (!toIso(asset.purchaseDate)) return 'No purchase date on file';
  if (asset.depreciationRatePercent == null) return 'Category has no depreciation rate set';
  return null;
}

// Every financial year an asset was held, from its purchase FY up to (and
// including) toDate's FY — each with its opening WDV, the rate that applies
// (half in the purchase year if held under 180 days, full otherwise), the
// depreciation charged, and closing WDV. heldFrom/heldTo bound the days of
// that FY the asset was actually owned (purchase date to FY end in the first
// year, up to dead_date in the retirement year): the year's depreciation is
// spread over exactly those days, never over days before purchase or after
// disposal. Stops accruing from the FY after the asset's dead_date.
function yearlyScheduleForAsset(asset, toDate) {
  if (missingReason(asset)) return [];

  const purchaseDate = toIso(asset.purchaseDate);
  const deadDate = toIso(asset.deadDate);
  const to = toIso(toDate);
  const rate = Number(asset.depreciationRatePercent) / 100;
  const purchaseFy = fyStart(purchaseDate);
  const scheduleEndFy = fyStart(deadDate && deadDate < to ? deadDate : to);

  const years = [];
  let wdv = Number(asset.purchaseCost);
  let cursorFy = purchaseFy;

  while (cursorFy <= scheduleEndFy) {
    const end = fyEnd(cursorFy);
    const isPurchaseYear = cursorFy === purchaseFy;
    const heldFrom = isPurchaseYear ? purchaseDate : cursorFy;
    const heldTo = deadDate && deadDate < end ? deadDate : end;
    const halfRate = isPurchaseYear && daysBetweenInclusive(purchaseDate, end) < 180;
    const effectiveRate = halfRate ? rate / 2 : rate;

    // WDV: rate x what's left. SLM: rate x original cost, the same every
    // year, never more than what's left (so it stops at nil).
    const base = asset.depreciationMethod === 'SLM' ? Number(asset.purchaseCost) : wdv;
    const depreciation = round2(Math.min(wdv, base * effectiveRate));
    const closingWdv = round2(Math.max(0, wdv - depreciation));

    years.push({ fyStart: cursorFy, fyEnd: end, heldFrom, heldTo, openingWdv: round2(wdv), rate: effectiveRate, depreciation, closingWdv });

    wdv = closingWdv;
    cursorFy = addDays(end, 1);
  }

  return years;
}

// The slice of one FY's depreciation that falls inside [fromDate, toDate] —
// spread evenly across the days the asset was held that year. A management
// P/L for "1 Jun to 30 Jun" needs one month of a year's depreciation, not
// the whole year's figure or none of it.
function apportion(yearRow, fromDate, toDate) {
  const overlapStart = max(yearRow.heldFrom, fromDate);
  const overlapEnd = min(yearRow.heldTo, toDate);
  if (overlapStart > overlapEnd) return 0;
  const heldDays = daysBetweenInclusive(yearRow.heldFrom, yearRow.heldTo);
  const overlapDays = daysBetweenInclusive(overlapStart, overlapEnd);
  return round2(yearRow.depreciation * (overlapDays / heldDays));
}

// Depreciation expense for one asset falling inside [fromDate, toDate], plus
// its book value as of toDate: cost less everything accrued up to toDate
// (not the whole financial year's closing WDV, which would already include
// depreciation for days after toDate). Not yet bought by toDate, or retired
// on/before it, means nothing on the books: book value 0.
function depreciationForAsset(asset, fromDate, toDate) {
  const from = toIso(fromDate);
  const to = toIso(toDate);
  const purchaseDate = toIso(asset.purchaseDate);
  const deadDate = toIso(asset.deadDate);
  const years = yearlyScheduleForAsset(asset, to);
  const periodDepreciation = round2(years.reduce((sum, y) => sum + apportion(y, from, to), 0));
  const accruedToDate = years.reduce((sum, y) => sum + apportion(y, '0000-01-01', to), 0);
  const gone = purchaseDate > to || (deadDate && deadDate <= to);
  const bookValue = gone ? 0 : round2(Math.max(0, Number(asset.purchaseCost) - accruedToDate));
  return { periodDepreciation, bookValue, years };
}

// Summed across every asset with a purchase cost, date and category rate —
// assets missing any are skipped rather than guessed at, and reported
// separately so the P/L can flag them instead of silently under-depreciating.
function depreciationForAssets(assets, fromDate, toDate) {
  let totalDepreciation = 0;
  let totalBookValue = 0;
  const byAsset = [];
  const skipped = [];

  for (const asset of assets) {
    const reason = missingReason(asset);
    if (reason) {
      skipped.push({ id: asset.id, name: asset.name, reason });
      continue;
    }
    const { periodDepreciation, bookValue } = depreciationForAsset(asset, fromDate, toDate);
    totalDepreciation = round2(totalDepreciation + periodDepreciation);
    totalBookValue = round2(totalBookValue + bookValue);
    byAsset.push({
      id: asset.id,
      name: asset.name,
      categoryName: asset.categoryName,
      periodDepreciation,
      bookValue,
    });
  }

  return { totalDepreciation, totalBookValue, byAsset, skipped };
}

// Standard Income Tax Act block rates — offered as presets when an owner
// assigns a category to a block; rate_percent is what's actually stored and
// used, this is only for the picker.
const IT_ACT_BLOCKS = [
  { block: 'Buildings', ratePercent: 10 },
  { block: 'Furniture & Fixtures', ratePercent: 10 },
  { block: 'Plant & Machinery', ratePercent: 15 },
  { block: 'Computers & Software', ratePercent: 40 },
  { block: 'Motor Vehicles', ratePercent: 15 },
];

module.exports = {
  fyStart,
  fyEnd,
  yearlyScheduleForAsset,
  depreciationForAsset,
  depreciationForAssets,
  IT_ACT_BLOCKS,
};

// ponytail: no test framework in this backend (node --test exists but this
// module has no db dependency to mock) — a runnable self-check instead.
// `node src/modules/assets/depreciation.js` exercises the 180-day rule, the
// multi-year WDV decline, and period apportionment.
if (require.main === module) {
  const assert = require('assert');

  // Bought 15 Aug 2024 (FY24-25 starts 1 Apr 2024) — held from 15 Aug to
  // 31 Mar 2025 = 229 days, over 180, so full rate applies even in the
  // purchase year.
  const fullRateAsset = {
    id: 1, name: 'AC', categoryName: 'Cooling', purchaseDate: '2024-08-15',
    purchaseCost: 100000, depreciationRatePercent: 15, deadDate: null,
  };
  let years = yearlyScheduleForAsset(fullRateAsset, '2026-03-31');
  assert.strictEqual(years.length, 2, 'expected two FYs of schedule');
  assert.strictEqual(years[0].rate, 0.15, 'full rate year 1 (held >=180 days)');
  assert.strictEqual(years[0].depreciation, 15000, '15% of 100000');
  assert.strictEqual(years[0].closingWdv, 85000);
  assert.strictEqual(years[1].openingWdv, 85000);
  assert.strictEqual(years[1].depreciation, 12750, '15% of 85000');

  // Bought 15 Dec 2024 — held 15 Dec to 31 Mar = 107 days, under 180, so
  // half rate in the purchase year.
  const halfRateAsset = {
    id: 2, name: 'Fridge', categoryName: 'Kitchen', purchaseDate: '2024-12-15',
    purchaseCost: 50000, depreciationRatePercent: 15, deadDate: null,
  };
  years = yearlyScheduleForAsset(halfRateAsset, '2025-03-31');
  assert.strictEqual(years.length, 1);
  assert.strictEqual(years[0].rate, 0.075, 'half rate (held <180 days)');
  assert.strictEqual(years[0].depreciation, 3750, '7.5% of 50000');

  // Bought 15 Aug 2024: the year's 15000 spreads over the 229 held days, so 15-31 Aug (17 days) gets 17/229.
  const oneYear = yearlyScheduleForAsset(fullRateAsset, '2025-03-31')[0];
  const q1 = apportion(oneYear, "2024-04-01", "2024-08-31");
  // Everything before 15 Aug is outside the held window and contributes nothing.
  assert.ok(Math.abs(q1 - 1113.54) < 0.02, `expected ~1113.54, got ${q1}`);

  // An asset with no category rate is skipped, not silently zero.
  const { totalDepreciation, skipped } = depreciationForAssets(
    [{ ...fullRateAsset, depreciationRatePercent: null }],
    '2024-04-01',
    '2025-03-31'
  );
  assert.strictEqual(totalDepreciation, 0);
  assert.strictEqual(skipped.length, 1);
  assert.strictEqual(skipped[0].reason, 'Category has no depreciation rate set');

  // Date objects (what mssql returns) behave exactly like strings.
  years = yearlyScheduleForAsset({ ...fullRateAsset, purchaseDate: new Date('2024-08-15') }, new Date('2025-03-31'));
  assert.strictEqual(years.length, 1);
  assert.strictEqual(years[0].depreciation, 15000);

  // No depreciation before purchase: fridge bought 15 Dec 2024, report for
  // Apr–Jun 2024 must be 0 and its book value 0 (not on the books yet).
  let r = depreciationForAsset(halfRateAsset, '2024-04-01', '2024-06-30');
  assert.strictEqual(r.periodDepreciation, 0);
  assert.strictEqual(r.bookValue, 0);

  // Whole purchase FY gets the whole year's 3750, spread over the 107 held days.
  r = depreciationForAsset(halfRateAsset, '2024-04-01', '2025-03-31');
  assert.strictEqual(r.periodDepreciation, 3750);
  assert.strictEqual(r.bookValue, 46250);

  // Book value mid-year is cost less depreciation accrued so far: first 54
  // of 107 held days (15 Dec – 6 Feb) = 3750 * 54/107 = 1892.52.
  r = depreciationForAsset(halfRateAsset, '2024-12-15', '2025-02-06');
  assert.ok(Math.abs(r.periodDepreciation - 1892.52) < 0.02, String(r.periodDepreciation));
  assert.ok(Math.abs(r.bookValue - (50000 - 1892.52)) < 0.02);

  // Retired asset: depreciates only up to dead_date, then book value 0.
  const dead = { ...fullRateAsset, deadDate: '2024-10-31' };
  r = depreciationForAsset(dead, '2024-04-01', '2025-03-31');
  assert.strictEqual(r.periodDepreciation, 15000, 'retirement FY still gets the whole year');
  assert.strictEqual(r.bookValue, 0);
  r = depreciationForAsset(dead, '2024-11-01', '2025-03-31');
  assert.strictEqual(r.periodDepreciation, 0, 'nothing after disposal');

  // A 0% rate is a real rate, not "missing".
  assert.strictEqual(depreciationForAssets([{ ...fullRateAsset, depreciationRatePercent: 0 }], '2024-04-01', '2025-03-31').skipped.length, 0);

  // Straight-line: 10% of cost every year, stops at nil after 10 years.
  const slm = { id: 9, name: 'Bed', categoryName: 'Furniture', purchaseDate: '2020-04-01', purchaseCost: 100000, depreciationRatePercent: 10, depreciationMethod: 'SLM', deadDate: null };
  years = yearlyScheduleForAsset(slm, '2032-03-31');
  assert.strictEqual(years.length, 12);
  assert.ok(years.slice(0, 10).every((y) => y.depreciation === 10000), 'flat 10000 for 10 years');
  assert.strictEqual(years[9].closingWdv, 0);
  assert.strictEqual(years[10].depreciation, 0, 'nothing once fully written down');
  // Same asset on WDV declines instead.
  years = yearlyScheduleForAsset({ ...slm, depreciationMethod: 'WDV' }, '2023-03-31');
  assert.deepStrictEqual(years.map((y) => y.depreciation), [10000, 9000, 8100]);
  // SLM half-rate purchase year: bought 15 Dec 2024, 15% -> 7.5% of cost, then full 15% of cost.
  years = yearlyScheduleForAsset({ ...halfRateAsset, depreciationMethod: 'SLM' }, '2026-03-31');
  assert.deepStrictEqual(years.map((y) => y.depreciation), [3750, 7500]);

  console.log('depreciation.js self-check passed');
}
