const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// An advance is receipted the moment it is taken — no button. Everything the
// receipt needs (amount, method, reference) is already typed into the booking
// form, so a separate "issue" click added a step and no information. The stay
// bill is deliberately NOT auto-issued: what the guest hands over at checkout
// is not known until checkout, and inventing it would put a fabricated payment
// on a GST document.
//
// The hazard this pins down is the double count. issueAdvanceReceipt normally
// ADDS to bookings.advance_amount, because a second instalment is more money in
// rather than a correction of the first. The booking's own INSERT has already
// recorded the advance, so the automatic path must not add it again.

const SRC = path.join(__dirname, '..', 'src', 'modules');
const bookings = fs.readFileSync(path.join(SRC, 'bookings', 'bookings.service.js'), 'utf8');
const receipts = fs.readFileSync(path.join(SRC, 'billing', 'advanceReceipts.service.js'), 'utf8');

test('the automatic path does not add the advance a second time', () => {
  assert.match(
    receipts,
    /async function issueAdvanceReceipt\(lodgeId, userId, bookingId, input, \{ alreadyOnBooking = false \} = \{\}\)/,
    'the alreadyOnBooking guard is gone'
  );
  assert.match(
    receipts,
    /\$\{alreadyOnBooking \? '' : 'advance_amount = ISNULL\(advance_amount, 0\) \+ @amount,'\}/,
    'the advance amount is being written unconditionally again — every auto-issued advance would double'
  );
  assert.match(
    bookings,
    /\{ alreadyOnBooking: true \}/,
    'the booking path no longer tells the receipt that the money is already recorded'
  );
});

test('both branches of the UPDATE are valid SQL', () => {
  // Extracted from the source, not copied into the test.
  //
  // This used to be a hand-written duplicate of the query, and it went stale
  // the first time the real one changed: the source moved to
  // COALESCE(@method, advance_payment_method) and this file happily kept
  // asserting against its own `= @method`, green the whole way. A copy of the
  // thing under test is not a test of it.
  //
  // Anchored on the conditional itself rather than on "UPDATE dbo.bookings",
  // because the void path has one of those too.
  const template = receipts.match(
    /UPDATE dbo\.bookings\s+SET \$\{alreadyOnBooking[\s\S]*?WHERE id = @bookingId AND lodge_id = @lodgeId/
  );
  assert.ok(template, 'the conditional advance UPDATE has moved — re-point this test at it');

  const render = (alreadyOnBooking) =>
    template[0].replace(
      /\$\{alreadyOnBooking \? '' : '([^']*)'\}/,
      alreadyOnBooking ? '' : '$1'
    );

  // The substitution has to have actually happened, or every assertion below
  // passes against an unrendered template.
  for (const flag of [false, true]) {
    assert.ok(!render(flag).includes('${'), `branch ${flag} left an unrendered placeholder`);
  }

  for (const flag of [false, true]) {
    const flat = render(flag).replace(/\s+/g, ' ').trim();
    // SET must be followed by an assignment, never straight into WHERE, and the
    // clause must not open with a stray comma.
    assert.match(flat, /SET \S+ =/, `SET clause is malformed when alreadyOnBooking=${flag}`);
    assert.ok(!/SET ,/.test(flat), `dangling comma when alreadyOnBooking=${flag}`);
    assert.ok(!/, WHERE/.test(flat), `trailing comma before WHERE when alreadyOnBooking=${flag}`);
  }

  // And the two differ in exactly the amount line.
  assert.ok(render(false).includes('advance_amount'), 'manual path stopped recording the amount');
  assert.ok(!render(true).includes('advance_amount ='), 'automatic path is writing the amount');
});

test('a receipt is raised only when money actually changed hands', () => {
  // No amount, a zero, or no method means nothing was taken — raising a
  // numbered receipt for it would burn a serial on a non-event.
  assert.match(
    bookings,
    /if \(!Number\.isFinite\(amount\) \|\| amount <= 0 \|\| !input\.advancePaymentMethod\) return;/,
    'the guard on raising a receipt for nothing is gone'
  );
});

