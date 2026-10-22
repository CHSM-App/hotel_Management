const test = require('node:test');
const assert = require('node:assert');

const { checkoutDeadline, hybridNights, isEarlyArrival } = require('../src/modules/bookings/lateCheckout');

// HYBRID: check-in 12:00, checkout 12:00. Arrive before 12:00 and you are out
// 24 hours later; arrive at or after 12:00 and you are out at 12:00 next day.
const ist = (s) => new Date(`${s}+05:30`);
const base = {
  checkinMode: 'HYBRID',
  checkInTime: '12:00',
  checkOutTime: '12:00:00',
  earlyArrivalFrom: null,
  checkInDate: '2026-08-01',
  checkOutDate: '2026-08-02',
};
const deadlineFor = (arrival, extra = {}) =>
  checkoutDeadline({ ...base, ...extra, actualCheckInAt: ist(arrival) }).getTime();

test('10:00 arrival is due out 10:00 next day', () => {
  assert.equal(deadlineFor('2026-08-01T10:00:00'), ist('2026-08-02T10:00:00').getTime());
});

test('arrival after 12:00 is due out 12:00 next day', () => {
  assert.equal(deadlineFor('2026-08-01T15:00:00'), ist('2026-08-02T12:00:00').getTime());
});

test('arrival exactly at check-in time is not early', () => {
  assert.equal(deadlineFor('2026-08-01T12:00:00'), ist('2026-08-02T12:00:00').getTime());
});

test('early rule applies to every booked night', () => {
  assert.equal(
    deadlineFor('2026-08-01T10:00:00', { checkOutDate: '2026-08-04' }),
    ist('2026-08-04T10:00:00').getTime()
  );
});

test('arrival before the earliest time keeps the fixed checkout', () => {
  assert.equal(isEarlyArrival({ actualCheckInAt: ist('2026-08-01T03:00:00'), checkInTime: '12:00', earlyArrivalFrom: '06:00' }), false);
  assert.equal(deadlineFor('2026-08-01T03:00:00', { earlyArrivalFrom: '06:00' }), ist('2026-08-02T12:00:00').getTime());
  assert.equal(deadlineFor('2026-08-01T06:00:00', { earlyArrivalFrom: '06:00' }), ist('2026-08-02T06:00:00').getTime());
});

test('no arrival on record falls back to the fixed checkout', () => {
  assert.equal(
    checkoutDeadline({ ...base, actualCheckInAt: null }).getTime(),
    ist('2026-08-02T12:00:00').getTime()
  );
});

test('early arrival leaving on time is one night, a day later is two', () => {
  const args = { checkOutTime: '12:00:00', checkInTime: '12:00', actualCheckInAt: ist('2026-08-01T10:00:00') };
  assert.equal(hybridNights({ ...args, at: ist('2026-08-02T10:00:00') }), 1);
  assert.equal(hybridNights({ ...args, at: ist('2026-08-02T11:30:00') }), 2);
});

test('late arrival counts by the fixed checkout boundary', () => {
  const args = { checkOutTime: '12:00:00', checkInTime: '12:00', actualCheckInAt: ist('2026-08-01T15:00:00') };
  assert.equal(hybridNights({ ...args, at: ist('2026-08-02T12:00:00') }), 1);
  assert.equal(hybridNights({ ...args, at: ist('2026-08-02T14:00:00') }), 2);
});
