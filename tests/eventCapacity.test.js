const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { priceEvent } = require('../src/modules/events/eventPricing');

// A venue holds what it holds. Seating, safety clearances and the licence are
// all sized to that number, so a party over it is refused rather than filed
// with a note attached — which is what the quote's overCapacity line was on
// its own: advisory text next to a Save button that saved regardless.
//
// The rule is checked on the count the venue actually has to seat, which is
// the same count the catering is billed on: the final figure once it is known,
// the expected one before that, never below the guarantee.

const SRC = path.join(__dirname, '..', 'src', 'modules', 'events', 'events.service.js');
const src = fs.readFileSync(SRC, 'utf8');

test('every door that saves a head count is guarded', () => {
  assert.match(src, /function assertWithinCapacity\(/, 'the guard is gone');

  const calls = src.match(/assertWithinCapacity\(/g) || [];
  // The definition plus createEventBooking and updateEventBooking.
  assert.strictEqual(calls.length, 3, `expected the guard at two call sites, found ${calls.length - 1}`);

  // updateEventBooking is the only way finalPax is ever set, so it has to
  // weigh the merged count and not just what the request happened to carry.
  const update = src.slice(src.indexOf('async function updateEventBooking'));
  const guard = update.indexOf('assertWithinCapacity(');
  const merged = update.indexOf('quote(lodgeId, merged');
  assert.ok(merged >= 0 && guard > merged, 'the update guard must weigh the merged count');
});

test('the refusal names the venue, the party and the way out', () => {
  const message = src.match(/seats \$\{venue\.capacityPax\}[^`]*/);
  assert.ok(message, 'the over-capacity message is gone');
  assert.match(message[0], /this party is/, 'it should say how large the party is');
  assert.match(message[0], /larger venue/, 'it should say what to do about it');
});

// The boundary, spelled out because it is the one people get wrong: a hall
// that seats 300 seats 300. Only above that is over.
test('a party exactly at capacity is not over it', () => {
  const capacity = 300;
  const at = priceEvent({ expectedPax: 300, guaranteedPax: 0 });
  const over = priceEvent({ expectedPax: 301, guaranteedPax: 0 });
  assert.equal(at.billablePax > capacity, false, 'exactly at capacity must save');
  assert.equal(over.billablePax > capacity, true, 'one over must not');
});

test('the guarantee can put a party over on its own', () => {
  // 150 expected but 400 promised to the kitchen is 400 people through the
  // door as far as the hall is concerned.
  const q = priceEvent({ expectedPax: 150, guaranteedPax: 400 });
  assert.equal(q.billablePax, 400);
  assert.equal(q.billablePax > 300, true);
});

test('a venue with no capacity recorded holds whatever it is told to', () => {
  // quote() leaves overCapacity null when capacityPax is null: an unknown
  // limit must never be read as a limit of zero.
  assert.match(src, /venue\.capacityPax != null && pricing\.billablePax > venue\.capacityPax/);
});
