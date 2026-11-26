const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pastBookingExtrasSchema, istDateOf } = require('../src/modules/bookings/bookings.schema');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('timestamps without an offset are read as IST and give IST dates', () => {
  const r = pastBookingExtrasSchema.safeParse({ checkedInAt: '2026-11-10T00:30', checkedOutAt: '2026-11-12T11:30' });
  assert.ok(r.success);
  assert.equal(r.data.checkedInAt.toISOString(), '2026-11-09T19:00:00.000Z');
  assert.equal(istDateOf(r.data.checkedInAt), '2026-11-10');
});

test('check-out must be after check-in and not in the future', () => {
  assert.ok(!pastBookingExtrasSchema.safeParse({ checkedInAt: '2026-11-12T10:00', checkedOutAt: '2026-11-12T09:00' }).success);
  assert.ok(!pastBookingExtrasSchema.safeParse({ checkedInAt: '2026-11-10T10:00', checkedOutAt: '2999-01-01T09:00' }).success);
  assert.ok(!pastBookingExtrasSchema.safeParse({ checkedInAt: 'nonsense', checkedOutAt: '2026-11-12T09:00' }).success);
});

test('createPastBooking: switch, clash check, ordinary billing path, compensation', () => {
  const src = read('src/modules/bookings/bookings.service.js');
  const body = src.slice(src.indexOf('async function createPastBooking('), src.indexOf('async function lodgeFlagOn('));
  assert.match(body, /lodgeFlagOn\(pool, lodgeId, 'can_add_past_bookings'\)/);
  assert.match(body, /br\.status = 'CHECKED_OUT'/);
  assert.match(body, /issueInvoice\([\s\S]*settle: \{[\s\S]*invoiceAt:[\s\S]*checkedOutAt: Object\.fromEntries/);
  assert.match(body, /status = 'CANCELLED'/);
  assert.match(body, /skipAdvanceReceipt: true/);
});

test('checkout can be stamped with the recorded departure time', () => {
  const src = read('src/modules/bookings/bookings.service.js');
  assert.match(src, /actual_check_out_at = COALESCE\(@at, SYSDATETIMEOFFSET\(\)\)/);
});

test('schema.sql mirrors the can_add_past_bookings migration', () => {
  assert.match(read('src/config/schema.sql'), /ADD can_add_past_bookings BIT NOT NULL/);
  assert.match(read('migrations/161_lodge_can_add_past_bookings.sql'), /ADD can_add_past_bookings BIT NOT NULL/);
});

const { pastWindowViolation } = require('../src/modules/billing/billing.service');

test('past stays may only end after the last invoiced stay', () => {
  const win = { lastNumber: '34', lastStayEnd: '2026-11-10', minDate: '2026-11-11' };
  assert.equal(pastWindowViolation(win, ['2026-11-11', '2026-11-15']), null);
  assert.match(pastWindowViolation(win, ['2026-11-10']), /#34.*2026-11-11/);
  assert.ok(pastWindowViolation(win, ['2026-11-12', '2026-11-09']));
  // No invoice yet: nothing to be after.
  assert.equal(pastWindowViolation({ lastNumber: null, lastStayEnd: null, minDate: null }, ['2020-01-01']), null);
});

test('createPastBooking checks the gap before writing anything; route sits before /:id', () => {
  const src = read('src/modules/bookings/bookings.service.js');
  const body = src.slice(src.indexOf('async function createPastBooking('));
  assert.ok(body.indexOf('getPastBookingWindow') > -1 && body.indexOf('getPastBookingWindow') < body.indexOf('await createBooking('));
  const routes = read('src/modules/bookings/bookings.routes.js');
  assert.ok(routes.indexOf("'/past-window'") < routes.indexOf("'/:id/edit-window'"));
});
