const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Food is billed separately from the stay, always.
//
// The rule reception asked for: when staff take a food order for a room, that
// food is its own bill and must not appear on the guest's main bill. It used to
// work the other way — a room order placed against a CHECKED_IN booking was
// stamped with that booking_id, which did two things at once:
//
//   1. the stay bill swept it up at checkout, so food showed on the main bill;
//   2. the open-tabs queue filtered `booking_id IS NULL`, so the same order
//      never appeared as a tab and could not be billed on its own.
//
// Both halves had to go. Now the stay bill carries no food at all, and every
// delivered unbilled order — room, table or counter — is an open tab that gets
// its own document.
//
// This is asserted against the source because the behaviour lives in SQL and in
// what the pricing is handed; there is no database in this suite to drive it
// end to end.

const service = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'modules', 'billing', 'billing.service.js'),
  'utf8'
);

// The body of a named function, from its declaration to the next one.
function bodyOf(name) {
  const start = service.search(new RegExp(`(async )?function ${name}\\b`));
  assert.notStrictEqual(start, -1, `${name} should exist`);
  const rest = service.slice(start + 1);
  const next = rest.search(/\n(async )?function \w+/);
  return next === -1 ? rest : rest.slice(0, next);
}

// ---------------------------------------------------------------------------
// The stay bill has no food on it
// ---------------------------------------------------------------------------

// The loader that pulled food onto a folio by booking is gone outright — while
// it exists, it is one call away from putting food back on a main bill.
test('there is no by-booking food loader left to put food on a stay bill', () => {
  assert.ok(
    !/function loadUnbilledOrders\b/.test(service),
    'loadUnbilledOrders should be removed — food never loads onto a stay bill'
  );
});

// This used to assert that nothing selects food orders by booking_id at all
// — booking_id-scoping was how food used to reach the main stay bill. That
// blanket claim stopped being true on purpose: a room is reused by every
// guest who stays in it, and a food *tab* keyed on room_id alone can't tell
// a checked-out guest's unpaid order from the next guest's (see
// foodTabSeparation.test.js, "a room is reused"). tabScope now also scopes a
// room-booking-<id> tab by booking_id — but only inside tabScope/tabIdentity,
// for splitting tabs between stays, never inside the stay-bill loaders this
// file actually guards.
test('nothing outside tabScope/tabIdentity selects food orders by booking_id', () => {
  const outsideTabHelpers = service
    .replace(bodyOf('tabScope'), '')
    .replace(bodyOf('tabIdentity'), '');
  assert.ok(
    !/o\.booking_id = @bookingId/.test(outsideTabHelpers),
    'a query outside tabScope still scopes food orders to a booking, which is how food reached the main bill'
  );
});

// Both the preview and the issue path price a stay with an empty food side, so
// the document the desk sees and the document that gets written agree.
for (const fn of ['previewBill', 'issueInvoice']) {
  test(`${fn} prices the stay with no food orders`, () => {
    const body = bodyOf(fn);
    assert.match(body, /const foodOrders = \[\]/, `${fn} should hand the pricing an empty food list`);
  });
}

test('the stay preview returns an empty food item list rather than omitting it', () => {
  // The screen reads preview.foodItems; it must be a list, not undefined.
  assert.match(bodyOf('previewBill'), /const foodItems = \[\]/);
});

// ---------------------------------------------------------------------------
// Every unbilled order is billable as its own tab
// ---------------------------------------------------------------------------

// This is the half that strands the money if it regresses: with food off the
// stay bill, an order hidden from the tabs queue has no document at all.
test('the open-tabs queue no longer hides orders that belong to a booking', () => {
  const body = bodyOf('listOpenFoodTabs');
  assert.ok(
    !/AND o\.booking_id IS NULL/.test(body),
    'a booked room order must still appear as an open tab — it has no stay bill to ride on'
  );
});

test('loading a tab\'s orders no longer excludes orders that belong to a booking', () => {
  const body = bodyOf('loadUnbilledTabOrders');
  assert.ok(
    !/AND o\.booking_id IS NULL/.test(body),
    'a booked room order must be billable on its room tab'
  );
});

// The gates that must survive: an order is billed once, and only once it has
// actually been handed over.
for (const fn of ['listOpenFoodTabs', 'loadUnbilledTabOrders']) {
  test(`${fn} still bills only delivered, not-yet-billed orders`, () => {
    const body = bodyOf(fn);
    assert.match(body, /o\.status = 'DELIVERED'/, `${fn} should only bill delivered food`);
    assert.match(body, /o\.invoice_id IS NULL/, `${fn} should skip food already on a bill`);
  });

  test(`${fn} is still scoped to one lodge`, () => {
    assert.match(bodyOf(fn), /o\.lodge_id = @lodgeId/);
  });
}

// A room tab and a counter tab stay distinct — separating food from the stay
// bill must not merge one payer's food into another's.
test('a room tab is still keyed on the room, not swept in with the counter', () => {
  const { tabIdentity } = require('../src/modules/billing/billing.service');
  const room = tabIdentity({ source: 'ROOM', room_id: 12, room_number: '203', table_id: null });
  const counter = tabIdentity({ source: 'COUNTER', room_id: null, table_id: null, order_id: 41, order_number: 7 });
  assert.strictEqual(room.tab, 'room-12');
  assert.strictEqual(counter.tab, 'counter-41');
  assert.notStrictEqual(room.tab, counter.tab);
});

// Row 18: a takeaway is a real, billable tab like any other — but one order
// wide, since the next walk-in is a different customer paying separately.
test('each takeaway is a billable tab with its own label', () => {
  const { tabIdentity, tabScope } = require('../src/modules/billing/billing.service');
  assert.strictEqual(tabIdentity({ source: 'COUNTER', order_id: 41, order_number: 7 }).tableLabel, 'Takeaway #7');

  const scope = tabScope({ input() { return this; } }, 'counter-41');
  assert.match(scope, /o\.source = 'COUNTER'/);
  assert.match(scope, /o\.id = @orderId/);
});
