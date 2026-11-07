const test = require('node:test');
const assert = require('node:assert');

const { cancelSchema } = require('../src/modules/events/events.schema');

// A refund needs to say how it went back, the same rule a room booking's
// cancellation already holds — schema-level here; cancelEventBooking itself
// re-checks it against the actual refund amount at cancel time.

test('a refund payment method is accepted and normalised the same way advance methods are', () => {
  const r = cancelSchema.safeParse({ reason: 'Guest cancelled', refundAmount: 5000, refundPaymentMethod: 'UPI' });
  assert.ok(r.success, r.error?.issues[0]?.message);
  assert.strictEqual(r.data.refundPaymentMethod, 'UPI');
});

test('a blank refund payment method reads as "not given", not an error', () => {
  const r = cancelSchema.safeParse({ reason: 'Guest cancelled', refundAmount: 0, refundPaymentMethod: '' });
  assert.ok(r.success, r.error?.issues[0]?.message);
  assert.strictEqual(r.data.refundPaymentMethod, undefined);
});

test('an invalid payment method is refused', () => {
  const r = cancelSchema.safeParse({ reason: 'Guest cancelled', refundAmount: 5000, refundPaymentMethod: 'CHEQUE' });
  assert.ok(!r.success, 'CHEQUE should not be an accepted event refund method');
});
