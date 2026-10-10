const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Same preamble as the other WhatsApp suites.
process.env.DB_SERVER ||= 'localhost';
process.env.DB_PORT ||= '1433';
process.env.DB_NAME ||= 'lodge_test';
process.env.DB_USER ||= 'sa';
process.env.DB_PASSWORD ||= 'test';
process.env.JWT_SECRET ||= 'a'.repeat(40);
// Must be OFF for these tests: with a template id set the notifier would go
// looking for a database.
delete process.env.WHATSAPP_FEEDBACK_TEMPLATE_ID;
delete process.env.PUBLIC_BASE_URL;

const { buildFeedbackSample, clean, notifyFeedbackRequest } = require('../src/modules/notifications/feedbackRequest');
const { sendDueFeedbackRequests, newFeedbackToken } = require('../src/modules/bookings/feedbackRequests.service');
const whatsapp = require('../src/config/whatsapp');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const lodge = { name: 'Sea View Lodge' };
const booking = { id: 41, guestName: 'Rahul Patil', guestPhone: '9876543210' };
const link = 'https://hotel.example.com/public/feedback/abc123';

// ---------------------------------------------------------------------------
// The three variables, in template order
// ---------------------------------------------------------------------------

test('a feedback request fills the three template variables in order', () => {
  const sample = buildFeedbackSample(booking, lodge, link);
  assert.deepStrictEqual(sample, ['Rahul Patil', 'Sea View Lodge', link]);
});

test('clean() collapses whitespace, replaces commas, and never yields an empty variable', () => {
  assert.strictEqual(clean('  Sea View,  Lodge '), 'Sea View - Lodge');
  assert.strictEqual(clean(''), '-');
  assert.strictEqual(clean(null), '-');
});

// ---------------------------------------------------------------------------
// Off unless configured, and never throwing
// ---------------------------------------------------------------------------

test('with no template configured the notifier skips without touching the database', async () => {
  assert.strictEqual(whatsapp.isFeedbackTemplateConfigured(), false);
  assert.deepStrictEqual(await notifyFeedbackRequest(1, booking, lodge, link), {
    status: 'skipped',
    reason: 'not configured',
  });
});

test('with no template or PUBLIC_BASE_URL configured the sweep does nothing, never throws', async () => {
  assert.deepStrictEqual(await sendDueFeedbackRequests(), { checked: 0, sent: 0, skipped: 0, failed: 0 });
});

// ---------------------------------------------------------------------------
// newFeedbackToken — same shape as orders.service.js's newPublicToken
// ---------------------------------------------------------------------------

test('newFeedbackToken produces a URL-safe, sufficiently long, non-repeating token', () => {
  const a = newFeedbackToken();
  const b = newFeedbackToken();
  assert.notStrictEqual(a, b);
  assert.ok(a.length >= 20, `expected a long token, got ${a.length} characters`);
  assert.ok(/^[A-Za-z0-9_-]+$/.test(a), `expected a URL-safe token, got "${a}"`);
});

// ---------------------------------------------------------------------------
// The exact shape getBooking()-style data the notifier expects
// ---------------------------------------------------------------------------

test('reads the camelCase fields buildFeedbackSample expects, not raw snake_case', () => {
  const src = read('src/modules/notifications/feedbackRequest.js');
  assert.match(src, /booking\.guestName/);
  assert.match(src, /booking\.guestPhone/);
});

// ---------------------------------------------------------------------------
// One ask per booking, ever — the row is written before the send, not after
// ---------------------------------------------------------------------------

test('the sweep records the feedback request before attempting the send', () => {
  const src = read('src/modules/bookings/feedbackRequests.service.js');
  const insertAt = src.indexOf('INSERT INTO dbo.feedback_requests');
  const sendAt = src.indexOf('notifyFeedbackRequest(');
  assert.ok(insertAt > -1 && sendAt > -1, 'expected both the insert and the send call to exist');
  assert.ok(insertAt < sendAt, 'expected the feedback_requests row to be written before the send is attempted');
});

test('the sweep query excludes bookings older than the 3-day upper bound', () => {
  const src = read('src/modules/bookings/feedbackRequests.service.js');
  assert.match(src, /MAX_AGE_DAYS/);
  assert.match(src, /actual_check_out_at >= DATEADD\(day, -@maxAgeDays/);
});

// ---------------------------------------------------------------------------
// Where it fires from
// ---------------------------------------------------------------------------

test('server.js schedules the feedback sweep every 2 hours, separate from the daily one', () => {
  const src = read('src/server.js');
  assert.match(src, /sendDueFeedbackRequests/);
  assert.match(src, /0 \*\/2 \* \* \*/);
  assert.match(src, /Asia\/Kolkata/);
});

test('.env.example documents the template switch and the link it needs', () => {
  const src = read('.env.example');
  assert.match(src, /^WHATSAPP_FEEDBACK_TEMPLATE_ID=/m);
  assert.match(src, /^PUBLIC_BASE_URL=/m);
});

// ---------------------------------------------------------------------------
// publicBaseUrl extraction — one implementation, two callers
// ---------------------------------------------------------------------------

test('publicBaseUrl is a shared helper, not duplicated per feature', () => {
  const shared = read('src/config/publicBaseUrl.js');
  assert.match(shared, /function publicBaseUrl/);

  const billShare = read('src/modules/billing/billShare.service.js');
  const receiptShare = read('src/modules/billing/receiptShare.service.js');
  const sweep = read('src/modules/bookings/feedbackRequests.service.js');
  for (const src of [billShare, receiptShare, sweep]) {
    assert.match(src, /require\(.*config\/publicBaseUrl.*\)/);
    assert.doesNotMatch(src, /function publicBaseUrl/);
  }
});
