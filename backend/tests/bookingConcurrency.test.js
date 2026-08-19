const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Two clerks booking the same room for overlapping nights is the concurrency
// case this system actually meets, and the one with the worst outcome: two
// guests sent to one room. The guarantee is not "we check availability first" —
// every version of this code checked first. It is that the check is taken under
// a lock that is still held when the row is written.
//
// None of that can be exercised without a live SQL Server, so these are static
// checks that the shape survives. They exist because the shape is easy to break
// while leaving code that reads correct and passes every other test: drop the
// hints and the check still runs, still returns the right answer, and is simply
// no longer binding.

const BOOKINGS = path.join(__dirname, '..', 'src', 'modules', 'bookings', 'bookings.service.js');

function source() {
  return fs.readFileSync(BOOKINGS, 'utf8');
}

test('hasOverlap can take its range lock', () => {
  const src = source();
  assert.match(
    src,
    /const lockHint = lock \? 'WITH \(UPDLOCK, HOLDLOCK\)' : '';/,
    'hasOverlap no longer offers UPDLOCK + HOLDLOCK. Without HOLDLOCK the gap it ' +
      'just found empty can be filled before the INSERT lands; without UPDLOCK two ' +
      'callers take compatible shared range locks and then deadlock upgrading them, ' +
      'which reaches the clerk as a 500 rather than "this room is taken".'
  );
  assert.match(src, /SELECT TOP 1 id FROM dbo\.bookings \$\{lockHint\}/, 'the hint is no longer applied to the query');
});

test('every overlap check made inside a transaction takes the lock', () => {
  const src = source();

  // Each hasOverlap( ... ) call, with its arguments.
  const calls = [...src.matchAll(/hasOverlap\(([\s\S]*?)\n\s*\);/g)].map((m) => m[1]);
  // The one-line form, which the pre-flight calls use.
  const inline = [...src.matchAll(/hasOverlap\((\([^\n]*?\)[^\n]*?)\)[;)]/g)].map((m) => m[1]);
  const all = [...calls, ...inline];

  assert.ok(all.length >= 3, `expected to find the hasOverlap call sites, found ${all.length}`);

  const unlockedInTransaction = all.filter(
    (args) => /new sql\.Request\(transaction\)/.test(args) && !/lock:\s*true/.test(args)
  );

  assert.deepStrictEqual(
    unlockedInTransaction,
    [],
    'An overlap check running inside a transaction must pass { lock: true }. Without it ' +
      'the check is advisory: it reports what was true a moment ago and nothing stops ' +
      'another transaction writing into the same nights before this one commits.'
  );

  // And the inverse: the pre-flight calls run on the pool, outside any
  // transaction, where the locks would be released the instant the statement
  // ends. Asking for them there buys nothing and would only add contention.
  const lockedOutsideTransaction = all.filter(
    (args) => /pool\.request\(\)/.test(args) && /lock:\s*true/.test(args)
  );
  assert.deepStrictEqual(
    lockedOutsideTransaction,
    [],
    'A hasOverlap call on the pool is outside any transaction, so a lock hint there is ' +
      'released immediately and is not the guarantee it looks like.'
  );
});

test('updateBooking re-checks availability inside its transaction', () => {
  const src = source();
  const start = src.indexOf('async function updateBooking(');
  assert.ok(start > 0, 'updateBooking not found');
  const body = src.slice(start, src.indexOf('async function cancelBooking('));

  const beginAt = body.indexOf('await transaction.begin()');
  assert.ok(beginAt > 0, 'updateBooking no longer opens a transaction');

  const guardAt = body.indexOf('lock: true');
  assert.ok(
    guardAt > beginAt,
    'updateBooking must re-check the room inside its transaction. The check that runs ' +
      'before it is separated from the write by the guest, charge and pricing round ' +
      'trips, so on its own it leaves a window in which two edits can move two stays ' +
      'into the same room for the same nights.'
  );

  // The guard has to come before anything is written, or a rolled-back edit has
  // already taken locks on rows it had no business touching.
  const firstWriteAt = body.indexOf('replaceBookingCharges(transaction');
  assert.ok(
    firstWriteAt > guardAt,
    'the in-transaction availability check must run before the first write'
  );
});
