const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Same preamble as the other WhatsApp suites: the notifier pulls in the
// connection config at require time, so the environment has to be valid
// before it loads. None of these tests reach SQL Server or the provider.
process.env.DB_SERVER ||= 'localhost';
process.env.DB_PORT ||= '1433';
process.env.DB_NAME ||= 'lodge_test';
process.env.DB_USER ||= 'sa';
process.env.DB_PASSWORD ||= 'test';
process.env.JWT_SECRET ||= 'a'.repeat(40);
// Must be OFF for these tests: with a template id set the notifier would go
// looking for a database.
delete process.env.WHATSAPP_EVENT_CANCELLATION_TEMPLATE_ID;

const {
  buildCancellationSample,
  refundModeAmount,
  eventDate,
  clean,
  notifyEventCancelled,
} = require('../src/modules/notifications/eventCancellation');
const whatsapp = require('../src/config/whatsapp');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const lodge = { name: 'Sea View Lodge', phone: '02366-123456', whatsapp_number: '9876500000' };

// getEventBooking()'s mapped shape (camelCase) — what cancelEventBooking in
// events.service.js actually passes to notifyEventCancelled.
const event = {
  id: 7,
  organiserName: 'Sharma',
  organiserPhone: '9876543210',
  venueName: 'Lawn',
  startAt: '2026-09-12T12:30:00.000Z',
  cancelReason: 'Change of plans',
  refundAmount: 10000,
  refundPaymentMethod: 'UPI',
  cancellationCharge: null,
};

// ---------------------------------------------------------------------------
// The seven variables, in template order
// ---------------------------------------------------------------------------

test('a cancellation fills the seven template variables in order', () => {
  const sample = buildCancellationSample(event, lodge);
  assert.deepStrictEqual(sample, [
    'Sharma',
    'Sea View Lodge',
    'Lawn',
    '12 Sep 2026',
    '*Reason:* Change of plans',
    'Refund: Rs 10000.00 via UPI',
    '02366-123456',
  ]);
});

test('eventDate reads the calendar day the event starts, in IST', () => {
  assert.strictEqual(eventDate('2026-09-12T18:30:00.000Z'), '13 Sep 2026');
  assert.strictEqual(eventDate('2026-09-12T06:30:00.000Z'), '12 Sep 2026');
});

test('a cancellation charge fills the same slot when there is no refund', () => {
  const charged = { ...event, refundAmount: null, refundPaymentMethod: null, cancellationCharge: 2000 };
  assert.strictEqual(refundModeAmount(charged), 'Cancellation charge: Rs 2000.00 (adjusted against the advance held)');
});

test('neither a refund nor a charge reads as "No refund due"', () => {
  assert.strictEqual(refundModeAmount({ refundAmount: null, cancellationCharge: null }), 'No refund due');
  assert.strictEqual(refundModeAmount({ refundAmount: 0, cancellationCharge: 0 }), 'No refund due');
});

// Same guarantee as cancellationNotice.js's own reason slot: WhatsApp's
// template API rejects an empty body parameter, and the provider reports
// success at submission regardless — so this slot must never come out
// blank even when no reason was recorded.
test('a missing reason falls back to a placeholder, same as every other slot', () => {
  const sample = buildCancellationSample({ ...event, cancelReason: null }, lodge);
  assert.strictEqual(sample[4], '*Reason:* -');
});

test('a blank or whitespace-only reason also falls back to a placeholder', () => {
  const sample = buildCancellationSample({ ...event, cancelReason: '   ' }, lodge);
  assert.strictEqual(sample[4], '*Reason:* -');
});

test('no value ever carries a comma — it is the variable separator', () => {
  const messy = { ...event, cancelReason: 'Family, emergency', organiserName: 'A, B' };
  for (const value of buildCancellationSample(messy, { name: 'Hotel Sai, Vengurla' })) {
    assert.ok(!value.includes(','), `comma in "${value}"`);
  }
});

test('clean() collapses whitespace, replaces commas, and never yields an empty variable', () => {
  assert.strictEqual(clean('  Family,  emergency '), 'Family - emergency');
  assert.strictEqual(clean(''), '-');
  assert.strictEqual(clean(null), '-');
});

test('the property phone falls back to its WhatsApp number', () => {
  assert.strictEqual(buildCancellationSample(event, { ...lodge, phone: null })[6], '9876500000');
  assert.strictEqual(buildCancellationSample(event, { ...lodge, phone: null, whatsapp_number: null })[6], '-');
});

// ---------------------------------------------------------------------------
// Off unless configured, and never throwing
// ---------------------------------------------------------------------------

test('with no template configured the notifier skips without touching the database', async () => {
  assert.strictEqual(whatsapp.isEventCancellationTemplateConfigured(), false);
  assert.deepStrictEqual(await notifyEventCancelled(1, event), { status: 'skipped', reason: 'not configured' });
});

// ---------------------------------------------------------------------------
// Where it fires from
// ---------------------------------------------------------------------------

test('a cancelled function fires the notice and reports its result on the response', () => {
  const events = read('src/modules/events/events.service.js');
  assert.match(events, /await eventCancellation\.notifyEventCancelled\(lodgeId, updated\)/);
  assert.match(events, /return \{ \.\.\.updated, whatsapp: whatsappResult \};/);
});

test('.env.example documents the event cancellation template', () => {
  assert.match(read('.env.example'), /^WHATSAPP_EVENT_CANCELLATION_TEMPLATE_ID=/m);
});
