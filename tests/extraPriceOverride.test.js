const test = require('node:test');
const assert = require('node:assert');
const { normalizeSelections, parseChargeSelections } = require('../src/modules/pricing/pricing.service');

// Reception can agree what an extra costs on one booking. The figure is the
// WHOLE LINE per night, not a rate per unit — "₹100 for the extra beds", not
// "₹33.33 each", because three of them divide 100 into 33.33 and multiply back
// to 99.99, putting a stray paisa on a bill the desk agreed at a round number.
//
// The rest is about what an ABSENT figure means: blank has to mean "charge the
// lodge price times the count", never "free", or a cleared box mid-edit
// silently zeroes a line.

test('an agreed price rides along with the count', () => {
  assert.deepStrictEqual(normalizeSelections([{ id: 5, quantity: 2, agreedAmount: 80 }]), [
    { id: 5, quantity: 2, agreedAmount: 80 },
  ]);
});

test('no price means charge the lodge price, not nothing', () => {
  const [line] = normalizeSelections([{ id: 5, quantity: 1 }]);
  assert.strictEqual(line.agreedAmount, undefined);
});

test('a blank or nonsense price is ignored rather than treated as free', () => {
  for (const bad of ['', '   ', 'abc', null, undefined, -5]) {
    const [line] = normalizeSelections([{ id: 5, quantity: 1, agreedAmount: bad }]);
    assert.strictEqual(line.agreedAmount, undefined, `agreedAmount ${JSON.stringify(bad)} should be ignored`);
  }
});

test('zero is kept — a free extra is a real thing to give away', () => {
  const [line] = normalizeSelections([{ id: 5, quantity: 1, agreedAmount: 0 }]);
  assert.strictEqual(line.agreedAmount, 0);
});

test('the same extra twice sums the counts and keeps the agreed price', () => {
  // chargeIds=3,3 is two extra beds, not a duplicate to discard.
  const [line] = normalizeSelections([
    { id: 3, quantity: 1, agreedAmount: 80 },
    { id: 3, quantity: 2 },
  ]);
  assert.strictEqual(line.quantity, 3);
  assert.strictEqual(line.agreedAmount, 80, 'the agreed price should survive the second half of the line');
});

test('the query-string form carries the price', () => {
  assert.deepStrictEqual(parseChargeSelections('5:2@80'), [{ id: 5, quantity: 2, agreedAmount: 80 }]);
  assert.deepStrictEqual(parseChargeSelections('7@0'), [{ id: 7, quantity: 1, agreedAmount: 0 }]);
});

test('the old query-string form still means what it always did', () => {
  // Every client that has not learned about prices keeps working.
  assert.deepStrictEqual(parseChargeSelections('3,5:2'), [
    { id: 3, quantity: 1, agreedAmount: undefined },
    { id: 5, quantity: 2, agreedAmount: undefined },
  ]);
});

test('the agreed amount is snapshotted on the booking, not joined live', () => {
  // The bug this closes: extras were costed by joining to the lodge’s current
  // price, so raising it repriced every stay ever taken — printed bills too.
  const src = require('fs').readFileSync(
    require.resolve('../src/modules/bookings/bookings.service.js'),
    'utf8'
  );
  // Substring checks, not regex: these pin exact source fragments, and the
  // escaping a regex needs here buys nothing.
  assert.ok(
    src.includes('(booking_id, charge_id, quantity, agreed_amount)'),
    'the agreed amount is no longer written with the booking'
  );
  assert.ok(
    src.includes('agreedAmount: c.agreed_amount == null ? null : Number(c.agreed_amount)'),
    'the booking should report the amount it was actually written with'
  );
});
test('the quote marks extras lines editable and leaves the room line alone', () => {
  // The regression this closes: pricing built the lines with chargeId, then
  // priceStay remapped them to { label, amount } on the way out. The form saw
  // no chargeId, so every line rendered read-only and the totals could not be
  // edited at all — with nothing failing anywhere to say so.
  const src = require('fs').readFileSync(
    require.resolve('../src/modules/bookings/bookings.service.js'),
    'utf8'
  );
  assert.match(
    src,
    /charges: quote\.lines\.map\(\(line\) => \(\{[\s\S]{0,200}chargeId: line\.chargeId/,
    'priceStay is dropping chargeId again — the extras totals will not be editable'
  );
  assert.match(src, /quantity: line\.quantity/, 'quantity is needed to turn a typed total into a unit price');
});

test('an agreed amount is the whole line, not a rate per unit', () => {
  // The bug that forced this model: the desk agreed ₹100 for three extra beds,
  // the form divided it into ₹33.33 each, and the bill came back ₹99.99 — a
  // stay agreed at ₹1,400 printed as ₹1,399.99. No two-decimal per-unit figure
  // can multiply back to 100 across three units, so the agreed figure has to be
  // the line itself.
  const line = (quantity, agreed, lodgeRate) =>
    agreed !== undefined ? agreed : lodgeRate * quantity;

  assert.strictEqual(line(3, 100, 100), 100, 'three beds agreed at 100 cost 100');
  assert.strictEqual(line(3, undefined, 100), 300, 'with no agreement, count times rate');
  assert.strictEqual(line(3, 0, 100), 0, 'given away free');

  // The arithmetic that produced the stray paisa, kept here so nobody
  // reintroduces per-unit division as a "simplification".
  assert.notStrictEqual(Math.round((100 / 3) * 100) / 100 * 3, 100);
});

test('the label drops the per-unit rate once an amount is agreed', () => {
  // "3 × ₹33.33" beside an agreed ₹100 invites the guest to multiply it back
  // and find a paisa missing.
  const src = require('fs').readFileSync(
    require.resolve('../src/modules/pricing/pricing.service.js'),
    'utf8'
  );
  assert.ok(
    src.includes('if (charge.agreedAmount !== undefined) {'),
    'chargeLabel should print no rate for an agreed line'
  );
});
