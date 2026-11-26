// Checkout is billed before it is written: scopeBooking decides what a
// checked-in guest is billed for. No database — a fake reads the two queries.
const test = require('node:test');
const assert = require('node:assert/strict');
const { scopeBooking } = require('../src/modules/billing/billing.service');

const fakeDb = ({ rooms, roomPaid = 0, advanceUsed = 0 }) => ({
  request: () => ({
    input() {
      return this;
    },
    async query(text) {
      if (text.includes('room_settlements')) {
        return { recordset: [{ room_paid: roomPaid, advance_used: advanceUsed }] };
      }
      return { recordset: rooms };
    },
  }),
});
const room = (id, status) => ({
  id, room_id: id * 10, room_number: `10${id}`, status, check_in_date: '2026-11-01', check_out_date: '2026-11-03',
  actual_check_in_at: new Date(), nightly_breakdown: null, total_price: 1000 * id,
});
const stay = (over = {}) => ({ id: 1, status: 'CHECKED_IN', advance_amount: 1500, late_checkout_charge: 0, ...over });

test('one of two rooms leaving is billed on its own, with the advance still unspent as credit', async () => {
  const db = fakeDb({ rooms: [room(1, 'CHECKED_IN'), room(2, 'CHECKED_IN')], advanceUsed: 500 });
  const r = await scopeBooking(db, 1, stay(), { settle: true, roomId: 10, lateCharge: 200 });
  assert.equal(r.mode, 'ROOM');
  assert.equal(r.view.total_price, 1000);
  assert.equal(r.view.late_checkout_charge, 200);
  assert.equal(r.advancePaid, 1000); // 1500 advance - 500 already spent on an earlier room
});

test('the last room out is the whole stay: advance + earlier room payments come off', async () => {
  const db = fakeDb({ rooms: [room(1, 'CHECKED_OUT'), room(2, 'CHECKED_IN')], roomPaid: 700 });
  const r = await scopeBooking(db, 1, stay({ late_checkout_charge: 100 }), { settle: true, roomId: 20, lateCharge: 50 });
  assert.equal(r.mode, 'FINAL');
  assert.equal(r.advancePaid, 2200);
  assert.equal(r.view.late_checkout_charge, 150);
  assert.equal(r.view.status, 'CHECKED_OUT');
});

test('a guest who is not checked in cannot be settled, and an unsettled stay cannot be billed', async () => {
  const db = fakeDb({ rooms: [room(1, 'BOOKED')] });
  await assert.rejects(scopeBooking(db, 1, stay({ status: 'BOOKED' }), { settle: true }), /not checked in/);
  await assert.rejects(scopeBooking(db, 1, stay(), null), /must be checked out/);
});

test('check-out all is refused while a room has not arrived', async () => {
  const db = fakeDb({ rooms: [room(1, 'CHECKED_IN'), room(2, 'BOOKED')] });
  await assert.rejects(scopeBooking(db, 1, stay(), { settle: true }), /not checked in yet/);
});
