const test = require('node:test');
const assert = require('node:assert');

const { tabIdentity, tabScope } = require('../src/modules/billing/billing.service');
const { cleanTag, customerKey } = require('../src/modules/orders/customerTag');

// Several customers at one table are billed separately: a table splits into one tab per
// customer tag, '~' alone being the untagged group, and a bare table tab is the whole table.

const fakeRequest = () => {
  const inputs = {};
  return { inputs, input(name, _type, value) { inputs[name] = value; return this; } };
};
const tableRow = (key) => ({ source: 'TABLE', table_id: 7, room_id: null, table_label: 'T7', customer_key: key });

test('tags are compared without case, spacing or edge whitespace', () => {
  assert.strictEqual(customerKey('  Anil   Kumar '), 'anil kumar');
  assert.strictEqual(customerKey('ANIL'), customerKey('anil'));
  assert.strictEqual(customerKey(''), '');
  assert.strictEqual(customerKey(null), '');
  assert.strictEqual(cleanTag('   '), null);
  assert.strictEqual(cleanTag('a  b'), 'a b');
  assert.strictEqual(cleanTag('x'.repeat(80)).length, 60);
});

test('a table is one tab per customer; untagged is "~"; a lone order row stays bare', () => {
  assert.strictEqual(tabIdentity(tableRow('anil')).tab, 'table-7~anil');
  assert.strictEqual(tabIdentity(tableRow('')).tab, 'table-7~');
  assert.strictEqual(tabIdentity(tableRow('a b/c')).tab, 'table-7~a%20b%2Fc');
  assert.strictEqual(tabIdentity({ ...tableRow(undefined), customer_key: undefined }).tab, 'table-7');
});

test('a customer scope filters by that customer only', () => {
  const request = fakeRequest();
  const scope = tabScope(request, 'table-7~anil');
  assert.match(scope, /o\.table_id = @tableId/);
  assert.match(scope, /= @customerKey/);
  assert.strictEqual(request.inputs.customerKey, 'anil');
  assert.strictEqual(request.inputs.tableId, 7);
});

test('the untagged scope matches the empty key, the bare scope matches the whole table', () => {
  const untagged = fakeRequest();
  tabScope(untagged, 'table-7~');
  assert.strictEqual(untagged.inputs.customerKey, '');
  const whole = fakeRequest();
  assert.ok(!tabScope(whole, 'table-7').includes('customerKey'));
});

test('an encoded tab round-trips and normalises', () => {
  const request = fakeRequest();
  tabScope(request, tabIdentity(tableRow('a b/c')).tab);
  assert.strictEqual(request.inputs.customerKey, 'a b/c');
  const r2 = fakeRequest();
  tabScope(r2, 'table-7~%20ANIL%20');
  assert.strictEqual(r2.inputs.customerKey, 'anil');
});

test('only a table tab can carry a customer; bad encodings are a bad request', () => {
  for (const bad of ['room-1~x', 'counter-1~x', 'room-booking-1~x', 'table-7~%E0%A4%A']) {
    assert.throws(() => tabScope(fakeRequest(), bad), /Unknown tab/);
  }
});
