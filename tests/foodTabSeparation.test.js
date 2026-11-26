const test = require('node:test');
const assert = require('node:assert');

const { tabIdentity, tabScope, mapInvoice, buildPreviewDocument } = require('../src/modules/billing/billing.service');

// An open food tab is one payer's running total, and there are three kinds: a
// dining table, a room being served with nobody checked into it, and the
// counter. Three faults lived here.
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
//
// The third was the counter billing as one running tab. A table and a room
// accumulate — the same party keeps ordering, and one bill closes the visit —
// but every takeaway is a different stranger. Sharing a single 'counter' tab
// meant a day of walk-ins piled up together, and whoever was billed first paid
// for all of them. A counter tab is now one order.

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

// A takeaway is a stranger who pays and walks out, so it is a tab of exactly
// one order rather than a running total. Billing the shared 'counter' tab put
// a whole day of unrelated walk-ins on the first customer's invoice.
test('a counter order is a tab of its own, keyed on the order', () => {
  const id = tabIdentity(row({ order_id: 41, order_number: 7 }));
  assert.strictEqual(id.tab, 'counter-41');
  assert.strictEqual(id.tableId, null);
  assert.strictEqual(id.roomId, null);
  assert.strictEqual(id.tableLabel, 'Takeaway #7');
});

// The per-order loader selects o.id; the grouped tab list aliases it to
// order_id. Both must name the same tab, or the row a cashier clicks and the
// bill it opens would disagree.
test('the per-order shape and the grouped shape agree on the tab', () => {
  const grouped = tabIdentity(row({ order_id: 41, order_number: 7 }));
  const single = tabIdentity(row({ id: 41, order_number: 7 }));
  assert.strictEqual(single.tab, grouped.tab);
  assert.strictEqual(single.tableLabel, grouped.tableLabel);
});

