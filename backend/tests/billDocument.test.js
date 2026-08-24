const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// The printed bill is the only thing the guest takes away, and two of its lines
// were wrong on every invoice ever issued:
//
//   "Less Advance if any" was advance_paid + balance_collected, so a guest who
//   left no deposit still read "Less Advance 1,500".
//
//   Net Payment was total - (advance + collected). Those always sum to the
//   total on a settled bill, so it printed 0.00 every time — the one figure the
//   guest is meant to read off it.
//
// The rule: an advance is money taken BEFORE the bill was cut; balance_collected
// is the payment the bill is asking for. They are opposite sides and must never
// be added together.
//
// Checked statically because the project has no frontend test runner, and
// adding one to assert two lines of arithmetic is more scaffolding than the
// check is worth.

const BILL = path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'lodge', 'BillDocument.jsx');

function source() {
  return fs.readFileSync(BILL, 'utf8');
}

test('net payment is the total less the advance, and nothing else', () => {
  const src = source();
  assert.match(
    src,
    /const netPayment = round2\(invoice\.totalAmount - invoice\.advancePaid\);/,
    'netPayment is no longer total - advancePaid'
  );
  assert.ok(
    !/invoice\.advancePaid \+ invoice\.balanceCollected/.test(src),
    'the advance and the money collected at the desk are being added together again'
  );
  assert.ok(
    !/paidAlready/.test(src),
    'paidAlready is back — it was the variable that folded the two together'
  );
});

test('the advance line shows the advance, and only prints when there was one', () => {
  const src = source();
  // Checked as two fragments rather than one whole element: the label now also
  // carries the receipt number the advance was taken against. What must never
  // come back is advance + balance_collected, pinned by the test above — this
  // one only holds the line to advancePaid alone.
  assert.ok(
    src.includes('invoice.advancePaid > 0 &&'),
    'the advance line is no longer guarded on advancePaid > 0'
  );
  assert.ok(
    src.includes('value={invoice.advancePaid}'),
    'the advance line no longer renders advancePaid as its value'
  );
});

test('the bill cites the receipt the advance was taken against', () => {
  // A deduction the guest cannot trace to paper they already hold is a figure
  // they have to take on trust at the desk.
  assert.ok(
    source().includes('invoice.advanceReceiptNumbers'),
    'the bill no longer prints the advance receipt number'
  );
});

test('a voided advance receipt is never cited as proof of payment', () => {
  const service = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'modules', 'billing', 'billing.service.js'),
    'utf8'
  );
  const parts = service.split('STRING_AGG(ar.receipt_number').slice(1);
  assert.strictEqual(parts.length, 3, 'expected the receipt-number subquery on all three invoice reads');
  for (const p of parts) {
    assert.ok(
      p.slice(0, 300).includes("ar.status = 'ISSUED'"),
      'a receipt-number subquery is not filtering out VOID receipts'
    );
  }
});

// Worked in plain arithmetic, against the shapes that actually occur: no
// advance, part advance, and an advance covering the whole stay.
test('the arithmetic holds for every way a stay gets paid', () => {
  const round2 = (n) => Math.round(n * 100) / 100;
  const bill = (total, advance) => ({
    lessAdvance: advance > 0 ? advance : null, // null renders no line
    netPayment: round2(total - advance),
  });

  // Paid entirely at checkout — the case in the screenshot that started this.
  assert.deepStrictEqual(bill(1500, 0), { lessAdvance: null, netPayment: 1500 });

  // A ₹200 deposit at booking, the rest on departure.
  assert.deepStrictEqual(bill(1500, 200), { lessAdvance: 200, netPayment: 1300 });

  // Prepaid in full: nothing left to hand over, and 0 here is the truth rather
  // than the artefact it used to be.
  assert.deepStrictEqual(bill(1500, 1500), { lessAdvance: 1500, netPayment: 0 });

  // Paise survive the subtraction rather than drifting.
  assert.deepStrictEqual(bill(1428.58, 200), { lessAdvance: 200, netPayment: 1228.58 });
});
