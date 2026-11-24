const test = require('node:test');
const assert = require('node:assert');
const { snapshotOf, diffBookingEdit } = require('../src/modules/bookings/editDiff');

const row = { guest_name: 'Asha', guest_phone: '9000000001', num_guests: 2, num_children: 0, discount_amount: 0, advance_amount: 500, total_price: 3000 };
const rooms = [{ room_number: '101', check_in_date: '2026-11-07', check_out_date: '2026-11-10' }];

test('no change gives an empty list', () => {
  assert.deepEqual(diffBookingEdit(snapshotOf(row, rooms), snapshotOf({ ...row }, rooms.map((r) => ({ ...r })))), []);
});

test('phone, total and dates are reported with from/to', () => {
  const after = snapshotOf(
    { ...row, guest_phone: '9000000002', total_price: 4000 },
    [{ room_number: '101', check_in_date: new Date('2026-11-07'), check_out_date: '2026-11-12' }]
  );
  const d = diffBookingEdit(snapshotOf(row, rooms), after);
  assert.deepEqual(d.map((x) => x.field), ['Phone', 'Total price', 'Rooms & dates']);
  assert.equal(d[2].to, '101: 2026-11-07 → 2026-11-12');
});
