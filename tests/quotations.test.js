const test = require('node:test');
const assert = require('node:assert');
const { quotationState } = require('../src/modules/quotations/quotations.service');

// A quotation holds through its earliest check-in date and expires the day after.
test('quotation is active through its check-in date', () => {
  assert.strictEqual(quotationState('ACTIVE', '2026-12-10', '2026-12-09'), 'ACTIVE');
  assert.strictEqual(quotationState('ACTIVE', '2026-12-10', '2026-12-10'), 'ACTIVE');
  assert.strictEqual(quotationState('ACTIVE', '2026-12-10', '2026-12-11'), 'EXPIRED');
});

test('a booked quotation stays booked past its check-in date', () => {
  assert.strictEqual(quotationState('BOOKED', '2026-01-01', '2026-12-31'), 'BOOKED');
});

test('Date objects from the driver compare by their calendar day', () => {
  assert.strictEqual(quotationState('ACTIVE', new Date('2026-12-10T00:00:00.000Z'), '2026-12-09'), 'ACTIVE');
  assert.strictEqual(quotationState('ACTIVE', new Date('2026-12-10T00:00:00.000Z'), '2026-12-11'), 'EXPIRED');
});

const { createQuotationSchema } = require('../src/modules/quotations/quotations.schema');
const { allowedKinds } = require('../src/modules/quotations/quotations.service');

test('a body with no kind is still a room quotation', () => {
  const r = createQuotationSchema.safeParse({ rooms: [{ roomId: 1, fromDate: '2030-01-01', toDate: '2030-01-02' }] });
  assert.ok(r.success);
  assert.strictEqual(r.data.kind, 'ROOM');
});

test('food and bar quotations take item ids and quantities, not prices', () => {
  const food = createQuotationSchema.safeParse({ kind: 'FOOD', items: [{ itemId: 3, quantity: 2, price: 1 }] });
  assert.ok(food.success);
  assert.strictEqual(food.data.items[0].price, undefined);
  assert.ok(createQuotationSchema.safeParse({ kind: 'BAR', items: [{ menuItemId: 4, quantity: 1 }] }).success);
  assert.ok(!createQuotationSchema.safeParse({ kind: 'BAR', items: [] }).success);
  assert.ok(!createQuotationSchema.safeParse({ kind: 'HOTEL' }).success);
});

test('non-room quotations hold through their valid-until day', () => {
  assert.strictEqual(quotationState('ACTIVE', '2026-12-10', '2026-12-10'), 'ACTIVE');
  assert.strictEqual(quotationState('ACTIVE', '2026-12-10', '2026-12-11'), 'EXPIRED');
});

test('each kind is gated by its own module permission', () => {
  assert.deepStrictEqual(allowedKinds(['events.manage']), ['EVENT']);
  assert.deepStrictEqual(allowedKinds(['bookings.manage', 'bar.take']), ['ROOM', 'BAR']);
  assert.deepStrictEqual(allowedKinds(['orders.take']), ['FOOD']);
  assert.deepStrictEqual(allowedKinds([]), []);
});

test('a shared quotation link must look like a token before the database is asked', async () => {
  const { readSharedQuotation } = require('../src/modules/quotations/quotations.service');
  await assert.rejects(() => readSharedQuotation("x'; DROP TABLE a;--"), /not valid/);
  await assert.rejects(() => readSharedQuotation('short'), /not valid/);
});

test('the WhatsApp details line is one line with no commas', () => {
  const { describeQuotation } = require('../src/modules/quotations/quotations.service');
  const food = { kind: 'FOOD', payload: JSON.stringify({ lines: [{ itemName: 'Paneer Tikka', quantity: 4 }, { itemName: 'Rum 60 ml', quantity: 6 }] }) };
  assert.strictEqual(describeQuotation(food), 'Paneer Tikka x4; Rum 60 ml x6');
  const room = { kind: 'ROOM', payload: JSON.stringify([{ roomNumber: '101', categoryName: 'Deluxe', fromDate: '2030-01-01', toDate: '2030-01-03' }]) };
  assert.ok(!/[\n,]/.test(describeQuotation(room)));
});
