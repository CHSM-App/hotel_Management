const test = require('node:test');
const assert = require('node:assert');

process.env.DB_SERVER ||= 'localhost';
process.env.DB_PORT ||= '1433';
process.env.DB_NAME ||= 'lodge_test';
process.env.DB_USER ||= 'sa';
process.env.DB_PASSWORD ||= 'test';
process.env.JWT_SECRET ||= 'a'.repeat(40);
delete process.env.WHATSAPP_WALKIN_TEMPLATE_ID;
delete process.env.WHATSAPP_CHECKIN_TEMPLATE_ID;

const { buildWalkinSample, notifyCheckedIn } = require('../src/modules/notifications/checkinWelcome');
const whatsapp = require('../src/config/whatsapp');

const lodge = { name: 'Sea View Lodge', phone: '9123456780', whatsappNumber: null };
const booking = {
  id: 41,
  guestName: 'Rahul Patil',
  guestPhone: '9876543210',
  roomNumbers: '204, 205',
  bookingNumber: 'AB12CD',
  checkOutDate: '2026-09-14',
  advanceAmount: 1000,
  totalPrice: 2500,
  actualCheckInAt: '2026-09-12T04:30:00.000Z', // 10:00 AM IST
};

test('nine values, in template order, balance = total - advance', () => {
  const s = buildWalkinSample(booking, lodge, null, 'https://x.test/r/abc');
  assert.strictEqual(s.length, 10);
  assert.strictEqual(s[0], 'Rahul Patil');
  assert.strictEqual(s[1], 'Sea View Lodge');
  assert.strictEqual(s[2], '204 - 205'); // comma would shift every later slot
  assert.match(s[3], /12 Sep 2026 10:00 AM/);
  assert.strictEqual(s[4], '14 Sep 2026');
  assert.strictEqual(s[5], '1000.00');
  assert.strictEqual(s[6], '1500.00');
  assert.match(s[7], /https:\/\/x\.test\/r\/abc/);
  assert.strictEqual(s[8], '9123456780');
  assert.strictEqual(s[9], 'AB12CD');
  assert.strictEqual(s.join(',').split(',').length, 10);
});

test('no advance, no link: receipt slot is blank but never empty', () => {
  const s = buildWalkinSample({ ...booking, advanceAmount: null }, lodge, null, null);
  assert.strictEqual(s[5], '0.00');
  assert.strictEqual(s[6], '2500.00');
  assert.strictEqual(s[7], '​'); // zero-width space: provider rejects empty, guest sees nothing
});

test('walk-in with no walk-in template and no welcome template is skipped', async () => {
  assert.strictEqual(whatsapp.isWalkinTemplateConfigured(), false);
  const r = await notifyCheckedIn(1, booking, { walkIn: true });
  assert.strictEqual(r.status, 'skipped');
});
