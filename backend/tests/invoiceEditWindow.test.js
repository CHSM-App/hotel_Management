const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { windowViolation } = require('../src/modules/billing/billing.service');

// Invoices 34/35/36 issued 12/13/15 Nov: booking 35 may sit on 13 and 14 only.
const win = { invoiceNumber: '35', prevNumber: '34', nextNumber: '36', minDate: '2026-11-13', maxDate: '2026-11-14' };
const open = { invoiceNumber: '36', prevNumber: '35', nextNumber: null, minDate: '2026-11-14', maxDate: null };

test('dates inside the window are accepted', () => {
  assert.equal(windowViolation(win, ['2026-11-13', '2026-11-14']), null);
});

test('the neighbours own days are refused, with the range in the message', () => {
  assert.match(windowViolation(win, ['2026-11-12', '2026-11-14']), /2026-11-13 to 2026-11-14/);
  assert.match(windowViolation(win, ['2026-11-13', '2026-11-15']), /#34 and #36/);
});

test('an open side (first or last invoice) never refuses', () => {
  assert.equal(windowViolation(open, ['2026-12-30']), null);
  assert.ok(windowViolation(open, ['2026-11-13']));
  assert.equal(windowViolation({ ...open, minDate: null }, ['2020-01-01']), null);
});

test('a date the stay already holds is always accepted, even outside the window', () => {
  assert.equal(windowViolation(win, ['2026-11-12', '2026-11-14'], ['2026-11-12', '2026-11-13']), null);
  assert.ok(windowViolation(win, ['2026-11-12', '2026-11-16'], ['2026-11-12']));
});

test('stay 12→13 with window 13..14: check-out 14 ok, 15 and 12 refused', () => {
  assert.equal(windowViolation(win, ['2026-11-14'], ['2026-11-13']), null);
  assert.ok(windowViolation(win, ['2026-11-15'], ['2026-11-13']));
  assert.ok(windowViolation(win, ['2026-11-12'], ['2026-11-13']));
});

test('source: only the check-out date is held to the invoice window', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/modules/bookings/bookings.service.js'), 'utf8');
  assert.match(src, /\[checkOutDate\],\s*\[toIsoDate\(match\.check_out_date\)\]/);
});

test('source: billed stay is edited in the same transaction as its invoice', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/modules/bookings/bookings.service.js'), 'utf8');
  assert.match(src, /getInvoiceEditWindow\(lodgeId, bookingId\)/);
  assert.match(src, /billingService\.reviseInvoice\(transaction/);
  assert.match(src, /A checked-out stay can’t end in the future/);
});

test('schema.sql mirrors the invoice_revisions migration', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../src/config/schema.sql'), 'utf8');
  const mig = fs.readFileSync(path.join(__dirname, '../migrations/159_invoice_revisions.sql'), 'utf8');
  const cols = (t) => [...t.matchAll(/^\s+(\w+)\s+(?:BIGINT|NVARCHAR|DECIMAL|DATETIMEOFFSET)/gm)].map((m) => m[1]).sort();
  const pick = (t) => t.slice(t.indexOf('CREATE TABLE dbo.invoice_revisions'));
  assert.deepEqual(cols(pick(schema).split(');')[0]), cols(pick(mig).split(');')[0]));
});
