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

const billShare = require('../src/modules/billing/billShare.service');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const invoice = {
  guest_name: 'Anil Kumar',
  invoice_number: 'INV/2026/007',
  total_amount: 1234.5,
  lodge_name: 'Hotel Renuka Palace',
  check_in_date: '2026-03-01',
  check_out_date: '2026-03-03',
};

const LINK = 'https://hotel.example.com/public/bills/abc123';

// The provider packs a template's variables into one comma-separated string, so
// a comma inside any value shifts every variable after it along by one. That is
// not a cosmetic bug: variable 7 is the link, so a guest name with a comma in it
// sends a bill whose link slot holds something else and whose link is gone.
test('a comma in any value cannot shift the template variables', () => {
  const sample = billShare.buildBillSample(
    { ...invoice, guest_name: 'Kumar, Anil', lodge_name: 'Renuka Palace, Vengurla' },
    LINK
  );
  const parts = sample.split(',');
  assert.strictEqual(parts.length, 7, `expected 7 variables, got ${parts.length}: ${sample}`);
  assert.strictEqual(parts[0], 'Kumar - Anil');
  assert.strictEqual(parts[1], 'Renuka Palace - Vengurla');
  // The link arrives whole, which is the entire point of the exercise.
  assert.strictEqual(parts[6], LINK);
});

// A rupee amount rendered for humans (₹1,23,456.00) carries thousands
// separators, and in the Indian grouping there are two of them. Formatted that
// way this message would break into extra variables.
test('the amount goes out without thousands separators', () => {
  const sample = billShare.buildBillSample({ ...invoice, total_amount: 123456.5 }, LINK);
  const parts = sample.split(',');
  assert.strictEqual(parts.length, 7);
  assert.strictEqual(parts[3], 'Rs 123456.50');
});

// The stay dates fill the checkin_date / checkout_date slots, in the format
// used elsewhere in the app (bookingConfirmation.js).
test('the stay dates fill the checkin/checkout slots', () => {
  const sample = billShare.buildBillSample(invoice, LINK);
  const parts = sample.split(',');
  assert.strictEqual(parts[4], '1 Mar 2026');
  assert.strictEqual(parts[5], '3 Mar 2026');
});

// A function's bill has no check_in_date/check_out_date, so the event's
// start/end instants stand in for them instead of leaving the slots blank.
test('an event bill uses the event start/end instants for the stay slots', () => {
  const eventInvoice = {
    ...invoice,
    check_in_date: null,
    check_out_date: null,
    event_start_at: '2026-03-01T12:30:00.000Z',
    event_end_at: '2026-03-01T16:30:00.000Z',
  };
  const sample = billShare.buildBillSample(eventInvoice, LINK);
  const parts = sample.split(',');
  assert.strictEqual(parts[4], '1 Mar 2026');
  assert.strictEqual(parts[5], '1 Mar 2026');
});

// Two decimal places always: a bill for a round number is still money, and
// "Rs 1200" beside a printed "₹1,200.00" invites the guest to wonder which is
// the real figure.
test('the amount always carries paise', () => {
  assert.strictEqual(billShare.amountForTemplate(1200), 'Rs 1200.00');
  assert.strictEqual(billShare.amountForTemplate(0), 'Rs 0.00');
  assert.strictEqual(billShare.amountForTemplate(null), 'Rs 0.00');
});

// The provider rejects a template with a blank variable outright, so an empty
// value has to become something rather than nothing.
test('an empty value becomes a dash rather than a blank', () => {
  assert.strictEqual(billShare.clean(''), '-');
  assert.strictEqual(billShare.clean(null), '-');
  assert.strictEqual(billShare.clean('   '), '-');
});

test('whitespace in a value is collapsed, not preserved', () => {
  assert.strictEqual(billShare.clean('Hotel   Renuka\n Palace'), 'Hotel Renuka Palace');
});

// Both switches have to be on. A template id with no public address builds a
// link the guest cannot open; an address with no template has nothing to send.
test('WhatsApp is unavailable unless both the template and the public URL are set', () => {
  const template = process.env.WHATSAPP_BILL_TEMPLATE_ID;
  const base = process.env.PUBLIC_BASE_URL;
  try {
    delete process.env.WHATSAPP_BILL_TEMPLATE_ID;
    process.env.PUBLIC_BASE_URL = 'https://hotel.example.com';
    assert.strictEqual(billShare.whatsAppAvailable(), false, 'no template');

    delete process.env.PUBLIC_BASE_URL;
    assert.strictEqual(billShare.whatsAppAvailable(), false, 'no public URL');
  } finally {
    if (template === undefined) delete process.env.WHATSAPP_BILL_TEMPLATE_ID;
    else process.env.WHATSAPP_BILL_TEMPLATE_ID = template;
    if (base === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = base;
  }
});

// The link is the whole credential, so the route that serves it has to be
// narrower than "the token exists". A bill voided after it was sent is a
// document the property has cancelled, and continuing to serve it is how a
// cancelled bill gets presented as a valid one.
test('a shared bill is only served while both the share and the invoice are good', () => {
  const src = read('src/modules/billing/billShare.service.js');
  const query = src.slice(src.indexOf('async function readSharedBill'));
  assert.match(query, /s\.status\s*=\s*'SENT'/, 'a failed send must not be downloadable');
  assert.match(query, /i\.status\s*=\s*'ISSUED'/, 'a voided bill must not be downloadable');
});

// The link that goes out has to match where the router actually is. A wrong
// path here is a 404 in a message already delivered to a guest, which nothing
// on the desk can correct after the fact.
test('the guest link points at the mounted public route', () => {
  const src = read('src/modules/billing/billShare.service.js');
  assert.match(src, /\/public\/bills\/\$\{token\}/);

  const routes = read('src/modules/public/public.routes.js');
  assert.match(routes, /router\.get\('\/bills\/:token'/);
  // The landing page's Download button posts here — a wrong path on this one
  // is a working link that 404s the moment the guest presses the one button
  // on the page.
  assert.match(routes, /router\.get\('\/bills\/:token\/download'/);

  const app = read('src/app.js');
  assert.match(app, /\['\/public',\s*publicRoutes\]/);
});

// The link a guest is sent now opens a page, not the raw PDF — so the page
// has to actually offer a way to the file, and that file has to come back
// asking to be saved rather than reopening the same viewer the page was
// trying to get past.
test('the landing page links to the download route, and the download forces a save', () => {
  const controller = read('src/modules/public/public.controller.js');
  assert.match(controller, /\/public\/bills\/\$\{encodeURIComponent\(token\)\}\/download/);
  const downloadFn = controller.slice(controller.indexOf('async function downloadSharedBillHandler'));
  assert.match(downloadFn, /attachment; filename=/);
});

// A send that never happened leaves an uploaded PDF nobody can reach, because
// the row is what makes a file reachable. Without the cleanup the disk collects
// one of them per failure.
test('an upload whose send failed is removed from disk', () => {
  const src = read('src/modules/billing/billShare.service.js');
  const fn = src.slice(src.indexOf('async function shareInvoiceOnWhatsApp'));
  assert.match(fn, /discard\(file\.filename\)/, 'the file must be discarded when the send does not happen');
});

// Bill PDFs must not join the images on a public static mount: those are served
// to anyone who knows the filename, and a bill is one guest's money.
test('bill PDFs are not exposed by a static mount', () => {
  const app = read('src/app.js');
  assert.ok(
    !/express\.static\([^)]*BILL/i.test(app) && !app.includes('/bill-shares'),
    'bill-shares must be reachable only through the tokenised route'
  );
});
