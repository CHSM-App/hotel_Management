const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Same preamble as the other suites: the service pulls in the connection config
// at require time, so the environment has to be valid before it loads. Nothing
// here reaches SQL Server or the WhatsApp provider.
process.env.DB_SERVER ||= 'localhost';
process.env.DB_PORT ||= '1433';
process.env.DB_NAME ||= 'lodge_test';
process.env.DB_USER ||= 'sa';
process.env.DB_PASSWORD ||= 'test';
process.env.JWT_SECRET ||= 'a'.repeat(40);

const receiptShare = require('../src/modules/billing/receiptShare.service');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const receipt = {
  guest_name: 'Anil Kumar',
  receipt_number: 'RCPT/2026/011',
  amount_received: 1500,
  payment_method: 'UPI',
  lodge_name: 'Hotel Renuka Palace',
};

const LINK = 'https://hotel.example.com/public/receipts/abc123';

// The approved template has six slots, not seven — unlike the first draft of
// this notifier, the closing line reads "Thank you for choosing us!" rather
// than repeating the hotel name, so buildReceiptSample must send exactly six
// values, matching the six variables that were actually approved.
test('a receipt fills exactly the six approved template variables, in order', () => {
  const sample = receiptShare.buildReceiptSample(receipt, LINK);
  const parts = sample.split(',');
  assert.strictEqual(parts.length, 6, `expected 6 variables, got ${parts.length}: ${sample}`);
  assert.deepStrictEqual(parts, ['Anil Kumar', 'Hotel Renuka Palace', 'RCPT/2026/011', '1500.00', 'UPI', LINK]);
});

// The provider packs a template's variables into one comma-separated string, so
// a comma inside any value shifts every variable after it along by one.
test('a comma in any value cannot shift the template variables', () => {
  const sample = receiptShare.buildReceiptSample(
    { ...receipt, guest_name: 'Kumar, Anil', lodge_name: 'Renuka Palace, Vengurla' },
    LINK
  );
  const parts = sample.split(',');
  assert.strictEqual(parts.length, 6);
  assert.strictEqual(parts[0], 'Kumar - Anil');
  assert.strictEqual(parts[1], 'Renuka Palace - Vengurla');
  // The link arrives whole, which is the entire point of the exercise.
  assert.strictEqual(parts[5], LINK);
});

test('the amount always carries paise, with no thousands separator', () => {
  assert.strictEqual(receiptShare.buildReceiptSample({ ...receipt, amount_received: 123456.5 }, LINK).split(',')[3], '123456.50');
  assert.strictEqual(receiptShare.buildReceiptSample({ ...receipt, amount_received: 0 }, LINK).split(',')[3], '0.00');
  assert.strictEqual(receiptShare.buildReceiptSample({ ...receipt, amount_received: null }, LINK).split(',')[3], '0.00');
});

test('the payment method prints its label, not the raw enum value', () => {
  assert.strictEqual(receiptShare.buildReceiptSample({ ...receipt, payment_method: 'CASH' }, LINK).split(',')[4], 'Cash');
  assert.strictEqual(receiptShare.buildReceiptSample({ ...receipt, payment_method: 'CARD' }, LINK).split(',')[4], 'Card');
});

// No room number, check-in/check-out, or venue anywhere in this template —
// the same sample builder has to work whether loadReceipt found a booking or
// an event behind the receipt, and it does, because it never looks at either.
test('a receipt with no guest name on file reads "Guest", not blank', () => {
  const sample = receiptShare.buildReceiptSample({ ...receipt, guest_name: null }, LINK);
  assert.strictEqual(sample.split(',')[0], 'Guest');
});

test('an empty value becomes a dash rather than a blank', () => {
  assert.strictEqual(receiptShare.clean(''), '-');
  assert.strictEqual(receiptShare.clean(null), '-');
  assert.strictEqual(receiptShare.clean('   '), '-');
});

test('whitespace in a value is collapsed, not preserved', () => {
  assert.strictEqual(receiptShare.clean('Hotel   Renuka\n Palace'), 'Hotel Renuka Palace');
});

test('the amount formatter always carries paise', () => {
  assert.strictEqual(receiptShare.amountForTemplate(1200), 'Rs 1200.00');
  assert.strictEqual(receiptShare.amountForTemplate(0), 'Rs 0.00');
  assert.strictEqual(receiptShare.amountForTemplate(null), 'Rs 0.00');
});

// Both switches have to be on. A template id with no public address builds a
// link the guest cannot open; an address with no template has nothing to send.
test('WhatsApp is unavailable unless both the template and the public URL are set', () => {
  const template = process.env.WHATSAPP_RECEIPT_TEMPLATE_ID;
  const base = process.env.PUBLIC_BASE_URL;
  try {
    delete process.env.WHATSAPP_RECEIPT_TEMPLATE_ID;
    process.env.PUBLIC_BASE_URL = 'https://hotel.example.com';
    assert.strictEqual(receiptShare.whatsAppAvailable(), false, 'no template');

    delete process.env.PUBLIC_BASE_URL;
    assert.strictEqual(receiptShare.whatsAppAvailable(), false, 'no public URL');
  } finally {
    if (template === undefined) delete process.env.WHATSAPP_RECEIPT_TEMPLATE_ID;
    else process.env.WHATSAPP_RECEIPT_TEMPLATE_ID = template;
    if (base === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = base;
  }
});

// The link is the whole credential, so the route that serves it has to be
// narrower than "the token exists" — same reasoning as a shared bill.
test('a shared receipt is only served while both the share and the receipt are good', () => {
  const src = read('src/modules/billing/receiptShare.service.js');
  const query = src.slice(src.indexOf('async function readSharedReceipt'));
  assert.match(query, /s\.status\s*=\s*'SENT'/, 'a failed send must not be downloadable');
  assert.match(query, /ar\.status\s*=\s*'ISSUED'/, 'a voided receipt must not be downloadable');
});

test('the guest link points at the mounted public route', () => {
  const src = read('src/modules/billing/receiptShare.service.js');
  assert.match(src, /\/public\/receipts\/\$\{token\}/);

  const routes = read('src/modules/public/public.routes.js');
  assert.match(routes, /router\.get\('\/receipts\/:token'/);
  assert.match(routes, /router\.get\('\/receipts\/:token\/download'/);
});

// loadReceipt already reads either a booking or an event behind the receipt —
// the sample builder has nothing stay-specific to ask of either, which is why
// one approved template serves both without a second, event-only one.
test('loadReceipt reads either a booking or an event behind the receipt', () => {
  const src = read('src/modules/billing/receiptShare.service.js');
  assert.match(src, /LEFT JOIN dbo\.bookings b ON b\.id = ar\.booking_id/);
  assert.match(src, /LEFT JOIN dbo\.event_bookings eb ON eb\.id = ar\.event_booking_id/);
  assert.match(src, /COALESCE\(b\.guest_name, eb\.organiser_name\)/);
  assert.match(src, /COALESCE\(b\.guest_phone, eb\.organiser_phone\)/);
});

// A send that never happened leaves an uploaded PDF nobody can reach, because
// the row is what makes a file reachable.
test('an upload whose send failed is removed from disk', () => {
  const src = read('src/modules/billing/receiptShare.service.js');
  const fn = src.slice(src.indexOf('async function shareReceiptOnWhatsApp'));
  assert.match(fn, /discard\(file\.filename\)/, 'the file must be discarded when the send does not happen');
});

test('.env.example documents the template switch', () => {
  assert.match(read('.env.example'), /^WHATSAPP_RECEIPT_TEMPLATE_ID=/m);
});
