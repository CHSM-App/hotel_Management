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
delete process.env.WHATSAPP_EVENT_REMINDER_TEMPLATE_ID;

const {
  buildReminderSample,
  eventDate,
  eventTime,
  DAYS_AWAY_LABEL,
  clean,
  notifyUpcomingEvent,
} = require('../src/modules/notifications/eventReminder');
const whatsapp = require('../src/config/whatsapp');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const lodge = { name: 'Sea View Lodge', phone: '9123456780', whatsappNumber: null };

const event = {
  id: 7,
  organiserName: 'Sharma',
  organiserPhone: '9876543210',
  venueName: 'Lawn',
  startAt: '2026-09-12T12:30:00.000Z',
};

// ---------------------------------------------------------------------------
// The seven variables, in template order
// ---------------------------------------------------------------------------

test('a reminder fills the seven template variables in order', () => {
  const sample = buildReminderSample(event, lodge);
  assert.deepStrictEqual(sample, ['Sharma', 'Sea View Lodge', 'tomorrow', 'Lawn', '12 Sep 2026', '6:00 PM', '9123456780']);
});

test('DAYS_AWAY_LABEL is always "tomorrow" — there is only the one reminder moment', () => {
  assert.strictEqual(DAYS_AWAY_LABEL, 'tomorrow');
});

test('eventDate and eventTime read the event\'s start instant in IST', () => {
  assert.strictEqual(eventDate('2026-09-12T18:30:00.000Z'), '13 Sep 2026');
  assert.strictEqual(eventTime('2026-09-12T18:30:00.000Z'), '12:00 AM');
  assert.strictEqual(eventTime('2026-09-12T06:30:00.000Z'), '12:00 PM');
});

test('clean() collapses whitespace, replaces commas, and never yields an empty variable', () => {
  assert.strictEqual(clean('  Sea View,  Lodge '), 'Sea View - Lodge');
  assert.strictEqual(clean(''), '-');
  assert.strictEqual(clean(null), '-');
});

test('a venue with no name on file reads as a dash, not blank', () => {
  const sample = buildReminderSample({ ...event, venueName: null }, lodge);
  assert.strictEqual(sample[3], '-');
});

test('the lodge phone falls back to its WhatsApp number', () => {
  assert.strictEqual(buildReminderSample(event, { ...lodge, phone: null, whatsappNumber: '9876500000' })[6], '9876500000');
  assert.strictEqual(buildReminderSample(event, { phone: null, whatsappNumber: null })[6], '-');
});

// ---------------------------------------------------------------------------
// Off unless configured, and never throwing
// ---------------------------------------------------------------------------

test('with no template configured the notifier skips without touching the database', async () => {
  assert.strictEqual(whatsapp.isEventReminderTemplateConfigured(), false);
  assert.deepStrictEqual(await notifyUpcomingEvent(1, event, lodge), { status: 'skipped', reason: 'not configured' });
});

// ---------------------------------------------------------------------------
// Where it fires from
// ---------------------------------------------------------------------------

test('the daily sweep only reminds a confirmed function, once', () => {
  const src = read('src/modules/events/eventReminders.service.js');
  assert.match(src, /status = 'CONFIRMED'/);
  assert.match(src, /reminder_sent_at IS NULL/);
  assert.match(src, /reminder_sent_at = SYSDATETIMEOFFSET\(\)/);
});

test('server.js schedules the sweep at 9 AM IST, not left to run in server local time', () => {
  const src = read('src/server.js');
  assert.match(src, /sendDueEventReminders/);
  assert.match(src, /Asia\/Kolkata/);
});

test('.env.example documents the template switch', () => {
  assert.match(read('.env.example'), /^WHATSAPP_EVENT_REMINDER_TEMPLATE_ID=/m);
});

test('the migration and schema.sql both add reminder_sent_at to event_bookings', () => {
  assert.match(read('migrations/140_event_reminder_sent_at.sql'), /ADD reminder_sent_at DATETIMEOFFSET NULL/);
  const schema = read('src/config/schema.sql');
  assert.match(schema, /event_bookings', 'reminder_sent_at'/);
});
