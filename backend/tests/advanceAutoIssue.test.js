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
  const render = (alreadyOnBooking) => `
        UPDATE dbo.bookings
        SET ${alreadyOnBooking ? '' : 'advance_amount = ISNULL(advance_amount, 0) + @amount,'}
            advance_payment_method = @method,
            advance_reference = COALESCE(@reference, advance_reference)
        WHERE id = @bookingId AND lodge_id = @lodgeId`;

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
