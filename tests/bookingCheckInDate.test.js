const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { updateBookingSchema } = require('../src/modules/bookings/bookings.schema');

// A reservation gets re-dated at the desk all the time — the guest calls to say
// they are arriving a day later, or the date was taken down wrong in the first
// place. That used to mean cancelling the booking and taking it again, which
// loses the advance receipt, the ID proof already on file and the party details.
//
// So an edit may move the check-in date, but only while the stay hasn't started.
// Once the guest is in the room the day they arrived is a recorded fact that the
// folio and the register both read from, and re-dating it would rewrite history
// rather than correct a plan. That line — BOOKED yes, CHECKED_IN no — is the
// thing these tests are here to hold.

const BOOKINGS = path.join(__dirname, '..', 'src', 'modules', 'bookings', 'bookings.service.js');

// Newlines normalised: the service is checked out with CRLF endings on Windows
// and LF elsewhere, and a pattern spanning two lines would only match on one of
// them.
function source() {
  return fs.readFileSync(BOOKINGS, 'utf8').split('\r\n').join('\n');
}

test('an edit may carry a new check-in date', () => {
  // Sent as a string: the edit form is multipart because it carries ID
  // documents, so every scalar arrives as text.
  const parsed = updateBookingSchema.safeParse({ checkInDate: '2026-09-04' });
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  assert.equal(parsed.data.checkInDate, '2026-09-04');
});

test('an edit that does not move the arrival leaves the field absent', () => {
  const parsed = updateBookingSchema.safeParse({ guestName: 'A Guest' });
  assert.ok(parsed.success);
  assert.equal(
    parsed.data.checkInDate,
    undefined,
    'absent has to stay absent — the service reads "same as on file" from it, ' +
      'and a defaulted value would make every save look like a re-dating'
  );
});

test('a check-in date that is not a date is refused', () => {
  const parsed = updateBookingSchema.safeParse({ checkInDate: '04-09-2026' });
  assert.ok(!parsed.success);
});

// The rules below live inside updateBooking, which cannot run without a live
// SQL Server. They are checked statically for the same reason the concurrency
// tests are: each is easy to drop while leaving code that still reads correctly
// and passes everything else.

test('a stay already under way refuses a different check-in date', () => {
  const src = source();
  assert.match(
    src,
    /if \(newCheckInDate !== currentCheckInDate && bookingRow\.status !== 'BOOKED'\)/,
    'updateBooking no longer guards the check-in date by status. Without it a ' +
      'checked-in stay could be re-dated out from under the folio and the register, ' +
      'and a checked-out one re-dated after its bill was drawn up.'
  );
});

test('re-dating counts as moving the stay, so the room is re-checked', () => {
  const src = source();
  const movingStay = src.match(/const movingStay =[\s\S]*?;\n/);
  assert.ok(movingStay, 'movingStay is no longer computed in updateBooking');
  assert.match(
    movingStay[0],
    /newCheckInDate !== currentCheckInDate/,
    'moving the arrival no longer counts as moving the stay. It frees and takes ' +
      'nights exactly as moving the departure does, and an edit that skipped the ' +
      'overlap check could put two guests in one room.'
  );
});

test('the new check-in date is the one priced, checked and written', () => {
  const src = source();
  const body = src.slice(src.indexOf('async function updateBooking('));

  assert.match(
    body,
    /if \(newCheckOutDate <= newCheckInDate\)/,
    'the one-night minimum is measured against the stored check-in date again, so ' +
      'an edit could move the arrival past the departure'
  );
  // The pre-flight overlap check, the locked one inside the transaction, and
  // priceStay. Counted rather than matched one by one: leaving any of the three
  // on the stored date would price or clear a range the save does not write, and
  // the count is what notices a fourth caller added without the same treatment.
  assert.equal(
    (body.match(/newCheckInDate,\s*newCheckOutDate,/g) || []).length,
    3,
    'one of the three places updateBooking passes the stay range on — the two ' +
      'overlap checks and priceStay — is no longer given the new check-in date'
  );
  assert.match(
    body,
    /SET room_id = @roomId, check_in_date = @checkInDate, check_out_date = @checkOutDate/,
    'the UPDATE no longer writes check_in_date, so a re-dated stay would be priced ' +
      'for its new range and then stored with its old one'
  );
});

test('the room picker is asked about the range being proposed', () => {
  const src = source();
  const start = src.indexOf('async function listAvailableRoomsForBooking(');
  assert.ok(start >= 0, 'listAvailableRoomsForBooking is gone');
  const body = src.slice(start, src.indexOf('\nasync function ', start + 1));
  assert.match(
    body,
    /requestedCheckInDate && bookingRow\.status === 'BOOKED'/,
    'the picker no longer honours a proposed check-in date, so an edit that moves ' +
      'the arrival would be offered the rooms free over the old range — and it ' +
      'must honour it only where updateBooking would accept it, or it offers rooms ' +
      'against a range the save goes on to refuse'
  );
});
