const test = require('node:test');
const assert = require('node:assert');

const {
  cycleNights,
  suggestCycleCharge,
  atLocalTime,
  checkoutDeadline,
} = require('../src/modules/bookings/lateCheckout');

// The CYCLE rule, in the owner's own words: check in 11:00, check out 09:00,
// that is one night. Arrive 14:00 and leave 12:00 the next day and it is two.
// A stay costs a night for every checkout-time boundary it crosses.
//
// Every instant here is written in IST, because that is the wall clock these
// rules are stated in, and the point of pinning the zone is that the answers
// must not depend on where the server happens to run.
const ist = (s) => new Date(`${s}+05:30`);
const OUT_9 = '09:00:00';

test('on-time stay is one night', () => {
  assert.equal(
    cycleNights({ checkOutTime: OUT_9, actualCheckInAt: ist('2026-08-01T11:00:00'), at: ist('2026-08-02T09:00:00') }),
    1
  );
});

test('leaving after the checkout time starts the next night', () => {
  assert.equal(
    cycleNights({ checkOutTime: OUT_9, actualCheckInAt: ist('2026-08-01T14:00:00'), at: ist('2026-08-02T12:00:00') }),
    2
  );
});

test('leaving before the third boundary is still two nights', () => {
  assert.equal(
    cycleNights({ checkOutTime: OUT_9, actualCheckInAt: ist('2026-08-01T14:00:00'), at: ist('2026-08-03T08:30:00') }),
    2
  );
});

test('arriving before the checkout time sits inside the previous cycle', () => {
  // 07:00 arrival crosses the same day's 09:00 boundary and the next morning's.
  assert.equal(
    cycleNights({ checkOutTime: OUT_9, actualCheckInAt: ist('2026-08-01T07:00:00'), at: ist('2026-08-02T08:00:00') }),
    2
  );
});

test('the grace period applies to every boundary', () => {
  const args = { checkOutTime: OUT_9, actualCheckInAt: ist('2026-08-01T14:00:00'), at: ist('2026-08-02T09:45:00') };
  assert.equal(cycleNights({ ...args, graceMinutes: 60 }), 1);
  assert.equal(cycleNights({ ...args, graceMinutes: 30 }), 2);
});

test('a same-day stay that never reaches a boundary is still one night', () => {
  assert.equal(
    cycleNights({ checkOutTime: OUT_9, actualCheckInAt: ist('2026-08-01T11:00:00'), at: ist('2026-08-01T18:00:00') }),
    1
  );
});

test('garbage timestamps count one night rather than throwing or spinning', () => {
  assert.equal(cycleNights({ checkOutTime: OUT_9, actualCheckInAt: 'not a date', at: ist('2026-08-02T12:00:00') }), 1);
});

test('extra nights are priced whole, at the last night rate', () => {
  assert.deepEqual(suggestCycleCharge(0, 1500), { amount: 0, band: 'WITHIN_GRACE', percent: 0, extraNights: 0 });
  assert.deepEqual(suggestCycleCharge(2, 1500.5), {
    amount: 3001,
    band: 'EXTRA_NIGHTS',
    percent: 200,
    extraNights: 2,
  });
});

test('a lodge wall-clock time is IST whatever zone the process runs in', () => {
  // 09:00 IST is 03:30 UTC, and would be 09:00 UTC on a UTC server if the
  // deadline were built through the process-local Date constructor.
  assert.equal(atLocalTime('2026-08-02', OUT_9).toISOString(), '2026-08-02T03:30:00.000Z');
});

test('CYCLE shares the fixed-time deadline with NIGHT_BASED', () => {
  const args = { checkOutTime: OUT_9, checkInDate: '2026-08-01', checkOutDate: '2026-08-02', actualCheckInAt: ist('2026-08-01T14:00:00') };
  assert.equal(
    checkoutDeadline({ ...args, checkinMode: 'CYCLE' }).getTime(),
    checkoutDeadline({ ...args, checkinMode: 'NIGHT_BASED' }).getTime()
  );
  // and HOUR_24 does not
  assert.equal(checkoutDeadline({ ...args, checkinMode: 'HOUR_24' }).toISOString(), ist('2026-08-02T14:00:00').toISOString());
});

// The billing side of the same rule: a CYCLE guest who left before the nights
// they booked ran out is shown what the unused ones cost, priced as the last
// nights of the stay. Everyone else, and any stay without both timestamps,
// gets nothing — there is no early departure to price.
const { earlyCheckoutOf } = require('../src/modules/billing/billing.service');

test('unused nights on a CYCLE stay are the last ones, at their own rate', () => {
  const booking = {
    checkin_mode: 'CYCLE',
    check_out_time: '09:00:00',
    late_grace_minutes: 60,
    actual_check_in_at: ist('2026-08-01T14:00:00'),
    actual_check_out_at: ist('2026-08-02T08:00:00'), // one night, booked three
  };
  assert.deepEqual(earlyCheckoutOf(booking, [1000, 1200, 1500]), {
    plannedNights: 3,
    actualNights: 1,
    unusedNights: 2,
    unusedAmount: 2700,
  });
});

test('no early checkout on a full stay, other modes, or without timestamps', () => {
  const full = {
    checkin_mode: 'CYCLE',
    check_out_time: '09:00:00',
    late_grace_minutes: 60,
    actual_check_in_at: ist('2026-08-01T14:00:00'),
    actual_check_out_at: ist('2026-08-03T08:00:00'),
  };
  assert.equal(earlyCheckoutOf(full, [1000, 1200]), null);
  assert.equal(earlyCheckoutOf({ ...full, checkin_mode: 'NIGHT_BASED', actual_check_out_at: ist('2026-08-02T08:00:00') }, [1000, 1200]), null);
  assert.equal(earlyCheckoutOf({ ...full, actual_check_out_at: null }, [1000, 1200]), null);
});
