const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

process.env.DB_SERVER ||= 'localhost';
process.env.DB_PORT ||= '1433';
process.env.DB_NAME ||= 'lodge_test';
process.env.DB_USER ||= 'sa';
process.env.DB_PASSWORD ||= 'test';
process.env.JWT_SECRET ||= 'a'.repeat(40);
delete process.env.WHATSAPP_CHECKOUT_TEMPLATE_ID;

const { buildCheckoutSample, notifyCheckedOut } = require('../src/modules/notifications/checkoutThanks');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('a checkout fills the five template variables in order', () => {
  const booking = { guestName: 'Rahul Patil', actualCheckOutAt: '2026-11-14T05:30:00Z' };
  const lodge = { name: 'Sea View Lodge', phone: '9123456780' };
  assert.deepStrictEqual(buildCheckoutSample(booking, lodge, 4130.5), [
    'Rahul Patil',
    'Sea View Lodge',
    '14 Nov 2026 11:00 AM',
    '4130.50',
    '9123456780',
  ]);
});

test('with no template configured the notifier skips without touching the database', async () => {
  assert.deepStrictEqual(await notifyCheckedOut(1, { status: 'CHECKED_OUT' }), {
    status: 'skipped',
    reason: 'not configured',
  });
});

test('a checkout fires the thank-you, fire-and-forget', () => {
  assert.match(read('src/modules/bookings/bookings.service.js'), /void checkoutThanks\.notifyCheckedOut\(lodgeId, booking\)/);
  assert.match(read('.env.example'), /^WHATSAPP_CHECKOUT_TEMPLATE_ID=/m);
});
