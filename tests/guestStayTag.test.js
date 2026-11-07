const test = require('node:test');
const assert = require('node:assert');

// The tag that tells a returning guest's phone which stay its remembered login
// belongs to. See stayTagFor in src/modules/public/public.service.js.
//
// The bug it exists to close: a room number and a food PIN are both reused, so
// a guest who stayed in March and scans the same QR in June arrives holding a
// pair that can still verify — and lands signed in to somebody else's stay
// without ever seeing a login screen. The phone compares tags to notice.
//
// JWT_SECRET has to be set before the service is required, because stayTagFor
// reads it through process.env at call time and the module is cached.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(40);

const { stayTagFor } = require('../src/modules/public/public.service');

test('the same booking always gets the same tag', () => {
  // Load-bearing: the phone re-checks on every visit to the page, and a tag
  // that drifted would sign a guest out in the middle of their own stay.
  assert.strictEqual(stayTagFor(4210), stayTagFor(4210));
});

test('a different booking in the same room gets a different tag', () => {
  // This is the whole point — the next guest in room 12 is a different stay.
  assert.notStrictEqual(stayTagFor(4210), stayTagFor(4211));
});

test('the tag does not leak the booking id', () => {
  // It goes to an unauthenticated surface, so it must not carry the sequential
  // key that would tell anyone how many bookings the property has taken.
  const tag = stayTagFor(4210);
  assert.ok(!tag.includes('4210'));
  assert.match(tag, /^[0-9a-f]{32}$/);
});

test('the tag is not forgeable without the secret', () => {
  // Guards against someone deriving a tag from a booking id they guessed: a
  // plain hash of the id would be reproducible by anyone who could count.
  const crypto = require('crypto');
  const plain = crypto.createHash('sha256').update('stay:4210').digest('hex').slice(0, 32);
  assert.notStrictEqual(stayTagFor(4210), plain);
});

test('a numeric and a string booking id agree', () => {
  // mssql hands BigInt columns back in either shape depending on driver
  // settings, and a tag that changed between them would sign guests out.
  assert.strictEqual(stayTagFor(4210), stayTagFor('4210'));
});
