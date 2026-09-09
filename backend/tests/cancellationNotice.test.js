const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Same preamble as the other WhatsApp suites: the notifier pulls in the
// connection config at require time, so the environment has to be valid
// before it loads. None of these tests reach SQL Server or the provider.
process.env.DB_SERVER ||= 'localhost';
process.env.DB_PORT ||= '1433';
process.env.DB_NAME ||= 'lodge_test';
process.env.DB_USER ||= 'sa';
process.env.DB_PASSWORD ||= 'test';
process.env.JWT_SECRET ||= 'a'.repeat(40);
// Must be OFF for these tests: with a template id set the notifier would go
// looking for a database.
delete process.env.WHATSAPP_CANCELLATION_TEMPLATE_ID;

const {
  buildCancellationSample,
  refundModeAmount,
  clean,
  notifyBookingCancelled,
} = require('../src/modules/notifications/cancellationNotice');
const whatsapp = require('../src/config/whatsapp');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const lodge = { name: 'Sea View Lodge' };

// getBooking()'s mapped shape (camelCase) — what cancelBooking in
// bookings.service.js actually passes to notifyBookingCancelled, NOT the raw
// snake_case dbo.bookings row. An earlier version of this fixture used the
// raw-row shape, which made every test here pass while the notifier silently
// read undefined for guest_phone/check_in_date/etc. in production and always
// skipped with "no guest phone" — the bug this fixture shape exists to catch.
const booking = {
  id: 41,
  guestName: 'Rahul Patil',
  guestPhone: '9876543210',
  checkInDate: '2026-09-12',
  checkOutDate: '2026-09-14',
  cancelReason: 'Change of plans',
  refundAmount: 1500,
  refundPaymentMethod: 'UPI',
  cancellationCharge: null,
  cancellationChargePaymentMethod: null,
};

// ---------------------------------------------------------------------------
// The seven variables, in template order
// ---------------------------------------------------------------------------

test('a cancellation fills the seven template variables in order', () => {
  const sample = buildCancellationSample(booking, lodge);
  assert.deepStrictEqual(sample, [
    'Rahul Patil',
    'Sea View Lodge',
    '#41',
    '12 Sep 2026',
    '14 Sep 2026',
    'Change of plans',
    'Refund: Rs 1500.00 via UPI',
  ]);
});

test('a cancellation charge fills the same slot when there is no refund', () => {
  const charged = {
    ...booking,
    refundAmount: null,
    refundPaymentMethod: null,
    cancellationCharge: 500,
    cancellationChargePaymentMethod: 'CASH',
  };
  assert.strictEqual(refundModeAmount(charged), 'Cancellation charge: Rs 500.00 via CASH');
});

test('neither a refund nor a charge reads as "No refund due"', () => {
  assert.strictEqual(
    refundModeAmount({ refundAmount: null, cancellationCharge: null }),
    'No refund due'
  );
  assert.strictEqual(
    refundModeAmount({ refundAmount: 0, cancellationCharge: 0 }),
    'No refund due'
  );
});

test('a missing reason reads as "Not specified" rather than a dash', () => {
  const sample = buildCancellationSample({ ...booking, cancelReason: null }, lodge);
  assert.strictEqual(sample[5], 'Not specified');
});

test('no value ever carries a comma — it is the variable separator', () => {
  const messy = { ...booking, cancelReason: 'Family, emergency', guestName: 'A, B' };
  for (const value of buildCancellationSample(messy, { name: 'Hotel Sai, Vengurla' })) {
    assert.ok(!value.includes(','), `comma in "${value}"`);
  }
});

test('clean() collapses whitespace, replaces commas, and never yields an empty variable', () => {
  assert.strictEqual(clean('  Family,  emergency '), 'Family - emergency');
  assert.strictEqual(clean(''), '-');
  assert.strictEqual(clean(null), '-');
});

// ---------------------------------------------------------------------------
// Off unless configured, and never throwing
// ---------------------------------------------------------------------------

test('with no template configured the notifier skips without touching the database', async () => {
  assert.strictEqual(whatsapp.isCancellationTemplateConfigured(), false);
  assert.deepStrictEqual(await notifyBookingCancelled(1, booking), { status: 'skipped', reason: 'not configured' });
});

// ---------------------------------------------------------------------------
// The exact shape getBooking() hands over — the field-name mismatch this
// suite exists to catch
// ---------------------------------------------------------------------------

test('reads the camelCase fields getBooking() actually returns, not the raw snake_case row', () => {
  const src = read('src/modules/notifications/cancellationNotice.js');
  // Every field the notifier touches on `booking` must be the mapped name.
  assert.match(src, /booking\.guestPhone/);
  assert.match(src, /booking\.guestName/);
  assert.match(src, /booking\.checkInDate/);
  assert.match(src, /booking\.checkOutDate/);
  assert.match(src, /booking\.cancelReason/);
  assert.match(src, /booking\.refundAmount/);
  assert.match(src, /booking\.refundPaymentMethod/);
  assert.match(src, /booking\.cancellationCharge\b/);
  assert.match(src, /booking\.cancellationChargePaymentMethod/);
  // None of the raw snake_case names should remain — a regression here is
  // exactly the "no toast, no message, no error" bug this file was written
  // to catch after it shipped once already.
  assert.doesNotMatch(src, /booking\.guest_phone/);
  assert.doesNotMatch(src, /booking\.guest_name/);
  assert.doesNotMatch(src, /booking\.check_in_date/);
  assert.doesNotMatch(src, /booking\.check_out_date/);
  assert.doesNotMatch(src, /booking\.cancel_reason/);
  assert.doesNotMatch(src, /booking\.refund_amount/);
  assert.doesNotMatch(src, /booking\.refund_payment_method/);
  assert.doesNotMatch(src, /booking\.cancellation_charge/);
});

// ---------------------------------------------------------------------------
// Where it fires from
// ---------------------------------------------------------------------------

test('a cancelled booking fires the notice and reports its result on the response', () => {
  const bookings = read('src/modules/bookings/bookings.service.js');
  assert.match(bookings, /await cancellationNotice\.notifyBookingCancelled\(lodgeId, booking\)/);
  assert.match(bookings, /return \{ \.\.\.booking, whatsapp \};/);
});

test('.env.example documents the template switch', () => {
  assert.match(read('.env.example'), /^WHATSAPP_CANCELLATION_TEMPLATE_ID=/m);
});
