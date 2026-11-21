const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseClientTime } = require('../src/modules/bookings/clientTime');
const { checkInSchema } = require('../src/modules/bookings/bookings.schema');
const { issueInvoiceSchema } = require('../src/modules/billing/billing.schema');

const NOW = Date.parse('2026-11-17T10:00:00Z');
const src = (p) => fs.readFileSync(path.join(__dirname, '../src/modules', p), 'utf8');

test('absent means "use the server clock"', () => {
  assert.equal(parseClientTime(undefined, 'x', NOW), null);
  assert.equal(parseClientTime('', 'x', NOW), null);
});
test('a real past time is kept exactly', () => {
  assert.equal(parseClientTime('2026-11-17T08:10:00.000Z', 'x', NOW).toISOString(), '2026-11-17T08:10:00.000Z');
});
test('garbage, the future and the very old are refused', () => {
  assert.throws(() => parseClientTime('nope', 'The time', NOW), /not a valid/);
  assert.throws(() => parseClientTime('2026-11-17T10:06:00Z', 'The time', NOW), /future/);
  assert.doesNotThrow(() => parseClientTime('2026-11-17T10:04:00Z', 'The time', NOW));
  assert.throws(() => parseClientTime('2026-10-01T00:00:00Z', 'The time', NOW), /30 days/);
});
test('schemas accept the new fields', () => {
  assert.equal(checkInSchema.safeParse({ checkedInAt: '2026-11-17T08:10:00Z' }).success, true);
  const r = issueInvoiceSchema.safeParse({ collectedAmount: 0, checkedOutAt: 'a', invoiceAt: 'b' });
  assert.equal(r.success, true);
});
test('check-in writes the supplied time and judges the date by it', () => {
  const s = src('bookings/bookings.service.js');
  assert.match(s, /actual_check_in_at = COALESCE\(@at, SYSDATETIMEOFFSET\(\)\)/);
  assert.match(s, /input\.checkedInAt \? lateCheckout\.isoDateInLodgeZone\(input\.checkedInAt\)/);
});
test('settle passes the times through, never billing before departure', () => {
  const c = src('billing/billing.controller.js');
  assert.match(c, /settle: \{ lateCharge: data\.lateCharge, checkedOutAt, invoiceAt \}/);
  assert.match(c, /invoiceAt < checkedOutAt/);
  assert.match(src('billing/billing.service.js'), /prepareCheckOut\(lodgeId, bookingId, roomId, input\.checkedOutAt/);
});
