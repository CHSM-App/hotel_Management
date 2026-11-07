const test = require('node:test');
const assert = require('node:assert');

const {
  paymentLinesOf,
  paymentLinesSettle,
  PAYMENT_LINES_MISMATCH,
} = require('../src/modules/bookings/bookings.schema');
const { issueInvoiceSchema, advanceReceiptSchema } = require('../src/modules/billing/billing.schema');
const { splitAcross } = require('../src/modules/reports/reports.service');

// A guest settling a bill often hands over some cash and pays the rest by UPI
// or card. Every money document here used to record a single method, so the
// other half of the payment was filed under a method it never used — wrong on
// the printed bill and wrong in the day's takings by mode.
//
// Three things have to hold for that to be safe to add:
//
//   the parts must add up to the whole, checked in paise on the server;
//   a body that still sends the old single method must keep working;
//   and no figure in an already-reconciled month may move.
//
// The last one is splitAcross, and it is the reason for the clamp.

const invoiceBody = (over) => ({
  bookingId: 1,
  billingSide: 'GST',
  collectedAmount: 1000,
  ...over,
});

const receiptBody = (over) => ({
  bookingId: 1,
  amountReceived: 1000,
  ...over,
});

// ---------------------------------------------------------------------------
// The sum rule
// ---------------------------------------------------------------------------

test('lines that add up to the amount are accepted', () => {
  const parsed = issueInvoiceSchema.safeParse(
    invoiceBody({
      paymentLines: [
        { method: 'CASH', amount: 600 },
        { method: 'UPI', amount: 400, reference: 'UTR123' },
      ],
    })
  );
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
});

test('lines that miss by a single paisa are refused', () => {
  const parsed = issueInvoiceSchema.safeParse(
    invoiceBody({
      paymentLines: [
        { method: 'CASH', amount: 600 },
        { method: 'UPI', amount: 399.99, reference: 'UTR123' },
      ],
    })
  );
  assert.equal(parsed.success, false);
  assert.ok(
    parsed.error.issues.some((i) => i.message === PAYMENT_LINES_MISMATCH),
    'the mismatch must be reported as a mismatch, not as some other field'
  );
});

// The reason the check is written in paise rather than on the numbers as they
// arrive. 600 + 900.1 is 1500.0999999999999 in binary floating point, and a
// settlement refused for a rounding artefact is worse than one that adds up.
test('a sum that floating point gets wrong still settles', () => {
  assert.equal(0.1 + 0.2 === 0.3, false, 'the premise: this is why paise');
  assert.ok(paymentLinesSettle([{ amount: 0.1 }, { amount: 0.2 }], 0.3));
  assert.ok(paymentLinesSettle([{ amount: 600 }, { amount: 900.1 }], 1500.1));
});

test('the advance receipt applies the same sum rule to its own total', () => {
  const ok = advanceReceiptSchema.safeParse(
    receiptBody({
      paymentLines: [
        { method: 'CASH', amount: 700 },
        { method: 'CARD', amount: 300, reference: 'AUTH99' },
      ],
    })
  );
  assert.ok(ok.success, JSON.stringify(ok.error?.issues));

  const bad = advanceReceiptSchema.safeParse(
    receiptBody({
      paymentLines: [
        { method: 'CASH', amount: 700 },
        { method: 'CARD', amount: 400, reference: 'AUTH99' },
      ],
    })
  );
  assert.equal(bad.success, false);
});

// ---------------------------------------------------------------------------
// Per-line references
// ---------------------------------------------------------------------------

// The number is worth having and is asked for on UPI and card, but it is not
// a condition of taking the money: the guest's app is sometimes slow to show a
// UTR, and a desk that cannot write the booking until it does is a desk that
// makes the guest wait. It gets recorded when it is known.
test('a UPI line may be filed without its transaction number', () => {
  const parsed = issueInvoiceSchema.safeParse(
    invoiceBody({
      paymentLines: [
        { method: 'CASH', amount: 600 },
        { method: 'UPI', amount: 400 },
      ],
    })
  );
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
});

// The other half of the same rule: a reference is allowed on every method, so
// a cash line somebody annotated is not refused either.
test('a cash line may carry a reference', () => {
  const parsed = issueInvoiceSchema.safeParse(
    invoiceBody({ paymentLines: [{ method: 'CASH', amount: 1000, reference: 'till 2' }] })
  );
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
});

test('six tenders on one settlement is a typo, not a payment', () => {
  const parsed = issueInvoiceSchema.safeParse(
    invoiceBody({
      collectedAmount: 6,
      paymentLines: Array.from({ length: 6 }, () => ({ method: 'CASH', amount: 1 })),
    })
  );
  assert.equal(parsed.success, false);
});

// ---------------------------------------------------------------------------
// The old shape keeps working
// ---------------------------------------------------------------------------
//
// paymentLines is optional on purpose, so the backend can ship ahead of the
// desk's screen and no client is broken by the deploy that adds it.

