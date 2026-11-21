const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// An advance is a part-payment of the stay, so it cannot exceed it. A stray
// zero would otherwise travel a long way before anyone noticed: the receipt
// prints a negative balance due, and the final bill a negative net payment.
//
// It has to be caught on the booking, not left to the receipt. Receipts are
// raised automatically now and are deliberately unable to fail the booking that
// triggered them — so an over-large advance would save quietly and simply leave
// no receipt behind, which is the worst of both.

const SRC = path.join(__dirname, '..', 'src', 'modules', 'bookings', 'bookings.service.js');
const src = fs.readFileSync(SRC, 'utf8');

test('every door that records an advance is guarded', () => {
  assert.match(src, /function assertAdvanceWithinTotal\(/, 'the guard is gone');

  const calls = src.match(/assertAdvanceWithinTotal\(/g) || [];
  // The definition plus createBooking, checkIn and updateBooking.
  assert.strictEqual(calls.length, 4, `expected the guard at three call sites, found ${calls.length - 1}`);

  // check-in adds to what is already held, so it must weigh both.
  assert.match(
    src,
    /assertAdvanceWithinTotal\(input\.advanceAmount, bookingRow\.total_price, bookingRow\.advance_amount\)/,
    'check-in no longer counts the advance already on the booking'
  );
  // and it has to be reading those columns to do so.
  assert.match(src, /b\.total_price, b\.advance_amount,/, 'check-in stopped selecting the figures it checks');
});

test('the rule itself', () => {
  const round2 = (n) => Math.round(n * 100) / 100;
  // Reproduced from the service so the arithmetic is exercised, not just the
  // presence of a function name.
  const exceeds = (amount, stayTotal, held = 0) => {
    const a = Number(amount);
    if (!Number.isFinite(a) || a <= 0) return false;
    return round2(round2(held) + a) > round2(stayTotal);
  };

  assert.strictEqual(exceeds(1500, 1500), false, 'paying the stay in full is allowed');
  assert.strictEqual(exceeds(1501, 1500), true, 'a rupee over is not');
  assert.strictEqual(exceeds(15000, 1500), true, 'the stray-zero case');

  // Discounted stays are measured against what is payable.
  assert.strictEqual(exceeds(1000, 900), true, 'a discounted stay cannot take more than it costs');

  // Instalments are weighed together.
  assert.strictEqual(exceeds(600, 1100, 500), false, '500 + 600 = 1100 exactly');
  assert.strictEqual(exceeds(700, 1100, 500), true, '500 + 700 overshoots');

  // Nothing taken is never an error.
  assert.strictEqual(exceeds(0, 1500), false);
  assert.strictEqual(exceeds(undefined, 1500), false);
});
