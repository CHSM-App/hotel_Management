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

const { sendDueEventFeedbackRequests, newFeedbackToken } = require('../src/modules/events/eventFeedbackRequests.service');
const { buildFeedbackSample, buildGreetMessage } = require('../src/modules/notifications/feedbackRequest');
const whatsapp = require('../src/config/whatsapp');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

// ---------------------------------------------------------------------------
// The notifier is reused unchanged — its two variables name nothing
// stay-specific, so an organiser's shape fits the same buildFeedbackSample
// a guest's shape already did.
// ---------------------------------------------------------------------------

test('an organiser fits the same two template variables a guest does', () => {
  const lodge = { name: 'Sea View Lodge' };
  const organiserAsBooking = { id: 7, guestName: 'Sharma', guestPhone: '9876543210' };
  const link = 'https://hotel.example.com/public/feedback/abc123';
  assert.deepStrictEqual(buildFeedbackSample(organiserAsBooking, lodge, link), ['Sharma', buildGreetMessage(lodge, link)]);
});

// ---------------------------------------------------------------------------
// Off unless configured, and never throwing
// ---------------------------------------------------------------------------

test('with no template or PUBLIC_BASE_URL configured the sweep does nothing, never throws', async () => {
  assert.strictEqual(whatsapp.isFeedbackTemplateConfigured(), false);
  assert.deepStrictEqual(await sendDueEventFeedbackRequests(), { checked: 0, sent: 0, skipped: 0, failed: 0 });
});

// ---------------------------------------------------------------------------
// newFeedbackToken — same shape as feedbackRequests.service.js's own
// ---------------------------------------------------------------------------

test('newFeedbackToken produces a URL-safe, sufficiently long, non-repeating token', () => {
  const a = newFeedbackToken();
  const b = newFeedbackToken();
  assert.notStrictEqual(a, b);
  assert.ok(a.length >= 20, `expected a long token, got ${a.length} characters`);
  assert.ok(/^[A-Za-z0-9_-]+$/.test(a), `expected a URL-safe token, got "${a}"`);
});

// ---------------------------------------------------------------------------
// Fires off completed_at, not end_at or start_at — a function that was
// never marked complete is never asked, same as a booking that never
// actually checked out never gets the stay version of this ask.
// ---------------------------------------------------------------------------

test('the sweep is driven by completed_at, not a scheduled time', () => {
  const src = read('src/modules/events/eventFeedbackRequests.service.js');
  assert.match(src, /e\.completed_at IS NOT NULL/);
  assert.match(src, /e\.completed_at <= DATEADD\(hour, -@delayHours/);
  assert.match(src, /e\.completed_at >= DATEADD\(day, -@maxAgeDays/);
});

test('one ask per function, ever — the row is written before the send, not after', () => {
  const src = read('src/modules/events/eventFeedbackRequests.service.js');
  const insertAt = src.indexOf('INSERT INTO dbo.feedback_requests');
  const sendAt = src.indexOf('notifyFeedbackRequest(');
  assert.ok(insertAt > -1 && sendAt > -1, 'expected both the insert and the send call to exist');
  assert.ok(insertAt < sendAt, 'expected the feedback_requests row to be written before the send is attempted');
  assert.match(src, /NOT EXISTS \(SELECT 1 FROM dbo\.feedback_requests fr WHERE fr\.event_booking_id = e\.id\)/);
});

test('reads organiser_name/organiser_phone into the same shape the notifier expects from a guest', () => {
  const src = read('src/modules/events/eventFeedbackRequests.service.js');
  assert.match(src, /guestName: row\.organiser_name/);
  assert.match(src, /guestPhone: row\.organiser_phone/);
});

// ---------------------------------------------------------------------------
// Where it fires from
// ---------------------------------------------------------------------------

test('server.js schedules the event feedback sweep every 2 hours, alongside the stay one', () => {
  const src = read('src/server.js');
  assert.match(src, /sendDueEventFeedbackRequests/);
  // Both sweeps share the exact cron expression; this just confirms the event
  // one is actually scheduled at all, not accidentally left unregistered.
  const occurrences = src.match(/0 \*\/2 \* \* \*/g) || [];
  assert.ok(occurrences.length >= 2, 'expected both the stay and event feedback sweeps on a 2-hour cron');
});

// ---------------------------------------------------------------------------
// The schema split — a request against a stay or a function, never both
// ---------------------------------------------------------------------------

test('migration 141 and schema.sql both carry the stay-or-event split on feedback_requests', () => {
  const migration = read('migrations/141_event_feedback_requests.sql');
  assert.match(migration, /ADD\s+event_booking_id BIGINT NULL/);
  assert.match(migration, /ck_feedback_requests_parent/);
  assert.match(migration, /uq_feedback_requests_booking_active/);
  assert.match(migration, /uq_feedback_requests_event_active/);

  const schema = read('src/config/schema.sql');
  assert.match(schema, /ALTER TABLE dbo\.feedback_requests ADD event_booking_id BIGINT NULL/);
  assert.match(schema, /ck_feedback_requests_parent/);
});

// ---------------------------------------------------------------------------
// Everywhere a submitted response is read back out, a function's organiser
// must show up exactly as a guest would — same COALESCE shape in every
// query, not just the one the sweep itself writes.
// ---------------------------------------------------------------------------

test('every reader of feedback_requests reads either a booking or an event behind it', () => {
  const publicService = read('src/modules/public/public.service.js');
  const reports = read('src/modules/reports/reports.service.js');
  const customers = read('src/modules/customers/customers.service.js');

  for (const src of [publicService, reports, customers]) {
    assert.match(src, /LEFT JOIN dbo\.event_bookings eb ON eb\.id = fr\.event_booking_id/);
    assert.match(src, /COALESCE\(b\.guest_name, eb\.organiser_name\)/);
  }
});

test('.env.example documents the template and link this reuses, not a second template', () => {
  const src = read('.env.example');
  assert.match(src, /^WHATSAPP_FEEDBACK_TEMPLATE_ID=/m);
  // No WHATSAPP_EVENT_FEEDBACK_TEMPLATE_ID should ever exist — the whole
  // point is that one approved template covers both.
  assert.doesNotMatch(src, /WHATSAPP_EVENT_FEEDBACK_TEMPLATE_ID/);
});
