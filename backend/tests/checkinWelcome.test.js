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
delete process.env.WHATSAPP_CHECKIN_TEMPLATE_ID;

const { buildCheckinSample, clean, notifyCheckedIn } = require('../src/modules/notifications/checkinWelcome');
const whatsapp = require('../src/config/whatsapp');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const lodge = { name: 'Sea View Lodge', phone: '9123456780', whatsappNumber: null };

// getBooking()'s mapped shape (camelCase) — what checkIn in
// bookings.service.js actually passes to notifyCheckedIn, NOT the raw
// snake_case dbo.bookings row. Same fixture shape as cancellationNotice's,
// for the same reason: a field-name mismatch here would silently skip with
// "no guest phone" in production while every test still passed.
const booking = {
  id: 41,
  guestName: 'Rahul Patil',
  guestPhone: '9876543210',
  roomNumbers: '204',
  checkOutDate: '2026-09-14',
};

// ---------------------------------------------------------------------------
// The five variables, in template order
// ---------------------------------------------------------------------------

test('a check-in fills the five template variables in order', () => {
  const sample = buildCheckinSample(booking, lodge);
  assert.deepStrictEqual(sample, ['Rahul Patil', 'Sea View Lodge', '204', '14 Sep 2026', '9123456780']);
});

test('a multi-room booking sends every room, not just the first', () => {
  // The comma joining the room numbers becomes " - ": clean() always turns a
  // comma into that, since a real comma is the variable separator in the
  // sample string sent to the provider (see clean()'s own doc comment).
  const sample = buildCheckinSample({ ...booking, roomNumbers: '204, 205' }, lodge);
  assert.strictEqual(sample[2], '204 - 205');
});

test('no phone on the lodge falls back to its WhatsApp number', () => {
  const sample = buildCheckinSample(booking, { name: 'Sea View Lodge', phone: null, whatsappNumber: '9988776655' });
  assert.strictEqual(sample[4], '9988776655');
});

test('clean() collapses whitespace, replaces commas, and never yields an empty variable', () => {
  assert.strictEqual(clean('  Room 204,  Annex '), 'Room 204 - Annex');
  assert.strictEqual(clean(''), '-');
  assert.strictEqual(clean(null), '-');
});

// ---------------------------------------------------------------------------
// Off unless configured, and never throwing
// ---------------------------------------------------------------------------

test('with no template configured the notifier skips without touching the database', async () => {
  assert.strictEqual(whatsapp.isCheckinTemplateConfigured(), false);
  assert.deepStrictEqual(await notifyCheckedIn(1, booking), { status: 'skipped', reason: 'not configured' });
});

// ---------------------------------------------------------------------------
// The exact shape getBooking() hands over — the field-name mismatch this
// suite exists to catch (same regression cancellationNotice.test.js guards)
// ---------------------------------------------------------------------------

test('reads the camelCase fields getBooking() actually returns, not the raw snake_case row', () => {
  const src = read('src/modules/notifications/checkinWelcome.js');
  assert.match(src, /booking\.guestPhone/);
  assert.match(src, /booking\.guestName/);
  assert.match(src, /booking\.roomNumbers/);
  assert.match(src, /booking\.checkOutDate/);
  assert.doesNotMatch(src, /booking\.guest_phone/);
  assert.doesNotMatch(src, /booking\.guest_name/);
  assert.doesNotMatch(src, /booking\.room_numbers/);
  assert.doesNotMatch(src, /booking\.check_out_date/);
});

// ---------------------------------------------------------------------------
// Where it fires from
// ---------------------------------------------------------------------------

test('a check-in fires the welcome, fire-and-forget rather than awaited', () => {
  const bookings = read('src/modules/bookings/bookings.service.js');
  assert.match(bookings, /void checkinWelcome\.notifyCheckedIn\(lodgeId, booking\)/);
});

test('.env.example documents the template switch', () => {
  assert.match(read('.env.example'), /^WHATSAPP_CHECKIN_TEMPLATE_ID=/m);
});
