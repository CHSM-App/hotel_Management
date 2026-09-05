const test = require('node:test');
const assert = require('node:assert');

const { createEventSchema } = require('../src/modules/events/events.schema');

// A deposit taken as the function is written down: the shape the booking form
// sends, checked the way the receipt would check it.

const base = {
  eventType: 'BIRTHDAY',
  title: 'Aarav turns five',
  venueId: 1,
  startAt: '2026-10-03T18:00:00+05:30',
  endAt: '2026-10-03T22:00:00+05:30',
  organiserName: 'P. Naik',
  organiserPhone: '9876543210',
  expectedPax: 40,
};

test('no advance, no questions', () => {
  const parsed = createEventSchema.safeParse({ ...base });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.advanceAmount, undefined);
});

test('an advance needs a method, and UPI or card needs a number', () => {
  const noMethod = createEventSchema.safeParse({ ...base, advanceAmount: 5000 });
  assert.equal(noMethod.success, false);
  assert.deepEqual(noMethod.error.issues[0].path, ['advancePaymentMethod']);

  const upiNoRef = createEventSchema.safeParse({ ...base, advanceAmount: 5000, advancePaymentMethod: 'UPI' });
  assert.equal(upiNoRef.success, false);
  assert.deepEqual(upiNoRef.error.issues[0].path, ['advanceReference']);

  const cash = createEventSchema.safeParse({ ...base, advanceAmount: '5000', advancePaymentMethod: 'CASH' });
  assert.equal(cash.success, true);
  assert.equal(cash.data.advanceAmount, 5000);
});

test('a split has to add up to the advance', () => {
  const short = createEventSchema.safeParse({
    ...base,
    advanceAmount: 5000,
    advancePaymentMethod: 'CASH',
    advanceLines: [
      { method: 'CASH', amount: 2000 },
      { method: 'UPI', amount: 2000, reference: 'T123' },
    ],
  });
  assert.equal(short.success, false);
  assert.deepEqual(short.error.issues[0].path, ['advanceLines']);

  const exact = createEventSchema.safeParse({
    ...base,
    advanceAmount: 5000,
    advancePaymentMethod: 'CASH',
    advanceLines: [
      { method: 'CASH', amount: 3000 },
      { method: 'UPI', amount: 2000, reference: 'T123' },
    ],
  });
  assert.equal(exact.success, true);
});
