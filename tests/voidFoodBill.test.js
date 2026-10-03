const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// A voided food bill (a dedicated table/counter/room-tab bill, with no
// booking and no event behind it) must stay voided for good: its orders
// should show up in the Bills tab tagged Void, never back in "Foods to
// bill", and never counted in reports (which already filter i.status =
// 'ISSUED' — untouched by this change).
//
// Voiding used to always clear food_orders.invoice_id, which is right for
// room service riding on a STAY/EVENT bill (that food has no other document
// to be billed on, so it must return to the open-tabs queue) but wrong for a
// dedicated food bill: clearing invoice_id there is exactly what put the
// voided order back in "Foods to bill" while the bill itself, no longer
// backed by fo.invoice_id = i.id, rendered empty.
//
// Asserted against the source, same as foodBillSeparation.test.js: there is
// no database in this suite to drive voidInvoice end to end.

const service = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'modules', 'billing', 'billing.service.js'),
  'utf8'
);

function bodyOf(name) {
  const start = service.search(new RegExp(`(async )?function ${name}\\b`));
  assert.notStrictEqual(start, -1, `${name} should exist`);
  const rest = service.slice(start + 1);
  const next = rest.search(/\n(async )?function \w+/);
  return next === -1 ? rest : rest.slice(0, next);
}

test('voidInvoice tells a food bill apart from a stay/event bill before deciding what to do with its orders', () => {
  const body = bodyOf('voidInvoice');
  assert.match(body, /isFoodBill/, 'voidInvoice should branch on whether the voided invoice is a dedicated food bill');
  assert.match(body, /bookingId == null && eventBookingId == null/);
});

test('a dedicated food bill keeps its orders linked to the voided invoice', () => {
  const body = bodyOf('voidInvoice');
  assert.match(
    body,
    /if \(isFoodBill\) \{[\s\S]*?UPDATE dbo\.food_orders SET voided_invoice_id = @invoiceId WHERE invoice_id = @invoiceId/,
    'a food bill\'s orders must not have invoice_id cleared — clearing it is what put voided food back in "Foods to bill"'
  );
});

test('a stay/event bill still releases its room-service orders back to unbilled', () => {
  const body = bodyOf('voidInvoice');
  assert.match(
    body,
    /\} else \{[\s\S]*?UPDATE dbo\.food_orders SET invoice_id = NULL, voided_invoice_id = @invoiceId WHERE invoice_id = @invoiceId/,
    'room service on a voided stay/event bill must still return to the open-tabs queue — it has no other document to be billed on'
  );
});

// The display fix: a voided food bill's own row (guest/order-number lookup,
// and its line items) must still resolve even though invoice_id no longer
// points anywhere new — for getInvoice/listInvoices this is now belt-and-
// braces (a food bill keeps invoice_id set), but the same OUTER APPLYs and
// loadFoodItemsByInvoice also serve STAY/EVENT bills, where invoice_id really
// is cleared on void, so the fallback is load-bearing there.
for (const fn of ['getInvoice', 'listInvoices']) {
  test(`${fn} resolves a takeaway's guest/order-number even after its order's invoice_id is cleared`, () => {
    const body = bodyOf(fn);
    assert.match(body, /COALESCE\(fo\.invoice_id, fo\.voided_invoice_id\) = i\.id AND fo\.source = 'COUNTER'/);
    assert.match(body, /COALESCE\(fo2\.invoice_id, fo2\.voided_invoice_id\) = i\.id AND fo2\.guest_name IS NOT NULL/);
  });
}

test('loadFoodItemsByInvoice still finds a bill\'s items after its order\'s invoice_id is cleared', () => {
  const body = bodyOf('loadFoodItemsByInvoice');
  assert.match(body, /COALESCE\(o\.invoice_id, o\.voided_invoice_id\)/);
});
