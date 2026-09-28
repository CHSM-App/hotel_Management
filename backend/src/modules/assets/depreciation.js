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

function fyStart(dateIso) {
  // FY 2025-26 runs 1 Apr 2025 – 31 Mar 2026. A date in Jan–Mar belongs to
  // the FY that started the previous calendar April.
  const d = new Date(`${dateIso}T00:00:00Z`);
  const year = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${year}-04-01`;
}

function fyEnd(fyStartIso) {
  const year = Number(fyStartIso.slice(0, 4)) + 1;
  return `${year}-03-31`;
}

function daysBetweenInclusive(fromIso, toIso) {
  const from = new Date(`${fromIso}T00:00:00Z`);
  const to = new Date(`${toIso}T00:00:00Z`);
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

// Every financial year an asset was held, from its purchase FY up to (and
// including) toDate's FY — each with its opening WDV, the rate that applies
// (half in the purchase year if held under 180 days, full otherwise), the
// depreciation charged, and closing WDV. Stops accruing from the FY after
// the asset's dead_date, if any — a retired asset's WDV just sits at
// whatever it closed at.
function yearlyScheduleForAsset(asset, toDate) {
  if (!asset.purchaseDate || asset.purchaseCost == null || !asset.depreciationRatePercent) {
    return [];
  }

  const rate = Number(asset.depreciationRatePercent) / 100;
  const purchaseFy = fyStart(asset.purchaseDate);
  const scheduleEndFy = fyStart(asset.deadDate && asset.deadDate < toDate ? asset.deadDate : toDate);

  const years = [];
  let wdv = Number(asset.purchaseCost);
  let cursorFy = purchaseFy;

  while (cursorFy <= scheduleEndFy) {
    const end = fyEnd(cursorFy);
    const isPurchaseYear = cursorFy === purchaseFy;
    const heldDays = isPurchaseYear ? daysBetweenInclusive(asset.purchaseDate, end) : null;
    const halfRate = isPurchaseYear && heldDays < 180;
    const effectiveRate = halfRate ? rate / 2 : rate;

    const depreciation = round2(wdv * effectiveRate);
    const closingWdv = round2(Math.max(0, wdv - depreciation));

    years.push({ fyStart: cursorFy, fyEnd: end, openingWdv: round2(wdv), rate: effectiveRate, depreciation, closingWdv });

    wdv = closingWdv;
    cursorFy = addDays(fyEnd(cursorFy), 1);
  }

  return years;
}

// The slice of one FY's depreciation that falls inside [fromDate, toDate] —
// spread evenly across the FY's days. A management P/L for "1 Jun to 30
// Jun" needs one month of a year's depreciation, not the whole year's
// figure or none of it.
function apportion(yearRow, fromDate, toDate) {
  const overlapStart = yearRow.fyStart > fromDate ? yearRow.fyStart : fromDate;
  const overlapEnd = yearRow.fyEnd < toDate ? yearRow.fyEnd : toDate;
  if (overlapStart > overlapEnd) return 0;
  const fyDays = daysBetweenInclusive(yearRow.fyStart, yearRow.fyEnd);
  const overlapDays = daysBetweenInclusive(overlapStart, overlapEnd);
  return round2(yearRow.depreciation * (overlapDays / fyDays));
}

// Depreciation expense for one asset falling inside [fromDate, toDate], plus
// its book value as of toDate (closing WDV of the last scheduled year at or
// before toDate) — the two figures a P/L and a balance sheet each need.
function depreciationForAsset(asset, fromDate, toDate) {
  const years = yearlyScheduleForAsset(asset, toDate);
  const periodDepreciation = round2(years.reduce((sum, y) => sum + apportion(y, fromDate, toDate), 0));
  const bookValue = years.length > 0 ? years[years.length - 1].closingWdv : Number(asset.purchaseCost ?? 0);
  return { periodDepreciation, bookValue, years };
}

// Summed across every asset with a purchase cost and a category rate —
// assets missing either (no cost on file, or a category nobody's assigned a
// block to yet) are skipped rather than guessed at, and reported separately
// so the P/L can flag them instead of silently under-depreciating.
function depreciationForAssets(assets, fromDate, toDate) {
  let totalDepreciation = 0;
  let totalBookValue = 0;
  const byAsset = [];
  const skipped = [];

  for (const asset of assets) {
    if (!asset.purchaseDate || asset.purchaseCost == null || !asset.depreciationRatePercent) {
      skipped.push({ id: asset.id, name: asset.name, reason: !asset.purchaseCost && asset.purchaseCost !== 0
        ? 'No purchase cost on file'
        : !asset.purchaseDate
          ? 'No purchase date on file'
          : 'Category has no depreciation rate set' });
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

  // Apportioning a full FY's depreciation over exactly one quarter of it.
  const oneYear = yearlyScheduleForAsset(fullRateAsset, '2025-03-31')[0];
  const q1 = apportion(oneYear, '2024-04-01', '2024-06-30');
  // 91 of 365 days ≈ 24.9% of the year's 15000 depreciation.
  assert.ok(Math.abs(q1 - 3739.73) < 1, `expected ~3739.73, got ${q1}`);

  // An asset with no category rate is skipped, not silently zero.
  const { totalDepreciation, skipped } = depreciationForAssets(
    [{ ...fullRateAsset, depreciationRatePercent: null }],
    '2024-04-01',
    '2025-03-31'
  );
  assert.strictEqual(totalDepreciation, 0);
  assert.strictEqual(skipped.length, 1);
  assert.strictEqual(skipped[0].reason, 'Category has no depreciation rate set');

  console.log('depreciation.js self-check passed');
}