test('a body sending only the single method is still valid', () => {
  const invoice = issueInvoiceSchema.safeParse(
    invoiceBody({ paymentMethod: 'CASH' })
  );
  assert.ok(invoice.success, JSON.stringify(invoice.error?.issues));

  const receipt = advanceReceiptSchema.safeParse(
    receiptBody({ paymentMethod: 'UPI', paymentReference: 'UTR1' })
  );
  assert.ok(receipt.success, JSON.stringify(receipt.error?.issues));
});

// The refine this had to grow. Before lines existed it read "collected is zero
// or paymentMethod is set", which refuses every lines-only settlement for a
// field it deliberately did not send.
test('lines alone satisfy the payment-type requirement', () => {
  const parsed = issueInvoiceSchema.safeParse(
    invoiceBody({ paymentLines: [{ method: 'CASH', amount: 1000 }] })
  );
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
});

test('a settlement collecting nothing needs neither', () => {
  const parsed = issueInvoiceSchema.safeParse(invoiceBody({ collectedAmount: 0 }));
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
});

test('paymentLinesOf reads the old single method as a one-line split', () => {
  assert.deepEqual(paymentLinesOf({ paymentMethod: 'UPI', paymentReference: 'UTR1' }, 1500), [
    { method: 'UPI', amount: 1500, reference: 'UTR1' },
  ]);
  assert.deepEqual(paymentLinesOf({ paymentMethod: 'CASH' }, 0), [], 'no money, no line');
  assert.deepEqual(paymentLinesOf({}, 1500), [], 'no method, no line');
});

// ---------------------------------------------------------------------------
// splitAcross — the guarantee that history cannot move
// ---------------------------------------------------------------------------

const totalOf = (parts) => parts.reduce((sum, p) => sum + p.amount, 0);

// The regression guard for "historical figures do not change". Every booking
// and invoice in the database predates payment lines and has none, so this is
// the path all of them take, and it must be exactly what the report did before.
test('with no lines the whole amount goes to the scalar method', () => {
  assert.deepEqual(splitAcross(1500, undefined, 'CASH'), [{ method: 'CASH', amount: 1500 }]);
  assert.deepEqual(splitAcross(1500, [], 'CASH'), [{ method: 'CASH', amount: 1500 }]);
});

test('lines that account for the amount leave nothing for the fallback', () => {
  const parts = splitAcross(1000, [
    { method: 'CASH', amount: 600 },
    { method: 'UPI', amount: 400 },
  ], 'CASH');
  assert.deepEqual(parts, [
    { method: 'CASH', amount: 600 },
    { method: 'UPI', amount: 400 },
  ]);
  assert.equal(totalOf(parts), 1000);
});

// bookings.advance_amount has five writers, one of which sets an arbitrary
// value and one of which floors it to NULL — so a booking really can hold less
// than its issued receipts add up to. Three do right now. Without the clamp the
// report would attribute money the property does not have.
test('lines exceeding the amount are clamped, and the total still holds', () => {
  const parts = splitAcross(400, [
    { method: 'CASH', amount: 300 },
    { method: 'UPI', amount: 300 },
  ], 'CASH');
  assert.equal(totalOf(parts), 400, 'attribution may never exceed what was taken');
  assert.deepEqual(parts, [
    { method: 'CASH', amount: 300 },
    { method: 'UPI', amount: 100 },
  ]);
});

test('a line beyond the amount is dropped rather than reported as zero', () => {
  const parts = splitAcross(300, [
    { method: 'CASH', amount: 300 },
    { method: 'UPI', amount: 200 },
  ], 'CASH');
  assert.deepEqual(parts, [{ method: 'CASH', amount: 300 }]);
});

// The mixed case: an advance topped up before lines existed and split after.
// The remainder is money whose only record of method is the scalar column,
// which is why issueAdvanceReceipt refuses to overwrite it on a split.
test('money the lines do not cover falls back to the scalar method', () => {
  const parts = splitAcross(1000, [{ method: 'UPI', amount: 400 }], 'CASH');
  assert.deepEqual(parts, [
    { method: 'UPI', amount: 400 },
    { method: 'CASH', amount: 600 },
  ]);
  assert.equal(totalOf(parts), 1000);
});

// The property this rests on, stated directly: whatever the lines say, the
// parts sum to the amount the report has always summed.
test('attribution sums to the amount whatever the lines claim', () => {
  const cases = [
    [1000, []],
    [1000, [{ method: 'CASH', amount: 1000 }]],
    [1000, [{ method: 'CASH', amount: 999.99 }]],
    [1000, [{ method: 'CASH', amount: 5000 }]],
    [1000, [{ method: 'CASH', amount: 333.33 }, { method: 'UPI', amount: 333.33 }]],
    [0.03, [{ method: 'CASH', amount: 0.01 }, { method: 'UPI', amount: 0.01 }]],
  ];
  for (const [amount, lines] of cases) {
    assert.equal(
      Math.round(totalOf(splitAcross(amount, lines, 'CASH')) * 100),
      Math.round(amount * 100),
      `${amount} across ${JSON.stringify(lines)}`
    );
  }
});

