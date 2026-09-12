const test = require('node:test');
const assert = require('node:assert');

const { extraSchema, priceExtraSchema, updateEventSchema } = require('../src/modules/events/events.schema');
const { priceEvent } = require('../src/modules/events/eventPricing');

// An extra asked for on the day is written down first and priced when it is
// agreed; until then it stands on the function at nothing, as a reminder.

test('an extra needs a name; the quantity defaults and the price can wait', () => {
  const noName = extraSchema.safeParse({ quantity: 50 });
  assert.equal(noName.success, false);
  assert.match(noName.error.issues[0].message, /what the extra is/);

  const later = extraSchema.safeParse({ label: 'Extra chairs', quantity: '50' });
  assert.equal(later.success, true);
  assert.equal(later.data.quantity, 50);
  assert.equal(later.data.agreedAmount, undefined);

  const now = extraSchema.safeParse({ label: 'Second mic', agreedAmount: '500' });
  assert.equal(now.success, true);
  assert.equal(now.data.quantity, 1);
  assert.equal(now.data.agreedAmount, 500);
});

test('pricing an extra takes a real amount', () => {
  assert.equal(priceExtraSchema.safeParse({}).success, false);
  assert.equal(priceExtraSchema.safeParse({ agreedAmount: '' }).success, false);
  assert.equal(priceExtraSchema.safeParse({ agreedAmount: 0 }).success, true);
  assert.equal(priceExtraSchema.safeParse({ agreedAmount: '1500' }).data.agreedAmount, 1500);
});

test('the extra flags ride through an edit of the add-on list', () => {
  const parsed = updateEventSchema.safeParse({
    addons: [
      { label: 'DJ', quantity: 1, agreedAmount: 8000 },
      { label: 'Extra chairs', quantity: 50, isExtra: true, needsPricing: true, notedAt: '2026-09-05T13:00:00.000Z' },
    ],
  });
  assert.equal(parsed.success, true);
  const [dj, chairs] = parsed.data.addons;
  assert.equal(dj.isExtra, undefined);
  assert.equal(chairs.isExtra, true);
  assert.equal(chairs.needsPricing, true);
  assert.equal(chairs.notedAt, '2026-09-05T13:00:00.000Z');
});

test('an unpriced extra adds nothing to the total until it is priced', () => {
  const before = priceEvent({ venueCharge: 10000, addons: [{ label: 'Extra chairs', quantity: 50, unitAmount: 0, agreedAmount: 0 }] });
  assert.equal(before.addonsTotal, 0);
  assert.equal(before.totalAmount, 10000);
  const after = priceEvent({ venueCharge: 10000, addons: [{ label: 'Extra chairs', quantity: 50, unitAmount: 30, agreedAmount: 1500 }] });
  assert.equal(after.addonsTotal, 1500);
  assert.equal(after.totalAmount, 11500);
});
