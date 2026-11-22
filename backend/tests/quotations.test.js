const test = require('node:test');
const assert = require('node:assert');
const { quotationState } = require('../src/modules/quotations/quotations.service');

// A quotation expires at the START of its earliest check-in date.
test('quotation is active only until its check-in date arrives', () => {
  assert.strictEqual(quotationState('ACTIVE', '2026-12-10', '2026-12-09'), 'ACTIVE');
  assert.strictEqual(quotationState('ACTIVE', '2026-12-10', '2026-12-10'), 'EXPIRED');
  assert.strictEqual(quotationState('ACTIVE', '2026-12-10', '2026-12-11'), 'EXPIRED');
});

test('a booked quotation stays booked past its check-in date', () => {
  assert.strictEqual(quotationState('BOOKED', '2026-01-01', '2026-12-31'), 'BOOKED');
});

test('Date objects from the driver compare by their calendar day', () => {
  assert.strictEqual(quotationState('ACTIVE', new Date('2026-12-10T00:00:00.000Z'), '2026-12-09'), 'ACTIVE');
  assert.strictEqual(quotationState('ACTIVE', new Date('2026-12-10T00:00:00.000Z'), '2026-12-10'), 'EXPIRED');
});
