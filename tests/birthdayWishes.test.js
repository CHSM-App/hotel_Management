const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Same preamble as the other WhatsApp suites.
process.env.DB_SERVER ||= 'localhost';
process.env.DB_PORT ||= '1433';
process.env.DB_NAME ||= 'lodge_test';
process.env.DB_USER ||= 'sa';
process.env.DB_PASSWORD ||= 'test';
process.env.JWT_SECRET ||= 'a'.repeat(40);
// Must be OFF for these tests: with a template id set the notifier would go
// looking for a database.
delete process.env.WHATSAPP_BIRTHDAY_TEMPLATE_ID;

const { buildBirthdaySample, clean, notifyBirthday } = require('../src/modules/notifications/birthdayWishes');
const { sendDueBirthdayWishes } = require('../src/modules/customers/birthdayWishes.service');
const whatsapp = require('../src/config/whatsapp');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const lodge = { name: 'Sea View Lodge' };
const customer = { id: 7, name: 'Rahul Patil', phone: '9876543210' };

// ---------------------------------------------------------------------------
// The two variables, in template order
// ---------------------------------------------------------------------------

test('a birthday wish fills the two template variables in order', () => {
  const sample = buildBirthdaySample(customer, lodge);
  assert.deepStrictEqual(sample, ['Rahul Patil', 'Sea View Lodge']);
});

test('clean() collapses whitespace, replaces commas, and never yields an empty variable', () => {
  assert.strictEqual(clean('  Sea View,  Lodge '), 'Sea View - Lodge');
  assert.strictEqual(clean(''), '-');
  assert.strictEqual(clean(null), '-');
});

// ---------------------------------------------------------------------------
// Off unless configured, and never throwing
// ---------------------------------------------------------------------------

test('with no template configured the notifier skips without touching the database', async () => {
  assert.strictEqual(whatsapp.isBirthdayTemplateConfigured(), false);
  assert.deepStrictEqual(await notifyBirthday(1, customer, lodge), { status: 'skipped', reason: 'not configured' });
});

test('with no template configured the sweep does nothing, never throws', async () => {
  assert.deepStrictEqual(await sendDueBirthdayWishes(), { checked: 0, sent: 0, skipped: 0, failed: 0 });
});

// ---------------------------------------------------------------------------
// The exact shape the notifier expects
// ---------------------------------------------------------------------------

test('reads the camelCase/plain fields buildBirthdaySample expects', () => {
  const src = read('src/modules/notifications/birthdayWishes.js');
  assert.match(src, /customer\.name/);
  assert.match(src, /customer\.phone/);
  assert.match(src, /lodge\.name/);
});

// ---------------------------------------------------------------------------
// One wish per birthday, per customer, per year — the dedup rule
// ---------------------------------------------------------------------------

test('the sweep only selects customers whose dedup column disagrees with the current year', () => {
  const src = read('src/modules/customers/birthdayWishes.service.js');
  assert.match(src, /MONTH\(c\.date_of_birth\) = @month AND DAY\(c\.date_of_birth\) = @day/);
  assert.match(src, /last_birthday_wished_at IS NULL OR YEAR\(c\.last_birthday_wished_at\) < @year/);
});

test('the sweep marks a customer wished with a lodge-scoped write', () => {
  const src = read('src/modules/customers/birthdayWishes.service.js');
  assert.match(src, /UPDATE dbo\.customers SET last_birthday_wished_at = SYSDATETIMEOFFSET\(\) WHERE id = @id AND lodge_id = @lodgeId/);
});

// ---------------------------------------------------------------------------
// Where it fires from
// ---------------------------------------------------------------------------

test('server.js schedules the birthday sweep daily at 9 AM IST, as its own job', () => {
  const src = read('src/server.js');
  assert.match(src, /sendDueBirthdayWishes/);
  const occurrences = src.match(/0 9 \* \* \*/g) || [];
  assert.ok(occurrences.length >= 2, 'expected the stay-reminder and birthday sweeps to each have their own 9 AM schedule');
  assert.match(src, /Asia\/Kolkata/);
});

test('.env.example documents the template switch', () => {
  assert.match(read('.env.example'), /^WHATSAPP_BIRTHDAY_TEMPLATE_ID=/m);
});

// ---------------------------------------------------------------------------
// date_of_birth is entered by hand, round-trips through the customer record
// ---------------------------------------------------------------------------

test('customers.service.js reads and writes date_of_birth on create, update and the mapped shape', () => {
  const src = read('src/modules/customers/customers.service.js');
  assert.match(src, /dateOfBirth: row\.date_of_birth/);
  assert.match(src, /input\.dateOfBirth/);
  assert.match(src, /date_of_birth/);
});

test('customers.schema.js validates dateOfBirth on both create and update', () => {
  const src = read('src/modules/customers/customers.schema.js');
  assert.match(src, /dateOfBirth: dateOfBirthField\(\)/g);
});
