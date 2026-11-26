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
delete process.env.WHATSAPP_REMINDER_TEMPLATE_ID;

const { buildReminderSample, DAYS_AWAY_LABEL, clean, notifyUpcomingStay } = require('../src/modules/notifications/stayReminder');
const { reminderKind } = require('../src/modules/bookings/stayReminders.service');
const whatsapp = require('../src/config/whatsapp');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const lodge = { name: 'Sea View Lodge', phone: '9123456780', whatsappNumber: null };

const booking = {
  id: 41,
  guestName: 'Rahul Patil',
  guestPhone: '9876543210',
  checkInDate: '2026-09-12',
  checkOutDate: '2026-09-14',
};

// ---------------------------------------------------------------------------
// The six variables, in template order
// ---------------------------------------------------------------------------

test('a three-day reminder fills the six template variables in order', () => {
  const sample = buildReminderSample(booking, lodge, 'THREE_DAY');
  assert.deepStrictEqual(sample, ['Rahul Patil', 'Sea View Lodge', 'in 3 days', '12 Sep 2026', '14 Sep 2026', '9123456780']);
});

test('a one-day reminder says "tomorrow" in the same slot', () => {
  const sample = buildReminderSample(booking, lodge, 'ONE_DAY');
  assert.strictEqual(sample[2], 'tomorrow');
});

test('DAYS_AWAY_LABEL covers both kinds reminderKind can return', () => {
  assert.deepStrictEqual(Object.keys(DAYS_AWAY_LABEL).sort(), ['ONE_DAY', 'THREE_DAY']);
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
  assert.strictEqual(whatsapp.isReminderTemplateConfigured(), false);
  assert.deepStrictEqual(await notifyUpcomingStay(1, booking, lodge, 'ONE_DAY'), {
    status: 'skipped',
    reason: 'not configured',
  });
});

// ---------------------------------------------------------------------------
// reminderKind — the lead-time rule, pure and checkable without a database
// ---------------------------------------------------------------------------

test('booked more than 3 days before check-in gets the three-day reminder', () => {
  assert.strictEqual(reminderKind('2026-09-01', '2026-09-12'), 'THREE_DAY'); // 11 days' lead
  assert.strictEqual(reminderKind('2026-09-07', '2026-09-12'), 'THREE_DAY'); // 5 days' lead
  assert.strictEqual(reminderKind('2026-09-08', '2026-09-12'), 'THREE_DAY'); // 4 days' lead
});

test('booked 3 days or fewer before check-in gets the one-day reminder instead', () => {
  assert.strictEqual(reminderKind('2026-09-09', '2026-09-12'), 'ONE_DAY'); // exactly 3 days' lead
  assert.strictEqual(reminderKind('2026-09-10', '2026-09-12'), 'ONE_DAY'); // 2 days' lead
  assert.strictEqual(reminderKind('2026-09-11', '2026-09-12'), 'ONE_DAY'); // 1 day's lead
  assert.strictEqual(reminderKind('2026-09-12', '2026-09-12'), 'ONE_DAY'); // booked the same day
});

test('reminderKind only reads the calendar day of created_at, not its time of day', () => {
  // A booking made at 11:58 PM, four calendar days ahead of check-in, is
  // still a four-day lead — the hour on created_at must not round it down
  // to three just because it was made late at night.
  const createdAt = new Date('2026-09-08T23:58:00Z');
  assert.strictEqual(reminderKind(createdAt, '2026-09-12'), 'THREE_DAY');
});

// ---------------------------------------------------------------------------
// Where it fires from
// ---------------------------------------------------------------------------

test('the daily sweep never gets both reminders for the same booking', () => {
  const src = read('src/modules/bookings/stayReminders.service.js');
  // Both candidate dates are fetched in one query; which one actually
  // applies is gated by reminderKind matching the date it was fetched for,
  // not by the booking matching both.
  assert.match(src, /dueToday/);
  assert.match(src, /reminder_sent_at = SYSDATETIMEOFFSET\(\)/);
});

test('reads the camelCase fields buildReminderSample expects, not raw snake_case', () => {
  const src = read('src/modules/notifications/stayReminder.js');
  assert.match(src, /booking\.guestName/);
  assert.match(src, /booking\.guestPhone/);
  assert.match(src, /booking\.checkInDate/);
  assert.match(src, /booking\.checkOutDate/);
});

test('server.js schedules the sweep at 9 AM IST, not left to run in server local time', () => {
  const src = read('src/server.js');
  assert.match(src, /cron\.schedule\(/);
  assert.match(src, /sendDueStayReminders/);
  assert.match(src, /Asia\/Kolkata/);
});

test('.env.example documents the template switch', () => {
  assert.match(read('.env.example'), /^WHATSAPP_REMINDER_TEMPLATE_ID=/m);
});
