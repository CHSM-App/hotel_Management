const test = require('node:test');
const assert = require('node:assert/strict');
const { serviceSideOf, buildBreakdown } = require('../src/modules/billing/billing.service');

// 118 at 18% holds 18 of tax; 105 at 5% holds 5. Prices are GST-inclusive.
const usages = [
  { lineTotal: 118, gstRatePercent: 18 },
  { lineTotal: 105, gstRatePercent: 5 },
];
const none = { roomSubtotal: 0, cgstAmount: 0, sgstAmount: 0 };

test('service tax is extracted per use at its own rate, halved into CGST/SGST', () => {
  const side = serviceSideOf(usages, null);
  assert.equal(side.subtotal, 223);
  assert.equal(side.cgstAmount, 11.5);
  assert.equal(side.sgstAmount, 11.5);
  assert.equal(side.taxable, true);
});

test('a bill of services alone adds up: taxable + tax = total', () => {
  const b = buildBreakdown({ ...none, service: serviceSideOf(usages, 223) });
  assert.equal(b.totalAmount, 223);
  assert.equal(b.serviceTaxable, 200);
  assert.equal(b.serviceTaxable + b.serviceCgstAmount + b.serviceSgstAmount, 223);
});

test('a discount lowers the services tax and the total', () => {
  const b = buildBreakdown({ ...none, service: serviceSideOf(usages, 200), discountAmount: 23 });
  assert.equal(b.discountAmount, 23);
  assert.equal(b.totalAmount, 200);
  assert.ok(b.serviceCgstAmount < 11.5);
});

test('no services leaves the breakdown zeroed', () => {
  assert.equal(serviceSideOf([], null), null);
  const b = buildBreakdown({ roomSubtotal: 1000, cgstAmount: 0, sgstAmount: 0 });
  assert.equal(b.serviceSubtotal, 0);
  assert.equal(b.totalAmount, 1000);
});
