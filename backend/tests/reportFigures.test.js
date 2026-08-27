const test = require('node:test');
const assert = require('node:assert');

const { billFigures, mergeTenders, splitAcross } = require('../src/modules/reports/reports.service');

// The booking report states, for every issued bill, figures a reader can check
// on the page:
//
//   gross − discount = net
//   net − CGST − SGST = taxable value
//   taxable value + CGST + SGST + round off = billed total
//
// Prices are GST-inclusive, so the stored subtotals carry the tax inside them.
// The report used to print those subtotals as "taxable value" — overstating it
// by exactly the tax — and ignored discounts, so no row footed. These pin the
// identity above on the shapes a bill actually takes.

const paise = (n) => Math.round(n * 100);

function assertFoots(row) {
  const f = billFigures(row);
  assert.equal(paise(f.grossAmount - f.discountAmount), paise(f.netAmount), 'gross − discount = net');
  assert.equal(paise(f.netAmount - f.cgstAmount - f.sgstAmount), paise(f.taxableValue), 'net − tax = taxable');
  assert.equal(
    paise(f.taxableValue + f.cgstAmount + f.sgstAmount + f.roundOff),
    paise(f.billedAmount),
    'taxable + tax + round off = total'
  );
  assert.equal(paise(f.roomTaxable + f.foodTaxable), paise(f.taxableValue));
  assert.equal(paise(f.roomCgst + f.foodCgst), paise(f.cgstAmount));
  return f;
}

test('a rooms-only GST bill with no discount', () => {
  // ₹5,000 inclusive at 12%: tax inside = 535.71, split 267.86 / 267.86 (rounded
  // separately, as billing does), rounded to the rupee on the GST side.
  const f = assertFoots({
    room_subtotal: 5000,
    cgst_amount: 267.86,
    sgst_amount: 267.86,
    round_off: 0,
    total_amount: 5000,
  });
  assert.equal(f.taxableValue, 4464.28);
  assert.equal(f.foodTaxable, 0);
});

test('a discounted bill with food apportions the discount before the tax comes out', () => {
  // Room 5,000 + food 1,200 = 6,200 gross, ₹500 off. Billing apportions the
  // discount 403.23 / 96.77, computes tax on 4,596.77 (12%) and 1,103.23 (5%),
  // and rounds the 5,700.00 net to 5,700.
  const f = assertFoots({
    room_subtotal: 5000,
    food_subtotal: 1200,
    cgst_amount: 246.26,
    sgst_amount: 246.26,
    food_cgst_amount: 26.27,
    food_sgst_amount: 26.27,
    discount_amount: 500,
    round_off: 0,
    total_amount: 5700,
  });
  assert.equal(f.grossAmount, 6200);
  assert.equal(f.netAmount, 5700);
  assert.equal(f.roomTaxable, 4104.25);
  assert.equal(f.foodTaxable, 1050.69);
});

test('a non-GST cash receipt has no tax, so taxable equals the net', () => {
  const f = assertFoots({
    room_subtotal: 1500,
    cgst_amount: 0,
    sgst_amount: 0,
    discount_amount: 100,
    round_off: 0,
    total_amount: 1400,
  });
  assert.equal(f.taxableValue, 1400);
});

test('round off is carried through to the billed total', () => {
  // Net 2,678.57 rounds up to 2,679 on the GST side.
  const f = assertFoots({
    room_subtotal: 2678.57,
    cgst_amount: 143.49,
    sgst_amount: 143.49,
    round_off: 0.43,
    total_amount: 2679,
  });
  assert.equal(f.roundOff, 0.43);
});

test('null food columns on a bill written before food existed read as zero', () => {
  const f = billFigures({
    room_subtotal: 1000,
    cgst_amount: 53.57,
    sgst_amount: 53.57,
    food_subtotal: null,
    food_cgst_amount: null,
    food_sgst_amount: null,
    discount_amount: null,
    late_checkout_charge: null,
    round_off: null,
    total_amount: 1000,
  });
  assert.equal(f.foodGross, 0);
  assert.equal(f.discountAmount, 0);
  assert.equal(f.roundOff, 0);
});

// How a stay was paid is listed tender by tender, combined per method and in a
// fixed order — so "Cash 2,000 + UPI 3,000" reads the same on every run and a
// second card never prints as a separate line.
test('tenders merge per method in a fixed order and still add up', () => {
  const parts = splitAcross(
    5000,
    [
      { method: 'UPI', amount: 1000 },
      { method: 'CARD', amount: 500 },
      { method: 'UPI', amount: 2000 },
    ],
    'CASH'
  );
  const tenders = mergeTenders(parts);
  assert.deepEqual(tenders, [
    { method: 'CASH', amount: 1500 },
    { method: 'UPI', amount: 3000 },
    { method: 'CARD', amount: 500 },
  ]);
  assert.equal(paise(tenders.reduce((s, t) => s + t.amount, 0)), paise(5000));
});

test('money with no recorded method is reported as such, never as a guess', () => {
  assert.deepEqual(mergeTenders(splitAcross(800, [], null)), [{ method: 'UNRECORDED', amount: 800 }]);
});
