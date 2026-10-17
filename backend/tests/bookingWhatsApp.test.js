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
  buildPerRoomSample,
  sameDatesAcrossRooms,
  directionsFor,
  clean,
  notifyStayBooked,
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
  room_numbers: '204',
  advance_amount: 2000,
  total_price: 5000,
};

// ---------------------------------------------------------------------------
// The ten variables, in template order
// ---------------------------------------------------------------------------

test('a stay fills the ten template variables in order', () => {
  const sample = buildStaySample(stay, lodge);
  assert.deepStrictEqual(sample, [
    'Rahul Patil',
    'Sea View Lodge',
    '204',
    '12 Sep 2026 12:00 PM',
    '14 Sep 2026 10:30 AM',
    '2000.00',
    '5000.00',
    '3000.00',
    'https://www.google.com/maps/search/?api=1&query=15.861%2C73.632',
    '02366-123456',
  ]);
});

test('a multi-room booking sends every room, not just the first', () => {
  const sample = buildStaySample({ ...stay, room_numbers: '204, 205' }, lodge);
  // The comma joining the rooms becomes " - ": clean() always turns a real
  // comma into that, since a comma is the variable separator in the sample
  // string sent to the provider.
  assert.strictEqual(sample[2], '204 - 205');
});

test('no value ever carries a comma — it is the variable separator', () => {
  // An address with commas is the ordinary case, and a comma in {{6}} would
  // put the town into the phone slot.
  const noPin = { ...lodge, latitude: null, longitude: null, phone: null, name: 'Hotel Sai, Vengurla' };
  for (const value of buildStaySample(stay, noPin)) {
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
  assert.strictEqual(buildStaySample(stay, { ...lodge, phone: null })[9], '9876500000');
  assert.strictEqual(buildStaySample(stay, { ...lodge, phone: null, whatsapp_number: null })[9], '-');
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

// ---------------------------------------------------------------------------
// Off unless configured, and never throwing
// ---------------------------------------------------------------------------

test('with no template configured the notifier skips without touching the database', async () => {
  assert.strictEqual(whatsapp.isBookingTemplateConfigured(), false);
  assert.deepStrictEqual(await notifyStayBooked(1, 1), { status: 'skipped', reason: 'not configured' });
});

test('sendTemplateMessage refuses a missing template rather than calling the provider', async () => {
  // Whether the token is set or not, an unset template id must be a local
  // error — never a request that spends a message on the provider's account.
  await assert.rejects(whatsapp.sendTemplateMessage('9876543210', '', 'a,b', 'x'), /not configured/);
});

// ---------------------------------------------------------------------------
// Where it fires from
// ---------------------------------------------------------------------------

test('a new stay fires the confirmation, unawaited', () => {
  const bookings = read('src/modules/bookings/bookings.service.js');
  assert.match(bookings, /void notifications\.notifyStayBooked\(lodgeId, bookingId\)/);
});

test('.env.example documents the template switch', () => {
  assert.match(read('.env.example'), /^WHATSAPP_BOOKING_TEMPLATE_ID=/m);
});

// ---------------------------------------------------------------------------
// Money — balance due is computed, not typed in anywhere
// ---------------------------------------------------------------------------

test('balance due is total minus advance, formatted as plain digits with no currency mark', () => {
  const sample = buildStaySample({ ...stay, advance_amount: 1234.5, total_price: 9000 }, lodge);
  assert.strictEqual(sample[5], '1234.50');
  assert.strictEqual(sample[6], '9000.00');
  assert.strictEqual(sample[7], '7765.50');
});

test('a booking with no advance on file reads as zero, not a blank or a dash', () => {
  const sample = buildStaySample({ ...stay, advance_amount: null }, lodge);
  assert.strictEqual(sample[5], '0.00');
  assert.strictEqual(sample[7], sample[6]); // balance due equals the full total
});

test('loadBooking reads room_numbers/advance_amount/total_price, not the raw column names', () => {
  const src = read('src/modules/notifications/bookingConfirmation.js');
  assert.match(src, /booking\.room_numbers/);
  assert.match(src, /booking\.advance_amount/);
  assert.match(src, /booking\.total_price/);
});

// ---------------------------------------------------------------------------
// Rooms on different date ranges — one message per room instead of one
// shared {{4}}/{{5}} pair that couldn't honestly speak for all of them
// ---------------------------------------------------------------------------

const roomA = { room_number: '204', check_in_date: '2026-09-12', check_out_date: '2026-09-14', total_price: 3000 };
const roomB = { room_number: '205', check_in_date: '2026-09-13', check_out_date: '2026-09-15', total_price: 2000 };

test('sameDatesAcrossRooms is true for one room, or for several sharing a range', () => {
  assert.strictEqual(sameDatesAcrossRooms([roomA]), true);
  assert.strictEqual(sameDatesAcrossRooms([roomA, { ...roomA, room_number: '206' }]), true);
});

test('sameDatesAcrossRooms is false the moment one room disagrees, on either end', () => {
  assert.strictEqual(sameDatesAcrossRooms([roomA, roomB]), false);
  assert.strictEqual(sameDatesAcrossRooms([roomA, { ...roomA, room_number: '206', check_out_date: '2026-09-15' }]), false);
});

test('sameDatesAcrossRooms compares calendar days, not Date-vs-string shape', () => {
  const asDate = { ...roomA, check_in_date: new Date('2026-09-12T00:00:00Z'), check_out_date: new Date('2026-09-14T00:00:00Z') };
  assert.strictEqual(sameDatesAcrossRooms([roomA, asDate]), true);
});

test('buildPerRoomSample names just that room and its own dates', () => {
  const sample = buildPerRoomSample(roomA, { guest_name: 'Rahul Patil', advance_amount: 1000, total_price: 5000 }, lodge, 2);
  assert.strictEqual(sample[0], 'Rahul Patil');
  assert.strictEqual(sample[2], '204');
  assert.strictEqual(sample[3], '12 Sep 2026 12:00 PM');
  assert.strictEqual(sample[4], '14 Sep 2026 10:30 AM');
});

test('buildPerRoomSample splits the one advance payment in proportion to each room\'s own price', () => {
  // roomA is 3000 of a 5000 total (60%), roomB is 2000 (40%) — a 1000 advance
  // splits 600/400, and each room's own total_price is reported whole.
  const booking = { guest_name: 'Rahul Patil', advance_amount: 1000, total_price: 5000 };
  const sampleA = buildPerRoomSample(roomA, booking, lodge, 2);
  const sampleB = buildPerRoomSample(roomB, booking, lodge, 2);
  assert.strictEqual(sampleA[5], '600.00'); // advance paid
  assert.strictEqual(sampleA[6], '3000.00'); // total
  assert.strictEqual(sampleA[7], '2400.00'); // balance due
  assert.strictEqual(sampleB[5], '400.00');
  assert.strictEqual(sampleB[6], '2000.00');
  assert.strictEqual(sampleB[7], '1600.00');
  // The two rooms' advance shares add back up to the one real payment —
  // nothing invented, nothing dropped.
  assert.strictEqual(Number(sampleA[5]) + Number(sampleB[5]), 1000);
});

test('buildPerRoomSample splits evenly rather than dividing by zero when the booking has no price yet', () => {
  const booking = { guest_name: 'Rahul Patil', advance_amount: 1000, total_price: 0 };
  const sample = buildPerRoomSample({ ...roomA, total_price: 0 }, booking, lodge, 2);
  assert.strictEqual(sample[5], '500.00');
});

test('notifyStayBooked sends one message per room when the rooms disagree on dates, one message otherwise', () => {
  const src = read('src/modules/notifications/bookingConfirmation.js');
  const fn = src.slice(src.indexOf('async function notifyStayBooked('));
  assert.match(fn, /if \(sameDatesAcrossRooms\(rooms\)\)/);
  assert.match(fn, /buildPerRoomSample\(room, booking, lodge, rooms\.length\)/);
});
