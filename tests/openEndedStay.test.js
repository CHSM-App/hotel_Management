const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// An open-ended stay is a booking with no check-out date. It holds its room
// until the guest is checked out, so the things that must never regress are:
// the schema accepts it, every availability query reads NULL as "far future"
// (otherwise the room could be double-booked), and no layer does date maths on
// the missing date.
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const { createBookingSchema } = require('../src/modules/bookings/bookings.schema');
const { normalizeRoomInputs, bookingFiguresFromRooms } = require('../src/modules/bookings/bookings.service');

const base = {
  roomId: 1,
  checkInDate: '2026-11-25',
  guestName: 'A Guest',
  guestPhone: '9876543210',
  numGuests: 1,
};

test('a booking can be created without a check-out date', () => {
  assert.ok(createBookingSchema.safeParse(base).success);
  // A form field arrives as an empty string rather than missing.
  assert.ok(createBookingSchema.safeParse({ ...base, checkOutDate: '' }).success);
});

test('a check-out date that is given must still be after check-in', () => {
  assert.ok(!createBookingSchema.safeParse({ ...base, checkOutDate: '2026-11-25' }).success);
  assert.ok(createBookingSchema.safeParse({ ...base, checkOutDate: '2026-11-26' }).success);
});

test('an open room is marked open and keeps no end date', () => {
  const [room] = normalizeRoomInputs(base);
  assert.strictEqual(room.checkOutDate, null);
  assert.strictEqual(room.open, true);
  const [dated] = normalizeRoomInputs({ ...base, checkOutDate: '2026-11-27' });
  assert.strictEqual(dated.open, false);
});

test('a room with an end on or before check-in is still refused', () => {
  assert.throws(() => normalizeRoomInputs({ ...base, checkOutDate: '2026-11-24' }), /after check-in/);
});

test('every availability query reads a missing check-out as far in the future', () => {
  // `check_out_date > X` is UNKNOWN for NULL, so an open stay would block
  // nothing and its room could be sold a second time.
  const files = [
    'src/modules/bookings/bookings.service.js',
    'src/modules/bookings/drafts.service.js',
    'src/modules/public/public.service.js',
    'src/modules/rooms/rooms.service.js',
    'src/modules/reports/reports.service.js',
    'src/modules/lodges/lodges.service.js',
  ];
  for (const file of files) {
    const bare = read(file).match(/\b\w*\.?check_out_date\s*>\s*@/g) || [];
    assert.deepStrictEqual(bare, [], `${file} compares check_out_date to a parameter without COALESCE`);
  }
});

test('overlap checks pass a missing end as the far-future date', () => {
  const src = read('src/modules/bookings/bookings.service.js');
  assert.match(src, /const OPEN_END = '9999-12-31'/);
  assert.ok((src.match(/endOrOpen\(checkOutDate\)/g) || []).length >= 5, 'a date-range input skips endOrOpen');
});

test('the booking is open while any of its rooms is open', () => {
  const rows = [
    { room_number: '1', check_in_date: '2026-11-25', check_out_date: '2026-11-27', total_price: 2000, nightly_breakdown: null },
    { room_number: '2', check_in_date: '2026-11-25', check_out_date: null, total_price: 0, nightly_breakdown: null },
  ];
  assert.strictEqual(bookingFiguresFromRooms(rows).check_out_date, null);
  rows[1].check_out_date = '2026-11-28';
  rows[1].total_price = 3000;
  const closed = bookingFiguresFromRooms(rows);
  assert.strictEqual(closed.check_out_date, '2026-11-28');
  assert.strictEqual(closed.total_price, 5000);
});

test('the migration and schema.sql both make check_out_date nullable', () => {
  assert.match(read('migrations/177_open_ended_stays.sql'), /ALTER COLUMN check_out_date DATE NULL/);
  const schema = read('src/config/schema.sql');
  assert.match(schema, /check_out_date\s+DATE NULL,\s+-- NULL = open-ended stay/);
  assert.ok(!/check_out_date\s+DATE NOT NULL/.test(schema.slice(schema.indexOf('CREATE TABLE dbo.bookings'), schema.indexOf('CREATE TABLE dbo.bookings') + 1500)));
});

test('checking out an open stay dates and prices it in the same transaction', () => {
  const src = read('src/modules/bookings/bookings.service.js');
  const apply = src.slice(src.indexOf('async function applyCheckOut('));
  assert.match(apply, /late\.openStay/, 'applyCheckOut no longer settles an open stay');
  assert.match(apply, /check_out_date IS NULL/, 'the settle must only touch a still-open room');
});
