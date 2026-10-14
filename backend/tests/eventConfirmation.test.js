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
delete process.env.WHATSAPP_EVENT_BOOKING_TEMPLATE_ID;

const {
  buildEventConfirmationSample,
  eventDate,
  eventTimeRange,
  directionsFor,
  clean,
  notifyEventBooked,
} = require('../src/modules/notifications/eventConfirmation');
const whatsapp = require('../src/config/whatsapp');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const lodge = {
  name: 'Sea View Lodge',
  phone: '02366-123456',
  whatsapp_number: '9876500000',
  address: 'Near Bus Stand, Vengurla',
  city: 'Vengurla',
  state: 'Maharashtra',
  latitude: 15.861,
  longitude: 73.632,
};

const event = {
  id: 7,
  organiserName: 'Sharma',
  organiserPhone: '9876543210',
  venueName: 'Lawn',
  startAt: '2026-09-12T12:30:00.000Z',
  endAt: '2026-09-12T19:30:00.000Z',
  advanceAmount: 10000,
  totalAmount: 40000,
  balanceDue: 30000,
};

// ---------------------------------------------------------------------------
// The ten variables, in template order
// ---------------------------------------------------------------------------

test('a function fills the ten template variables in order, with one combined time range', () => {
  const sample = buildEventConfirmationSample(event, lodge);
  assert.deepStrictEqual(sample, [
    'Sharma',
    'Sea View Lodge',
    'Lawn',
    '12 Sep 2026',
    '6:00 PM - 1:00 AM',
    '10000.00',
    '40000.00',
    '30000.00',
    'https://www.google.com/maps/search/?api=1&query=15.861%2C73.632',
    '02366-123456',
  ]);
});

test('eventDate reads the calendar day the event starts, in IST', () => {
  assert.strictEqual(eventDate('2026-09-12T18:30:00.000Z'), '13 Sep 2026');
  assert.strictEqual(eventDate('2026-09-12T06:30:00.000Z'), '12 Sep 2026');
});

test('eventTimeRange joins start and end as one variable, not two', () => {
  assert.strictEqual(eventTimeRange('2026-09-12T12:30:00.000Z', '2026-09-12T19:30:00.000Z'), '6:00 PM - 1:00 AM');
});

test('no value ever carries a comma — it is the variable separator', () => {
  const noPin = { ...lodge, latitude: null, longitude: null, phone: null, name: 'Hotel Sai, Vengurla' };
  for (const value of buildEventConfirmationSample({ ...event, organiserName: 'A, B' }, noPin)) {
    assert.ok(!value.includes(','), `comma in "${value}"`);
  }
});

test('a venue with no name on file reads as a dash, not blank', () => {
  const sample = buildEventConfirmationSample({ ...event, venueName: null }, lodge);
  assert.strictEqual(sample[2], '-');
});

test('clean() collapses whitespace, replaces commas, and never yields an empty variable', () => {
  assert.strictEqual(clean('  Near  Bus Stand,Vengurla '), 'Near Bus Stand - Vengurla');
  assert.strictEqual(clean(''), '-');
  assert.strictEqual(clean(null), '-');
  assert.strictEqual(clean(undefined), '-');
});

// ---------------------------------------------------------------------------
// Directions and contact
// ---------------------------------------------------------------------------

test('directions prefer the map pin and fall back to the address', () => {
  assert.strictEqual(directionsFor(lodge), 'https://www.google.com/maps/search/?api=1&query=15.861%2C73.632');
  assert.strictEqual(
    directionsFor({ ...lodge, latitude: null, longitude: null }),
    'Near Bus Stand - Vengurla - Maharashtra'
  );
  assert.strictEqual(directionsFor({ latitude: null, longitude: null }), '-');
});

test('the property phone falls back to its WhatsApp number', () => {
  assert.strictEqual(buildEventConfirmationSample(event, { ...lodge, phone: null })[9], '9876500000');
  assert.strictEqual(buildEventConfirmationSample(event, { ...lodge, phone: null, whatsapp_number: null })[9], '-');
});

// ---------------------------------------------------------------------------
// Money — balance due falls back to total minus advance when not given
// ---------------------------------------------------------------------------

test('balance due is total minus advance when not supplied, formatted as plain digits', () => {
  const sample = buildEventConfirmationSample({ ...event, advanceAmount: 1234.5, totalAmount: 9000, balanceDue: undefined }, lodge);
  assert.strictEqual(sample[5], '1234.50');
  assert.strictEqual(sample[6], '9000.00');
  assert.strictEqual(sample[7], '7765.50');
});

// ---------------------------------------------------------------------------
// Off unless configured, and never throwing
// ---------------------------------------------------------------------------

test('with no template configured the notifier skips without touching the database', async () => {
  assert.strictEqual(whatsapp.isEventBookingTemplateConfigured(), false);
  assert.deepStrictEqual(await notifyEventBooked(1, { id: 1 }), { status: 'skipped', reason: 'not configured' });
});

// ---------------------------------------------------------------------------
// Where it fires from
// ---------------------------------------------------------------------------

test('a function taking its venue fires the event confirmation, unawaited', () => {
  const events = read('src/modules/events/events.service.js');
  // On creation only when the status blocks the venue — an enquiry is not
  // told "confirmed".
  assert.match(events, /if \(blocks\) void eventConfirmation\.notifyEventBooked\(lodgeId, event\)/);
  // On a transition only when the venue was not already held — a tentative
  // hold that is then confirmed is not told twice.
  assert.match(events, /BLOCKING\.includes\(to\) && !BLOCKING\.includes\(current\.status\)/);
});

test('.env.example documents the event booking template', () => {
  assert.match(read('.env.example'), /^WHATSAPP_EVENT_BOOKING_TEMPLATE_ID=/m);
});
