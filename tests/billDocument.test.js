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

// ---------------------------------------------------------------------------
// Split payments
// ---------------------------------------------------------------------------
//
// A guest settling part in cash and the rest by UPI gets a row per method under
// Net Payment. The risk is not that the rows fail to appear — it is that they
// appear on bills that have no split, or that somebody folds them into the
// arithmetic above and restates a figure the guest is meant to read off.

test('the payment rows print only when the payment was actually split', () => {
  const src = source();
  assert.ok(
    src.includes('invoice.paymentLines?.length > 1 &&'),
    'the per-method rows are no longer gated on there being more than one — every '
      + 'bill would print a duplicate "Cash 1,500" row under its own net payment'
  );
});

test('a payment row is a breakdown, never another total', () => {
  const src = source();
  const block = src.slice(src.indexOf('invoice.paymentLines?.length > 1 &&'));
  const rows = block.slice(0, block.indexOf('</tbody>'));
  assert.ok(rows.includes('value={line.amount}'), 'the rows stopped rendering their own amount');
  // strong and rule are what mark a figure as a total on this paper. A
  // breakdown carrying either reads as one more sum to be checked.
  assert.ok(!/\bstrong\b/.test(rows), 'a payment row is being printed as a total');
  assert.ok(!/\brule\b/.test(rows), 'a payment row is drawing a total rule under itself');
});

test('the split never enters the net payment arithmetic', () => {
  // The declaration itself, not the file: the rows render a few lines below
  // the netPayment element in the JSX, so anything looser than this matches
  // the markup and fails on correct code.
  const decl = source().match(/const netPayment = .*/)[0];
  assert.ok(
    !decl.includes('paymentLines'),
    'paymentLines is being folded into netPayment — it describes how the money '
      + 'arrived, never how much'
  );
});

// The receipt is the other half of the same change: two ticks read instantly as
// "part cash, part UPI", where one method name in a box does not.
test('the advance receipt ticks every method the money arrived by', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'lodge', 'AdvanceReceiptDocument.jsx'),
    'utf8'
  );
  assert.ok(
    src.includes('paidBy.has(key)'),
    'the tick is back to a single equality against receipt.paymentMethod, so a '
      + 'split advance prints as though it arrived one way'
  );
  // Every receipt ever issued predates payment lines and has none. Without the
  // fallback they would all print with no method ticked at all.
  assert.ok(
    src.includes('receipt.paymentLines?.length'),
    'the one-line fallback is gone — existing receipts would print untouched boxes'
  );
});

// The split printed the first method twice: "CASH" as the Net Payment
// decoration, then "Cash 1,000" as the first row directly beneath it — the same
// payment said twice, one of the two without its amount.
test('a split names each method once, not twice', () => {
  const src = source();
  assert.ok(
    src.includes('!(invoice.paymentLines?.length > 1) &&'),
    'the Net Payment method decoration is unconditional again, so a split repeats its first method'
  );
});

// A single payment still prints exactly as it always did — the decoration is
// the only thing that names the method there, since no rows are rendered.
test('a single payment keeps its method beside the net payment', () => {
  const src = source();
  const decoration = src.slice(src.indexOf('!(invoice.paymentLines?.length > 1) &&'));
  assert.ok(
    decoration.includes('invoice.balancePaymentMethod') && decoration.includes('invoice.balanceReference'),
    'the single-payment decoration lost the method or the reference it prints'
  );
});

// An unlabelled string of digits under a UPI row is not answerable months
// later. The bill needs its own copy of the word — STRINGS_MR here overrides
// only the masthead, so the English one is what both languages print.
test('a payment row says what its reference is', () => {
  const src = source();
  assert.match(src, /txnNo: '[^']+'/, 'the bill has no name for a transaction number');
  const block = src.slice(src.indexOf('invoice.paymentLines?.length > 1 &&'));
  const rows = block.slice(0, block.indexOf('</tbody>'));
  assert.ok(
    rows.includes('{T.txnNo} {line.reference}'),
    'the reference prints bare, with nothing saying what the number is'
  );
});
