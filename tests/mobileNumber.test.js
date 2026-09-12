const test = require('node:test');
const assert = require('node:assert');
const { createBookingSchema, updateBookingSchema } = require('../src/modules/bookings/bookings.schema');

// A guest's mobile is how the property reaches whoever is in the room, so it
// has to be a number that actually dials. Ten digits, and forgiving about the
// shapes a desk types them in.

const base = { roomId: 1, checkInDate: '2026-01-01', checkOutDate: '2026-01-02', guestName: 'A' };
const parse = (guestPhone) => createBookingSchema.safeParse({ ...base, guestPhone });

test('the ways a desk writes a number all reduce to the same ten digits', () => {
  for (const written of ['9876543210', '98765 43210', '98765-43210', '+91 98765 43210', '098765 43210']) {
    const r = parse(written);
    assert.ok(r.success, `${written} was rejected: ${r.error?.issues[0]?.message}`);
    assert.strictEqual(r.data.guestPhone, '9876543210', `${written} normalised wrong`);
  }
});

test('anything that is not ten digits is refused', () => {
  for (const bad of ['', '98765', '98765432101', 'abcdefghij', '+1 415 555 0100']) {
    const r = parse(bad);
    assert.ok(!r.success, `${JSON.stringify(bad)} was accepted`);
  }
});

test('an additional guest may have no number, but not half of one', () => {
  const withGuest = (phone) =>
    createBookingSchema.safeParse({ ...base, guestPhone: '9876543210', numGuests: 2, guests: [{ name: 'B', phone }] });

  const blank = withGuest('');
  assert.ok(blank.success, blank.error?.issues[0]?.message);
  assert.strictEqual(blank.data.guests[0].phone, undefined, 'blank should read as "not given"');

  const good = withGuest('+91 90000 00001');
  assert.ok(good.success, good.error?.issues[0]?.message);
  assert.strictEqual(good.data.guests[0].phone, '9000000001');

  assert.ok(!withGuest('90000').success, 'a partial number was accepted');
});

test('an edit is held to the same rule, but may leave the number alone', () => {
  // Absent means "unchanged" — an edit that only moves the checkout date must
  // not have to resend a phone number to pass.
  assert.ok(updateBookingSchema.safeParse({ checkOutDate: '2026-01-03' }).success);
  assert.ok(updateBookingSchema.safeParse({ guestPhone: '9876543210' }).success);
  assert.ok(!updateBookingSchema.safeParse({ guestPhone: '98765' }).success);
});