test('a failed receipt cannot take the booking down with it', () => {
  // The booking is committed first and the receipt raised after, inside a catch.
  // A guest is standing at the desk; a numbering row that will not lock must not
  // undo an otherwise good booking.
  const fn = bookings.slice(
    bookings.indexOf('async function autoIssueAdvanceReceipt'),
    bookings.indexOf('// excludeBookingId lets an edit')
  );
  assert.ok(fn.includes('try {') && fn.includes('catch (err)'), 'auto-issue no longer swallows its own failure');
  assert.match(fn, /logger\.error\(/, 'a swallowed failure must still be recorded');

  const create = bookings.slice(bookings.indexOf('async function createBooking'));
  const commitAt = create.indexOf('await transaction.commit();');
  const issueAt = create.indexOf('await autoIssueAdvanceReceipt(');
  assert.ok(commitAt > 0 && issueAt > commitAt, 'the receipt must be raised after the booking commits, not inside it');
});

test('the stay bill still requires the payment to be entered', () => {
  // The counterpart rule. collectedAmount is required by the schema precisely
  // so a bill cannot be issued without recording what was taken for it.
  const schema = fs.readFileSync(path.join(SRC, 'billing', 'billing.schema.js'), 'utf8');
  assert.match(
    schema,
    /collectedAmount: z\.coerce\s*\n?\s*\.number\(/,
    'collectedAmount is no longer required — a bill could now be issued with no payment recorded against it'
  );
});

// The guard on the receipt has to know which path it is on. Raised
// automatically, the booking row already holds the advance being receipted, so
// "already held" must be read net of it — or the guard adds the amount twice
// and refuses a receipt to any advance over half the stay, and to every stay
// paid in full. The booking survives (that is the point of the automatic path
// being unable to fail it), which is what made this silent: no error, just no
// receipt to print.
const RECEIPTS_SRC = path.join(__dirname, '..', 'src', 'modules', 'billing', 'advanceReceipts.service.js');
const receiptsSrc = fs.readFileSync(RECEIPTS_SRC, 'utf8');

test('the automatic path tells the guard the advance is already on the row', () => {
  assert.match(
    receiptsSrc,
    /buildReceiptPreview\(booking, slabs, input, \{ alreadyOnBooking \}\)/,
    'issueAdvanceReceipt stopped passing alreadyOnBooking to the guard'
  );
  assert.match(
    receiptsSrc,
    /const alreadyHeld = heldBefore\(booking, amount, alreadyOnBooking\)/,
    'the guard no longer reads the held figure net of the amount on the automatic path'
  );
  // The manual preview must keep reading the raw row: nothing has been added
  // to it yet, so nothing is to be netted out.
  assert.match(receiptsSrc, /return buildReceiptPreview\(booking, slabs, input\);/, 'the manual preview changed shape');
});

test('what counts as already held, on each path', () => {
  const round2 = (n) => Math.round(n * 100) / 100;
  // Reproduced from the service so the arithmetic is exercised.
  const heldBefore = (onRow, amount, alreadyOnBooking) =>
    alreadyOnBooking ? Math.max(0, round2(round2(onRow) - amount)) : round2(onRow);
  const refused = (onRow, amount, stayTotal, alreadyOnBooking) =>
    round2(heldBefore(onRow, amount, alreadyOnBooking) + amount) > stayTotal;

  // A stay paid in full at booking: the row holds 4,500, the receipt is for
  // 4,500. Held before it: nothing. Allowed.
  assert.strictEqual(refused(4500, 4500, 4500, true), false, 'a full payment is refused its receipt');
  // More than half the stay, taken at booking — the case that was failing.
  assert.strictEqual(refused(3000, 3000, 4500, true), false, 'a large advance is refused its receipt');
  // A second instalment at check-in: 1,000 was held, 2,000 more just went on
  // the row. Held before this one is 1,000; 3,000 in all, within 4,500.
  assert.strictEqual(refused(3000, 2000, 4500, true), false, 'a second instalment is refused');
  // The manual path adds money the row does not have yet, so it counts as-is:
  // 3,000 held plus another 3,000 does pass 4,500 and must be refused.
  assert.strictEqual(refused(3000, 3000, 4500, false), true, 'the manual path lost the cap');
  // Never negative, whatever the row says.
  assert.strictEqual(heldBefore(100, 300, true), 0);
});