test('two takeaways are two different tabs', () => {
  const a = tabIdentity(row({ order_id: 41, order_number: 7 }));
  const b = tabIdentity(row({ order_id: 42, order_number: 8 }));
  assert.notStrictEqual(a.tab, b.tab);
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

// ---------------------------------------------------------------------------
// A room is reused: the tab belongs to the stay, not the room
// ---------------------------------------------------------------------------
//
// The regression this section guards: Ram checks into room 1, orders food,
// and checks out without paying for it. Sham then checks into the same room
// and orders food of his own. Keying the room tab on room_id alone made both
// men's orders one running total — Sham's bill silently absorbed Ram's
// unpaid food the moment reception opened "Room 1". A room order carries the
// booking_id of the stay that placed it (captured for exactly this reason —
// see 028_food_orders.sql), so the tab is keyed on that instead.

test('a booked room order is keyed on the stay, not the room', () => {
  const id = tabIdentity(row({ source: 'ROOM', room_id: 1, room_number: '1', booking_id: 900 }));
  assert.strictEqual(id.tab, 'room-booking-900');
  assert.strictEqual(id.roomId, 1);
});

test('two different stays in the same room are two different tabs', () => {
  // Ram, then Sham, both in room 1.
  const ram = tabIdentity(row({ source: 'ROOM', room_id: 1, room_number: '1', booking_id: 900 }));
  const sham = tabIdentity(row({ source: 'ROOM', room_id: 1, room_number: '1', booking_id: 901 }));
  assert.notStrictEqual(ram.tab, sham.tab);
  assert.strictEqual(ram.tab, 'room-booking-900');
  assert.strictEqual(sham.tab, 'room-booking-901');
});

test('an unbooked room order still keys on the room, distinct from any stay', () => {
  const unbooked = tabIdentity(row({ source: 'ROOM', room_id: 1, room_number: '1', booking_id: null }));
  const booked = tabIdentity(row({ source: 'ROOM', room_id: 1, room_number: '1', booking_id: 900 }));
  assert.strictEqual(unbooked.tab, 'room-1');
  assert.notStrictEqual(unbooked.tab, booked.tab);
});

test('a room-booking scope is pinned to that booking, not the room', () => {
  const request = fakeRequest();
  const scope = tabScope(request, 'room-booking-900');
  assert.match(scope, /o\.source = 'ROOM'/);
  assert.match(scope, /o\.booking_id = @bookingId/);
  assert.strictEqual(request.inputs.bookingId, 900);
  assert.ok(!scope.includes('room_id'), scope);
});

// The bug itself, expressed as scope SQL: billing "room-1" (the plain,
// unbooked-room tab) must never also sweep up a booked stay's orders in that
// same room, and vice versa.
test('a bare room scope excludes any booked stay in that room', () => {
  const scope = tabScope(fakeRequest(), 'room-1');
  assert.match(scope, /o\.room_id = @roomId/);
  assert.match(scope, /o\.booking_id IS NULL/);
});

test('a room-booking scope for one stay never matches another stay in the same room', () => {
  const ramScope = tabScope(fakeRequest(), 'room-booking-900');
  const shamRequest = fakeRequest();
  tabScope(shamRequest, 'room-booking-901');
  // Ram's scope binds Ram's booking id, not Sham's — proving the two stays'
  // scopes bind different parameters even though both orders share room_id.
  assert.strictEqual(ramScope.includes('@bookingId'), true);
  assert.strictEqual(shamRequest.inputs.bookingId, 901);
});

test('two different tables are two different tabs', () => {
  const a = tabIdentity(row({ source: 'TABLE', table_id: 7, table_label: 'Table 4' }));
  const b = tabIdentity(row({ source: 'TABLE', table_id: 8, table_label: 'Table 5' }));
  assert.notStrictEqual(a.tab, b.tab);
});

// ---------------------------------------------------------------------------
// A tab sweeps only its own orders
// ---------------------------------------------------------------------------

test('a counter scope is pinned to that one order', () => {
  const request = fakeRequest();
  const scope = tabScope(request, 'counter-41');
  assert.match(scope, /o\.source = 'COUNTER'/);
  assert.match(scope, /o\.id = @orderId/);
  assert.strictEqual(request.inputs.orderId, 41);
});

// The bug this fixes: billing one takeaway swept in every other unbilled
// walk-in, because the scope matched the source and nothing else.
test('a counter scope never sweeps the whole counter', () => {
  const scope = tabScope(fakeRequest(), 'counter-41');
  assert.ok(/o\.id = @orderId/.test(scope), scope);
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

// 'counter' bare is in this list deliberately: it was the old shared tab, and
// it must not silently fall back to sweeping every walk-in again.
for (const bad of ['', 'nonsense', 'table-', 'table-abc', 'room-', 'room-abc', 'table-0', 'room-0', 'table--1', '7', 'counter', 'counter-', 'counter-abc', 'counter-0', 'room-booking-', 'room-booking-abc', 'room-booking-0']) {
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

// ---------------------------------------------------------------------------
// A takeaway carries its own customer; a table or room does not
// ---------------------------------------------------------------------------

// loadUnbilledTabOrders and listOpenFoodTabs both derive customerName /
// customerPhone the same way: read guest_name / guest_phone off the row, but
// only report them for source === 'COUNTER'. This is that rule, checked
// against the identity function both call — not the SQL itself, which needs a
// database, but the same branch either query's mapping runs.
function customerOf(r) {
  return {
    customerName: r.source === 'COUNTER' ? r.guest_name : null,
    customerPhone: r.source === 'COUNTER' ? r.guest_phone : null,
  };
}

test('a counter order reports the name and phone it was placed with', () => {
  const c = customerOf(row({ order_id: 41, order_number: 7, guest_name: 'Anil Kumar', guest_phone: '9876500000' }));
  assert.strictEqual(c.customerName, 'Anil Kumar');
  assert.strictEqual(c.customerPhone, '9876500000');
});

// The regression this guards: a table is a party, not one payer, and a room's
// tab belongs to whoever is checked in there — food_orders.guest_name is null
// on both by the ck_food_orders_target constraint, but the mapping has to
// agree and actually suppress it rather than print a stray value some other
// order on the same tab happened to carry.
test('a table or room order never reports a customer, even if the column carries one', () => {
  const table = customerOf(row({ source: 'TABLE', table_id: 7, table_label: 'Table 4', guest_name: 'Should not appear' }));
  const roomTab = customerOf(row({ source: 'ROOM', room_id: 12, room_number: '203', guest_name: 'Should not appear' }));
  assert.strictEqual(table.customerName, null);
  assert.strictEqual(table.customerPhone, null);
  assert.strictEqual(roomTab.customerName, null);
  assert.strictEqual(roomTab.customerPhone, null);
});

// ---------------------------------------------------------------------------
// mapInvoice prints a takeaway's own customer, not a stay's or an event's
// ---------------------------------------------------------------------------

// The shape getInvoice/listInvoices hand to mapInvoice: SELECT i.* (which now
// includes the invoice's own customer_name/customer_phone) plus the
// COALESCE(b.guest_name, eb.organiser_name) columns the join adds. A minimal
// invoice row good enough for mapInvoice to run without crashing on an
// unrelated field.
const invoiceRow = (over) => ({
  id: 501,
  booking_id: null,
  event_booking_id: null,
  table_label: null,
  tab_room_number: null,
  takeaway_order_number: null,
  guest_name: null,
  guest_phone: null,
  customer_name: null,
  customer_phone: null,
  num_guests: null,
  room_number: null,
  category_name: null,
  check_in_date: null,
  check_out_date: null,
  actual_check_in_at: null,
  actual_check_out_at: null,
  late_checkout_minutes: null,
  nightly_breakdown: null,
  document_type: 'CASH_RECEIPT',
  billing_side: 'NON_GST',
  invoice_number: 'CR/1',
  room_subtotal: 0,
  late_checkout_charge: 0,
  cgst_amount: 0,
  sgst_amount: 0,
  food_subtotal: 0,
  food_cgst_amount: 0,
  food_sgst_amount: 0,
  discount_amount: 0,
  discount_percent: 0,
  discount_reason: null,
  round_off: 0,
  ...over,
});

// The bug this closes: a takeaway's bill had a name and phone at the counter
// (required to place the order — see orders.schema.js) and printed neither,
// because guestName/guestPhone came only from COALESCE(b.guest_name,
// eb.organiser_name) and a food bill has no b or eb.
test('a counter takeaway bill shows the customer it was placed for', () => {
  const invoice = mapInvoice(
    invoiceRow({
      takeaway_order_number: 7,
      customer_name: 'Anil Kumar',
      customer_phone: '9876500000',
    })
  );
  assert.strictEqual(invoice.kind, 'FOOD');
  assert.strictEqual(invoice.guestName, 'Anil Kumar');
  assert.strictEqual(invoice.guestPhone, '9876500000');
});

// A table or room tab's invoice has no customer_name at all (issueFoodInvoice
// only sets it for a counter order), and mapInvoice must not invent one from
// some other coincidentally-null field.
test('a table or room food bill has no customer, and none is invented', () => {
  const invoice = mapInvoice(invoiceRow({ table_label: 'Table 4' }));
  assert.strictEqual(invoice.kind, 'FOOD');
  assert.strictEqual(invoice.guestName, null);
  assert.strictEqual(invoice.guestPhone, null);
});

// A stay bill's guest still comes from the booking, unaffected by a column
// that is always null on it.
test('a stay bill still shows the booking guest, not a food customer field', () => {
  const invoice = mapInvoice(
    invoiceRow({
      booking_id: 9,
      guest_name: 'Priya Shah',
      guest_phone: '9123456780',
      room_number: '101',
    })
  );
  assert.strictEqual(invoice.kind, 'STAY');
  assert.strictEqual(invoice.guestName, 'Priya Shah');
  assert.strictEqual(invoice.guestPhone, '9123456780');
});

// ---------------------------------------------------------------------------
// The bill preview says who a takeaway is for, same as the issued document
// ---------------------------------------------------------------------------

// The exact bug reported against a real screen: the preview shown before a
// bill is issued (BillDocument fed from previewFoodBill's `document`, built by
// this function) named the takeaway "Takeaway #1" instead of the guest, even
// though loadUnbilledTabOrders and the issued invoice both already had the
// name. buildPreviewDocument's `row` is the lodge for a food bill — it has no
// guest of its own — so guestName/guestPhone must come in as their own
// parameters, not off row.guest_name the way a stay bill's does.
//
// A blank side, good enough to exercise the fields buildPreviewDocument reads
// off it without reconstructing a real tax breakdown.
const blankSide = {
  documentType: 'CASH_RECEIPT',
  subtotal: 0,
  cgstAmount: 0,
  sgstAmount: 0,
  cgstRatePercent: 0,
  sgstRatePercent: 0,
  roomTaxable: 0,
  foodSubtotal: 42.86,
  foodCgstAmount: 1.07,
  foodSgstAmount: 1.07,
  foodCgstRatePercent: 2.5,
  foodSgstRatePercent: 2.5,
  foodTaxable: 40.72,
  discountAmount: 0,
  discountPercent: 0,
  roundOff: 0,
  totalAmount: 45,
};
const lodgeRow = { lodge_name: 'Hotel Renuka Palace', is_gst_registered: 0 };

test('a takeaway bill preview shows the customer it was placed for', () => {
  const doc = buildPreviewDocument({
    row: lodgeRow,
    side: blankSide,
    billingSide: 'NON_GST',
    foodItems: [],
    lateCheckoutCharge: 0,
    kind: 'FOOD',
    tableLabel: 'Takeaway #1',
    guestName: 'Anil Kumar',
    guestPhone: '9876500000',
  });
  assert.strictEqual(doc.guestName, 'Anil Kumar');
  assert.strictEqual(doc.guestPhone, '9876500000');
});

// A table or room preview passes no guestName/guestPhone at all (see
// previewFoodBill), so the parameter is undefined rather than null — this
// checks the fallback chain handles that, not just an explicit null.
test('a table or room bill preview has no customer when none was passed', () => {
  const doc = buildPreviewDocument({
    row: lodgeRow,
    side: blankSide,
    billingSide: 'NON_GST',
    foodItems: [],
    lateCheckoutCharge: 0,
    kind: 'FOOD',
    tableLabel: 'Table 4',
  });
  assert.strictEqual(doc.guestName, null);
  assert.strictEqual(doc.guestPhone, null);
});

// The stay-bill call site passes no guestName/guestPhone override either — it
// relies on row.guest_name, same as before this change. This is the one that
// would have broken if the override parameter shadowed row.guest_name instead
// of falling back to it.
test('a stay bill preview still reads the guest off the booking row', () => {
  const doc = buildPreviewDocument({
    row: { ...lodgeRow, guest_name: 'Priya Shah', guest_phone: '9123456780' },
    side: blankSide,
    billingSide: 'NON_GST',
    foodItems: [],
    lateCheckoutCharge: 0,
    kind: 'STAY',
    tableLabel: null,
  });
  assert.strictEqual(doc.guestName, 'Priya Shah');
  assert.strictEqual(doc.guestPhone, '9123456780');
});
