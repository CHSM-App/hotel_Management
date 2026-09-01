const test = require('node:test');
const assert = require('node:assert');

const { tabIdentity, tabScope } = require('../src/modules/billing/billing.service');

// An open food tab is one payer's running total, and there are three kinds: a
// dining table, a room being served with nobody checked into it, and the
// counter. Two faults lived here.
//
// The first put unrelated customers on one bill. Tabs were grouped by table_id
// alone, and a room order has a null table_id exactly as a counter order does —
// so room service with no booking behind it was swept into the counter tab, and
// a room's food was billed on the same document as a walk-in's. `source` is the
// discriminator, and the check constraint on food_orders guarantees it.
//
// The second was the 500. The :tab segment was parsed with Number(), so
// anything that wasn't a number reached the driver as NaN bound to a BigInt and
// came back as a server fault rather than a bad request.

// The shape listOpenFoodTabs and loadUnbilledTabOrders both select.
const row = (over) => ({
  source: 'COUNTER',
  table_id: null,
  room_id: null,
  table_label: null,
  room_number: null,
  ...over,
});

// A stand-in for the mssql Request: records what got bound, so a test can prove
// the scope binds the id it claims to.
const fakeRequest = () => {
  const inputs = {};
  return { inputs, input(name, _type, value) { inputs[name] = value; return this; } };
};

// ---------------------------------------------------------------------------
// One payer, one tab
// ---------------------------------------------------------------------------

test('a table order is its own tab, keyed on the table', () => {
  const id = tabIdentity(row({ source: 'TABLE', table_id: 7, table_label: 'Table 4' }));
  assert.strictEqual(id.tab, 'table-7');
  assert.strictEqual(id.tableId, 7);
  assert.strictEqual(id.roomId, null);
  assert.strictEqual(id.tableLabel, 'Table 4');
});

test('an unbooked room order is its own tab, keyed on the room', () => {
  const id = tabIdentity(row({ source: 'ROOM', room_id: 12, room_number: '203' }));
  assert.strictEqual(id.tab, 'room-12');
  assert.strictEqual(id.roomId, 12);
  assert.strictEqual(id.tableId, null);
  assert.strictEqual(id.tableLabel, 'Room 203');
});

test('a counter order is the counter tab', () => {
  const id = tabIdentity(row());
  assert.strictEqual(id.tab, 'counter');
  assert.strictEqual(id.tableId, null);
  assert.strictEqual(id.roomId, null);
  assert.strictEqual(id.tableLabel, 'Counter / takeaway');
});

// The regression itself: a room order and a counter order both carry a null
// table_id, so grouping on that alone collapsed them into one bill.
test('room service and the counter are separate tabs despite both having no table', () => {
  const room = tabIdentity(row({ source: 'ROOM', room_id: 12, room_number: '203' }));
  const counter = tabIdentity(row());

  assert.strictEqual(room.table_id ?? null, null);
  assert.strictEqual(counter.tableId, null);
  assert.notStrictEqual(room.tab, counter.tab);
});

test('two different rooms are two different tabs', () => {
  const a = tabIdentity(row({ source: 'ROOM', room_id: 12, room_number: '203' }));
  const b = tabIdentity(row({ source: 'ROOM', room_id: 13, room_number: '204' }));
  assert.notStrictEqual(a.tab, b.tab);
});

test('two different tables are two different tabs', () => {
  const a = tabIdentity(row({ source: 'TABLE', table_id: 7, table_label: 'Table 4' }));
  const b = tabIdentity(row({ source: 'TABLE', table_id: 8, table_label: 'Table 5' }));
  assert.notStrictEqual(a.tab, b.tab);
});

// ---------------------------------------------------------------------------
// A tab sweeps only its own orders
// ---------------------------------------------------------------------------

test('the counter scope takes counter orders only, and binds nothing', () => {
  const request = fakeRequest();
  const scope = tabScope(request, 'counter');
  assert.match(scope, /o\.source = 'COUNTER'/);
  assert.deepStrictEqual(request.inputs, {});
});

test('a table scope is pinned to that table id', () => {
  const request = fakeRequest();
  const scope = tabScope(request, 'table-7');
  assert.match(scope, /o\.source = 'TABLE'/);
  assert.match(scope, /o\.table_id = @tableId/);
  assert.strictEqual(request.inputs.tableId, 7);
});

test('a room scope is pinned to that room id', () => {
  const request = fakeRequest();
  const scope = tabScope(request, 'room-12');
  assert.match(scope, /o\.source = 'ROOM'/);
  assert.match(scope, /o\.room_id = @roomId/);
  assert.strictEqual(request.inputs.roomId, 12);
});

// A room tab must not select by table_id at all — that is the join that mixed
// the bills together.
test('a room scope never matches on table_id', () => {
  const scope = tabScope(fakeRequest(), 'room-12');
  assert.ok(!scope.includes('table_id'), scope);
});

// ---------------------------------------------------------------------------
// A bad segment is a bad request, not a 500
// ---------------------------------------------------------------------------

for (const bad of ['', 'nonsense', 'table-', 'table-abc', 'room-', 'room-abc', 'table-0', 'room-0', 'table--1', '7', 'counter-1']) {
  test(`"${bad}" is rejected as a bad request rather than reaching the driver`, () => {
    assert.throws(
      () => tabScope(fakeRequest(), bad),
      (err) => err.statusCode === 400 || err.status === 400,
      `expected a 400 for ${JSON.stringify(bad)}`
    );
  });
}

test('a missing segment is rejected rather than binding undefined', () => {
  assert.throws(() => tabScope(fakeRequest(), undefined), (err) => err.statusCode === 400 || err.status === 400);
  assert.throws(() => tabScope(fakeRequest(), null), (err) => err.statusCode === 400 || err.status === 400);
});

// The specific shape that produced the 500: Number('abc') is NaN, and a NaN
// bound as a BigInt is what the driver threw on.
test('a non-numeric id never becomes a bound NaN', () => {
  const request = fakeRequest();
  assert.throws(() => tabScope(request, 'table-abc'));
  assert.deepStrictEqual(request.inputs, {});
});
