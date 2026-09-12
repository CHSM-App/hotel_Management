const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  createBookingSchema,
  checkInSchema,
  updateBookingSchema,
} = require('../src/modules/bookings/bookings.schema');

// Reception negotiates a room rate at the desk the same way it negotiates an
// extra — "call it 1,000 for the night". basePriceOverride is that rate, and it
// replaces the category's starting price for this stay only: seasons still
// apply on top of it, and extras are still added flat after that.
//
// The column and the pricing engine already supported this; it had been made
// unsettable when concessions arrived, and this is it settable again.

const booking = (over) => ({
  roomId: 1,
  checkInDate: '2026-09-01',
  checkOutDate: '2026-09-02',
  numGuests: 1,
  guestName: 'A Guest',
  guestPhone: '9876543210',
  bookingType: 'ADVANCE',
  guests: [],
  vehicles: [],
  switchableCharges: [],
  ...over,
});

test('a booking may be taken at an agreed nightly rate', () => {
  // Sent as a string: the booking form is multipart because it carries ID
  // documents, so every scalar arrives as text.
  const parsed = createBookingSchema.safeParse(booking({ basePriceOverride: '1000' }));
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  assert.equal(parsed.data.basePriceOverride, 1000);
});

test('most stays name no rate at all and price at the category', () => {
  const parsed = createBookingSchema.safeParse(booking());
  assert.ok(parsed.success);
  assert.equal(parsed.data.basePriceOverride, undefined);
});

// basePriceOf ignores a non-positive override rather than selling the room for
// nothing, so one that got through would be silently discarded — the stay would
// price at rack rate and nobody would be told why.
test('a rate of zero or less is a mis-key, not a free room', () => {
  for (const rate of ['0', '-50']) {
    const parsed = createBookingSchema.safeParse(booking({ basePriceOverride: rate }));
    assert.equal(parsed.success, false, `${rate} was accepted`);
  }
  assert.equal(createBookingSchema.safeParse(booking({ basePriceOverride: 'abc' })).success, false);
});

// Check-in records an arrival against a stay that is already priced. Letting it
// carry a rate would re-price a booking at the moment the guest walks in.
test('checking in cannot re-price the stay', () => {
  const parsed = checkInSchema.safeParse({ guests: [], vehicles: [], basePriceOverride: '900' });
  assert.ok(parsed.success);
  assert.ok(!('basePriceOverride' in parsed.data), 'check-in is carrying a room rate');
});

// The three-way rule the edit path needs, and the reason blank is not the same
// as absent: a save that only moves the dates must not quietly put the stay
// back on rack rate.
test('an edit can set the rate, clear it, or leave it alone', () => {
  const set = updateBookingSchema.safeParse({ basePriceOverride: '900' });
  assert.ok(set.success);
  assert.equal(set.data.basePriceOverride, 900);

  const cleared = updateBookingSchema.safeParse({ basePriceOverride: '' });
  assert.ok(cleared.success);
  assert.equal(cleared.data.basePriceOverride, null, 'blank must mean "back to the category rate"');

  const untouched = updateBookingSchema.safeParse({ guestName: 'B' });
  assert.ok(untouched.success);
  assert.ok(
    !('basePriceOverride' in untouched.data),
    'absent must stay absent, or every edit re-prices the stay'
  );
});

// The room line is picked out of the quote by a flag, never by its label — the
// label carries the price ("Standard ₹1,234 (custom)"), so matching on it would
// stop working at exactly the moment somebody edited the rate.
test('the quote flags its room line for the form', () => {
  const pricing = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'modules', 'pricing', 'pricing.service.js'),
    'utf8'
  );
  assert.match(pricing, /isBase: true/, 'the priced night no longer marks its room line');
  assert.match(pricing, /isBase: label === base/, 'the aggregate no longer marks its room line');

  const bookings = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'modules', 'bookings', 'bookings.service.js'),
    'utf8'
  );
  assert.match(
    bookings,
    /isBase: Boolean\(line\.isBase\)/,
    'priceStay drops the flag when it reshapes lines into charges, so the box never renders'
  );
});

// The INSERT names the column; without the matching bind, mssql rejects the
// statement and every new booking fails.
test('the agreed rate is bound on the create insert', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'modules', 'bookings', 'bookings.service.js'),
    'utf8'
  );
  const insert = src.slice(src.indexOf('INSERT INTO dbo.bookings'));
  assert.ok(insert.includes('base_price_override'), 'the insert stopped storing the rate');
  assert.equal(
    (src.match(/\.input\('basePriceOverride'/g) || []).length,
    2,
    'the rate must be bound exactly twice — once on create, once on update'
  );
});

// The quote is fetched with the rate in its URL, so the rate has to be in the
// effect's dependency list. It was not, and because exhaustive-deps is disabled
// on that effect nothing flagged it: typing a new room rate rebuilt the request
// string but never re-ran the request, so the total on screen never moved.
test('the quote refetches when the room rate changes', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'lodge', 'Bookings.jsx'),
    'utf8'
  );
  const call = src.indexOf('/bookings/price-quote?');
  assert.ok(call > 0, 'the price-quote request has moved');
  assert.ok(
    src.slice(call).includes('rateParam(bookingForm.basePriceOverride)'),
    'the quote is no longer priced at the rate in the form'
  );
  // The dependency array closing this effect, taken from the request onwards.
  const deps = src.slice(call, src.indexOf(']);', call));
  assert.ok(
    deps.includes('bookingForm.basePriceOverride,'),
    'basePriceOverride is missing from the quote deps — the room rate would change the '
      + 'request URL without ever re-issuing the request'
  );
});
