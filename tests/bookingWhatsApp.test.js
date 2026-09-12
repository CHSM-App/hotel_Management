const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Same preamble as the other suites: the notifier pulls in the connection
// config at require time, so the environment has to be valid before it loads.
// None of these tests reach SQL Server or the WhatsApp provider.
process.env.DB_SERVER ||= 'localhost';
process.env.DB_PORT ||= '1433';
process.env.DB_NAME ||= 'lodge_test';
process.env.DB_USER ||= 'sa';
process.env.DB_PASSWORD ||= 'test';
process.env.JWT_SECRET ||= 'a'.repeat(40);
// The confirmation must be OFF for these tests: with a template id set the
// notifier would go looking for a database.
delete process.env.WHATSAPP_BOOKING_TEMPLATE_ID;

const {
  buildStaySample,
  buildEventSample,
  formatInstantIST,
  directionsFor,
  clean,
  notifyStayBooked,
  notifyEventBooked,
} = require('../src/modules/notifications/bookingConfirmation');
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
  checkin_mode: 'NIGHT_BASED',
  // mssql hands a TIME column over as a Date on 1970-01-01 UTC.
  check_in_time: new Date('1970-01-01T12:00:00Z'),
  check_out_time: '10:30:00',
};

const stay = {
  id: 41,
  guest_name: 'Rahul Patil',
  guest_phone: '9876543210',
  // A DATE column is a Date at UTC midnight; the schema hands over a string.
  // Both shapes must read as the same calendar day.
  check_in_date: new Date('2026-09-12T00:00:00Z'),
  check_out_date: '2026-09-14',
};

// ---------------------------------------------------------------------------
// The seven variables, in template order
// ---------------------------------------------------------------------------

test('a stay fills the seven template variables in order', () => {
  const sample = buildStaySample(stay, lodge);
  assert.deepStrictEqual(sample, [
    'Rahul Patil',
    'Sea View Lodge',
    '#41',
    '12 Sep 2026 12:00 PM',
    '14 Sep 2026 10:30 AM',
    'https://www.google.com/maps/search/?api=1&query=15.861%2C73.632',
    '02366-123456',
  ]);
});

test('a function fills the same seven, with the venue and IST instants', () => {
  const sample = buildEventSample(
    {
      id: 7,
      organiserName: 'Sharma',
      organiserPhone: '9876543210',
      venueName: 'Lawn',
      startAt: '2026-09-12T12:30:00.000Z',
      endAt: '2026-09-12T19:30:00.000Z',
    },
    lodge
  );
  assert.deepStrictEqual(sample, [
    'Sharma',
    'Sea View Lodge (Lawn)',
    'EV-7',
    '12 Sep 2026 6:00 PM',
    '13 Sep 2026 1:00 AM',
    'https://www.google.com/maps/search/?api=1&query=15.861%2C73.632',
    '02366-123456',
  ]);
});

test('no value ever carries a comma — it is the variable separator', () => {
  // An address with commas is the ordinary case, and a comma in {{6}} would
  // put the town into the phone slot.
  const noPin = { ...lodge, latitude: null, longitude: null, phone: null, name: 'Hotel Sai, Vengurla' };
  for (const value of buildStaySample(stay, noPin)) {
    assert.ok(!value.includes(','), `comma in "${value}"`);
  }
  for (const value of buildEventSample({ id: 1, organiserName: 'A, B', startAt: stay.check_in_date, endAt: stay.check_in_date }, noPin)) {
    assert.ok(!value.includes(','), `comma in "${value}"`);
  }
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
  // The address already names the town, so the city line is not repeated.
  assert.strictEqual(
    directionsFor({ ...lodge, latitude: null, longitude: null }),
    'Near Bus Stand - Vengurla - Maharashtra'
  );
  assert.strictEqual(
    directionsFor({ ...lodge, latitude: null, longitude: null, address: 'Beach Road' }),
    'Beach Road - Vengurla - Maharashtra'
  );
  assert.strictEqual(directionsFor({ latitude: null, longitude: null }), '-');
});

test('the property phone falls back to its WhatsApp number', () => {
  assert.strictEqual(buildStaySample(stay, { ...lodge, phone: null })[6], '9876500000');
  assert.strictEqual(buildStaySample(stay, { ...lodge, phone: null, whatsapp_number: null })[6], '-');
});

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

test('a HOUR_24 property promises dates, not clock times', () => {
  const sample = buildStaySample(stay, { ...lodge, checkin_mode: 'HOUR_24' });
  assert.strictEqual(sample[3], '12 Sep 2026');
  assert.strictEqual(sample[4], '14 Sep 2026 (24 hrs from check-in)');
});

test('a CYCLE property quotes its check-in and check-out times', () => {
  const sample = buildStaySample(stay, { ...lodge, checkin_mode: 'CYCLE', check_in_time: '14:00:00', check_out_time: '11:00:00' });
  assert.strictEqual(sample[3], '12 Sep 2026 2:00 PM');
  assert.strictEqual(sample[4], '14 Sep 2026 11:00 AM');
});

test('instants are said in IST whatever the server clock is', () => {
  assert.strictEqual(formatInstantIST('2026-09-12T18:30:00.000Z'), '13 Sep 2026 12:00 AM');
  assert.strictEqual(formatInstantIST('2026-09-12T06:30:00.000Z'), '12 Sep 2026 12:00 PM');
  assert.strictEqual(formatInstantIST(new Date('2026-01-01T03:35:00.000Z')), '1 Jan 2026 9:05 AM');
});

// ---------------------------------------------------------------------------
// Off unless configured, and never throwing
// ---------------------------------------------------------------------------

test('with no template configured the notifier skips without touching the database', async () => {
  assert.strictEqual(whatsapp.isBookingTemplateConfigured(), false);
  assert.deepStrictEqual(await notifyStayBooked(1, 1), { status: 'skipped', reason: 'not configured' });
  assert.deepStrictEqual(await notifyEventBooked(1, { id: 1 }), { status: 'skipped', reason: 'not configured' });
});

test('sendTemplateMessage refuses a missing template rather than calling the provider', async () => {
  // Whether the token is set or not, an unset template id must be a local
  // error — never a request that spends a message on the provider's account.
  await assert.rejects(whatsapp.sendTemplateMessage('9876543210', '', 'a,b', 'x'), /not configured/);
});

// ---------------------------------------------------------------------------
// Where it fires from
// ---------------------------------------------------------------------------

test('a new stay and a function taking its venue both fire the confirmation, unawaited', () => {
  const bookings = read('src/modules/bookings/bookings.service.js');
  assert.match(bookings, /void notifications\.notifyStayBooked\(lodgeId, bookingId\)/);

  const events = read('src/modules/events/events.service.js');
  // On creation only when the status blocks the venue — an enquiry is not
  // told "confirmed".
  assert.match(events, /if \(blocks\) void notifications\.notifyEventBooked\(lodgeId, event\)/);
  // On a transition only when the venue was not already held — a tentative
  // hold that is then confirmed is not told twice.
  assert.match(events, /BLOCKING\.includes\(to\) && !BLOCKING\.includes\(current\.status\)/);
});

test('.env.example documents the template switch', () => {
  assert.match(read('.env.example'), /^WHATSAPP_BOOKING_TEMPLATE_ID=/m);
});