// ---------------------------------------------------------------------------
// A split taken on the booking form
// ---------------------------------------------------------------------------
//
// The advance on a booking is receipted by an internal call that bypasses
// advanceReceiptSchema entirely, so the booking schemas are the trust boundary
// for this one — nothing downstream re-checks that the parts add up.

const fs = require('node:fs');
const path = require('node:path');
const {
  createBookingSchema,
  checkInSchema,
  updateBookingSchema,
} = require('../src/modules/bookings/bookings.schema');

const bookingBody = (over) => ({
  roomId: 1,
  checkInDate: '2026-09-01',
  checkOutDate: '2026-09-02',
  numGuests: 2,
  guestName: 'A Guest',
  guestPhone: '9876543210',
  bookingType: 'ADVANCE',
  guests: [],
  vehicles: [],
  switchableCharges: [],
  ...over,
});

test('a booking takes an advance split across methods', () => {
  const parsed = createBookingSchema.safeParse(
    bookingBody({
      advanceAmount: 1000,
      advancePaymentMethod: 'CASH',
      advanceLines: [
        { method: 'CASH', amount: 600 },
        { method: 'UPI', amount: 400, reference: 'UTR9' },
      ],
    })
  );
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
});

test('a booking refuses a split that does not add up to the advance', () => {
  const parsed = createBookingSchema.safeParse(
    bookingBody({
      advanceAmount: 1000,
      advancePaymentMethod: 'CASH',
      advanceLines: [
        { method: 'CASH', amount: 600 },
        { method: 'UPI', amount: 300, reference: 'UTR9' },
      ],
    })
  );
  assert.equal(parsed.success, false);
  assert.ok(parsed.error.issues.some((i) => i.message === PAYMENT_LINES_MISMATCH));
});

test('check-in applies the same rule to the advance it takes', () => {
  const ok = checkInSchema.safeParse({
    advanceAmount: 500,
    advancePaymentMethod: 'CASH',
    guests: [],
    vehicles: [],
    advanceLines: [
      { method: 'CASH', amount: 200 },
      { method: 'CARD', amount: 300, reference: 'AUTH1' },
    ],
  });
  assert.ok(ok.success, JSON.stringify(ok.error?.issues));

  const bad = checkInSchema.safeParse({
    advanceAmount: 500,
    advancePaymentMethod: 'CASH',
    guests: [],
    vehicles: [],
    advanceLines: [
      { method: 'CASH', amount: 200 },
      { method: 'CARD', amount: 400, reference: 'AUTH1' },
    ],
  });
  assert.equal(bad.success, false);
});

// The reason edit is excluded, pinned so it stays excluded.
//
// An edit SETS the advance rather than adding to it, so only the difference
// between the old figure and the new one gets a receipt. Lines describe the
// whole advance, not that difference — accepting them here would attach a
// 1,000-rupee split to a 300-rupee delta receipt, and the report would then
// read payment methods off money that was never taken.
test('an edit cannot smuggle a split through', () => {
  const parsed = updateBookingSchema.safeParse({
    advanceAmount: 900,
    advancePaymentMethod: 'CASH',
    advanceLines: [
      { method: 'CASH', amount: 400 },
      { method: 'UPI', amount: 500, reference: 'U1' },
    ],
  });
  assert.ok(parsed.success, 'the edit itself is still valid');
  assert.ok(
    !('advanceLines' in parsed.data),
    'updateBookingSchema is carrying advanceLines — a delta receipt would be given lines describing the whole advance'
  );
});

test('the booking form still posts without any lines at all', () => {
  const parsed = createBookingSchema.safeParse(
    bookingBody({ advanceAmount: 1000, advancePaymentMethod: 'CASH' })
  );
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  assert.equal(parsed.data.advanceLines, undefined);
});

// Both handlers have to parse the field out of the multipart body, or the
// schema above never sees it and the split is silently dropped.
test('both booking handlers parse the lines off the multipart body', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'modules', 'bookings', 'bookings.controller.js'),
    'utf8'
  );
  assert.equal(
    (src.match(/body\.advanceLines = parseJsonArrayField\(body\.advanceLines\);/g) || []).length,
    2,
    'create and check-in must each parse advanceLines — a missing one drops the split without an error'
  );
});

test('the auto-issued receipt forwards the split', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'modules', 'bookings', 'bookings.service.js'),
    'utf8'
  );
  assert.ok(
    src.includes('paymentLines: input.advanceLines'),
    'autoIssueAdvanceReceipt stopped forwarding the lines — the receipt would record only the first method'
  );
});
