const test = require('node:test');
const assert = require('node:assert');

const { priceEvent, billablePax } = require('../src/modules/events/eventPricing');

// How a function is quoted, in the owner's words: the hall is one charge, the
// food is so much a plate for however many come — but never fewer than they
// promised — and the extras are whatever was agreed for each.

test('catering is billed on the larger of the head count and the guarantee', () => {
  assert.equal(billablePax({ expectedPax: 150, guaranteedPax: 200, finalPax: null }), 200);
  assert.equal(billablePax({ expectedPax: 150, guaranteedPax: 100, finalPax: null }), 150);
  // Once the final count is in it replaces the estimate, still floored.
  assert.equal(billablePax({ expectedPax: 150, guaranteedPax: 100, finalPax: 120 }), 120);
  assert.equal(billablePax({ expectedPax: 150, guaranteedPax: 100, finalPax: 80 }), 100);
});

test('a quote is hall plus plates plus add-ons, less the concession', () => {
  const q = priceEvent({
    venueCharge: 25000,
    perPlateRate: 450,
    expectedPax: 200,
    guaranteedPax: 180,
    addons: [
      { label: 'DJ', quantity: 1, unitAmount: 8000 },
      { label: 'Chairs', quantity: 100, unitAmount: 20 },
    ],
    discountAmount: 5000,
  });
  assert.equal(q.billablePax, 200);
  assert.equal(q.cateringAmount, 90000);
  assert.equal(q.addonsTotal, 10000);
  assert.equal(q.venueSubtotal, 35000);
  assert.equal(q.grossAmount, 125000);
  assert.equal(q.discountAmount, 5000);
  assert.equal(q.totalAmount, 120000);
});

test('an agreed amount on an add-on is the whole line, not per unit', () => {
  const q = priceEvent({
    venueCharge: 0,
    addons: [{ label: 'Chairs', quantity: 100, unitAmount: 20, agreedAmount: 1500 }],
  });
  assert.equal(q.addonsTotal, 1500);
});

test('the concession is capped at what there is to take it off', () => {
  const q = priceEvent({ venueCharge: 10000, discountAmount: 25000 });
  assert.equal(q.discountAmount, 10000);
  assert.equal(q.totalAmount, 0);
  // And a negative one is a typo, not a surcharge.
  assert.equal(priceEvent({ venueCharge: 10000, discountAmount: -500 }).totalAmount, 10000);
});

test('the lines carry which side of the tax they sit on', () => {
  const q = priceEvent({ venueCharge: 1000, perPlateRate: 100, expectedPax: 10, addons: [{ label: 'DJ', quantity: 1, unitAmount: 500 }] });
  assert.deepEqual(
    q.lines.map((l) => [l.label, l.amount, l.side]),
    [
      ['Venue hire', 1000, 'VENUE'],
      ['Catering', 1000, 'FOOD'],
      ['DJ', 500, 'VENUE'],
    ]
  );
});

test('no catering means no catering line', () => {
  const q = priceEvent({ venueCharge: 5000, expectedPax: 50 });
  assert.equal(q.cateringAmount, 0);
  assert.ok(!q.lines.some((l) => l.side === 'FOOD'));
});

test('money is kept to the paisa', () => {
  const q = priceEvent({ venueCharge: 0, perPlateRate: 333.33, expectedPax: 3 });
  assert.equal(q.cateringAmount, 999.99);
});
