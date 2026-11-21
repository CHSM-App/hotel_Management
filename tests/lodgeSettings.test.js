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

const { settingOn, settingsFromRow, SETTING_DEFAULTS, SETTING_FIELDS } = require('../src/config/lodgeSettings');
const { settingsSchema } = require('../src/modules/me/me.schema');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('migration 162 and schema.sql both create lodge_settings with every column', () => {
  for (const file of ['migrations/162_lodge_settings.sql', 'src/config/schema.sql']) {
    const text = read(file);
    assert.match(text, /dbo\.lodge_settings/);
    for (const col of Object.keys(SETTING_DEFAULTS)) assert.ok(text.includes(col), `${file} lacks ${col}`);
  }
});

test('migration 162 is additive: it never alters dbo.lodges', () => {
  const text = read('migrations/162_lodge_settings.sql');
  assert.doesNotMatch(text, /ALTER\s+TABLE\s+dbo\.lodges/i);
  assert.doesNotMatch(text, /UPDATE\s+dbo\.lodges/i);
  assert.doesNotMatch(text, /DROP\s/i);
});

test('defaults equal the behaviour before the table existed', () => {
  assert.deepStrictEqual(SETTING_DEFAULTS, {
    wa_auto_bill: 1,
    wa_auto_receipt: 0,
    wa_auto_booking: 1,
    wa_auto_walkin: 1,
    wa_auto_cancel: 1,
  });
});

test('a missing value falls back to the default; a stored one wins', () => {
  assert.strictEqual(settingOn(undefined, 'wa_auto_booking'), true);
  assert.strictEqual(settingOn({}, 'wa_auto_receipt'), false);
  assert.strictEqual(settingOn({ wa_auto_booking: 0 }, 'wa_auto_booking'), false);
  assert.strictEqual(settingOn({ wa_auto_receipt: 1 }, 'wa_auto_receipt'), true);
});

test('settingsFromRow maps every column to its camelCase field', () => {
  const out = settingsFromRow({ wa_auto_cancel: 0 });
  assert.deepStrictEqual(Object.keys(out), Object.keys(SETTING_FIELDS));
  assert.strictEqual(out.waAutoCancel, false);
  assert.strictEqual(out.waAutoBill, true);
});

test('the settings schema accepts the five switches and rejects anything else', () => {
  assert.ok(settingsSchema.safeParse({ waAutoBill: false }).success);
  assert.ok(!settingsSchema.safeParse({ lodgeId: 2 }).success);
  assert.ok(!settingsSchema.safeParse({ waAutoBill: 'no' }).success);
});

test('the auto sends are gated, and the manual path is not', () => {
  assert.match(read('src/modules/notifications/bookingConfirmation.js'), /!manual && !settingOn\(lodge, 'wa_auto_booking'\)/);
  assert.match(read('src/modules/notifications/checkinWelcome.js'), /walkIn && !manual && !settingOn\(lodge, 'wa_auto_walkin'\)/);
  assert.match(read('src/modules/notifications/cancellationNotice.js'), /!manual && !settingOn\(lodge, 'wa_auto_cancel'\)/);
  assert.match(read('src/modules/bookings/bookings.service.js'), /notifyStayBooked\(lodgeId, bookingId, \{ manual: true \}\)[\s\S]*notifyCheckedIn\(lodgeId, booking, \{ walkIn: true, manual: true \}\)|notifyCheckedIn\(lodgeId, booking, \{ walkIn: true, manual: true \}\)[\s\S]*notifyStayBooked\(lodgeId, bookingId, \{ manual: true \}\)/);
});
