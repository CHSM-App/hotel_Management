const test = require('node:test');
const assert = require('node:assert');
const { stockView, splitTax } = require('../src/modules/bar/bar.service');
const { permissionAvailableFor } = require('../src/modules/roles/permissions');

test('stock shows bottles + loose ml', () => {
  assert.deepStrictEqual(stockView(2430, 750), { stockMl: 2430, bottles: 3, looseMl: 180 });
  assert.deepStrictEqual(stockView(690, 750), { stockMl: 690, bottles: 0, looseMl: 690 });
  assert.deepStrictEqual(stockView(-60, 750), { stockMl: -60, bottles: -0, looseMl: -60 });
});

test('bar permissions need the hasBar add-on', () => {
  for (const k of ['bar.manage', 'bar.bill', 'bar.report']) {
    assert.strictEqual(permissionAvailableFor(k, { hasBar: false }), false);
    assert.strictEqual(permissionAvailableFor(k, { hasBar: true }), true);
  }
});

test('bar bill tax: drinks at the bar rate, food at restaurant GST', () => {
  // Rs 1000 of drinks at 0% and Rs 210 of food at 5% GST (both tax-inclusive).
  assert.deepStrictEqual(splitTax(1000, 210, 0, 5), { drinkTax: 0, foodTax: 10 });
  // Not GST registered: no food rate, so no food tax.
  assert.deepStrictEqual(splitTax(500, 100, 0, 0), { drinkTax: 0, foodTax: 0 });
  // A bar rate of 10% extracts 90.91 from 1000.
  assert.strictEqual(splitTax(1000, 0, 10, 0).drinkTax, 90.91);
});

// Food ordered on a bar order must never reach restaurant billing or reports.
// These read the source because the queries need a database to run.
test('restaurant billing and reports skip food tagged with a bar order', () => {
  const fs = require('node:fs');
  const read = (f) => fs.readFileSync(require('node:path').join(__dirname, '..', 'src', 'modules', f), 'utf8');
  const count = (src) => (src.match(/bar_order_id IS NULL/g) || []).length;
  assert.ok(count(read('billing/billing.service.js')) >= 6, 'billing.service.js food queries');
  assert.ok(count(read('reports/reports.service.js')) >= 3, 'reports.service.js food queries');
  assert.ok(count(read('orders/orders.service.js')) >= 3, 'orders.service.js billing queues');
  assert.ok(count(read('public/public.service.js')) >= 2, 'public.service.js guest totals');
  assert.ok(count(read('bookings/bookings.service.js')) >= 1, 'bookings.service.js stay food');
});

test('bar and restaurant bills number plainly from 1 in their own series', () => {
  const { billNumber } = require('../src/modules/bar/bar.service');
  assert.strictEqual(billNumber(1), '1');
  assert.strictEqual(billNumber(12), '12');
  const fs = require('node:fs');
  const src = fs.readFileSync(require('node:path').join(__dirname, '..', 'src', 'modules', 'billing', 'billing.service.js'), 'utf8');
  const food = src.slice(src.indexOf("const seriesType = 'FOOD';"), src.indexOf("const seriesType = 'FOOD';") + 3500);
  assert.ok(food.includes("'FOOD'") && food.includes('String(number)'), 'restaurant bill uses the FOOD series and a plain number');
});

// A bar order posted to a room bill: its own Bar line on the stay invoice, kept out of
// the food and service lines, with drinks tax at the bar % and dishes at food GST.
test('stay bill carries a separate Bar line (drinks at bar tax, dishes at food GST)', () => {
  const { priceStayBill } = require('../src/modules/billing/billing.service');
  const booking = {
    nightly_breakdown: JSON.stringify([{ total: 1000 }]),
    late_checkout_charge: 0,
    is_gst_registered: true,
  };
  const slabs = [{ maxAmount: null, ratePercent: 0 }];
  const bars = [{ id: 1, orderNumber: 1, drinks: 1000, food: 210, taxPercent: 10, foodRatePercent: 5, items: [] }];
  const { gst, nonGst } = priceStayBill(booking, [], { includeLateCheckout: false, discountAmount: 0, slabs, foodRate: null, services: [], bars });

  assert.strictEqual(gst.barSubtotal, 1000);
  assert.strictEqual(gst.barFoodSubtotal, 210);
  assert.strictEqual(gst.barTaxAmount, 90.91); // 1000 incl. 10%
  assert.strictEqual(gst.barFoodTaxAmount, 10); // 210 incl. 5% GST
  assert.strictEqual(gst.foodSubtotal, 0); // not in the restaurant line
  assert.strictEqual(gst.serviceSubtotal, 0);
  assert.strictEqual(gst.totalAmount, 2210); // 1000 room + 1210 bar, tax already inside
  // A cash receipt has no GST on dishes but keeps the bar's own drinks tax.
  assert.strictEqual(nonGst.barFoodTaxAmount, 0);
  assert.strictEqual(nonGst.barTaxAmount, 90.91);
  assert.strictEqual(nonGst.totalAmount, 2210);
});
