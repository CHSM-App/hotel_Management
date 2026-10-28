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
delete process.env.WHATSAPP_EVENT_RESCHEDULE_TEMPLATE_ID;

const {
  buildRescheduleSample,
  newDate,
  newTime,
  clean,
  notifyEventRescheduled,
} = require('../src/modules/notifications/eventReschedule');
const whatsapp = require('../src/config/whatsapp');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const lodge = { name: 'Sea View Lodge', phone: '02366-123456', whatsapp_number: '9876500000' };

// getEventBooking()'s mapped shape (camelCase) — what updateEventBooking in
// events.service.js actually passes to notifyEventRescheduled, the *updated*
// row after the edit.
const event = {
  id: 7,
  organiserName: 'Sharma',
  organiserPhone: '9876543210',
  venueName: 'Lawn',
  startAt: '2026-09-15T12:30:00.000Z',
};

// ---------------------------------------------------------------------------
// The six variables, in template order
// ---------------------------------------------------------------------------

test('a reschedule notice fills the six template variables in order', () => {
  const sample = buildRescheduleSample(event, lodge);
  assert.deepStrictEqual(sample, ['Sharma', 'Sea View Lodge', 'Lawn', '15 Sep 2026', '6:00 PM', '02366-123456']);
});

test('newDate and newTime read the updated start instant in IST', () => {
  assert.strictEqual(newDate('2026-09-15T18:30:00.000Z'), '16 Sep 2026');
  assert.strictEqual(newTime('2026-09-15T18:30:00.000Z'), '12:00 AM');
  assert.strictEqual(newTime('2026-09-15T06:30:00.000Z'), '12:00 PM');
});

test('no value ever carries a comma — it is the variable separator', () => {
  const noPin = { ...lodge, name: 'Hotel Sai, Vengurla' };
  for (const value of buildRescheduleSample({ ...event, organiserName: 'A, B' }, noPin)) {
    assert.ok(!value.includes(','), `comma in "${value}"`);
  }
});

test('a venue with no name on file reads as a dash, not blank', () => {
  const sample = buildRescheduleSample({ ...event, venueName: null }, lodge);
  assert.strictEqual(sample[2], '-');
});

test('clean() collapses whitespace, replaces commas, and never yields an empty variable', () => {
  assert.strictEqual(clean('  Near  Bus Stand,Vengurla '), 'Near Bus Stand - Vengurla');
  assert.strictEqual(clean(''), '-');
  assert.strictEqual(clean(null), '-');
  assert.strictEqual(clean(undefined), '-');
});

test('the property phone falls back to its WhatsApp number', () => {
  assert.strictEqual(buildRescheduleSample(event, { ...lodge, phone: null })[5], '9876500000');
  assert.strictEqual(buildRescheduleSample(event, { ...lodge, phone: null, whatsapp_number: null })[5], '-');
});

// ---------------------------------------------------------------------------
// Off unless configured, and never throwing
// ---------------------------------------------------------------------------

test('with no template configured the notifier skips without touching the database', async () => {
  assert.strictEqual(whatsapp.isEventRescheduleTemplateConfigured(), false);
  assert.deepStrictEqual(await notifyEventRescheduled(1, { id: 1 }), { status: 'skipped', reason: 'not configured' });
});

// ---------------------------------------------------------------------------
// Where it fires from
// ---------------------------------------------------------------------------

test('only a confirmed function that actually moved fires the reschedule notice', () => {
  const src = read('src/modules/events/events.service.js');
  assert.match(src, /if \(moved && blocks\) \{\s*void eventReschedule\.notifyEventRescheduled\(lodgeId, updated\);/);
});

test('.env.example documents the event reschedule template', () => {
  assert.match(read('.env.example'), /^WHATSAPP_EVENT_RESCHEDULE_TEMPLATE_ID=/m);
});
