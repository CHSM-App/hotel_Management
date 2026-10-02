const test = require('node:test');
const assert = require('node:assert/strict');
const { roomStatusOf, linenStockOf } = require('../src/modules/housekeeping/housekeeping.service');

const cleaned = '2026-10-01T09:00:00Z';
const base = { last_cleaned_at: cleaned, needs_cleaning: 0, occupied: 0, out_of_order: 0, cleaning_started_at: null, last_checkout_at: null };

test('a room nobody has left since it was cleaned is READY', () => {
  assert.equal(roomStatusOf(base), 'READY');
  // Checked out BEFORE the last clean: already dealt with.
  assert.equal(roomStatusOf({ ...base, last_checkout_at: '2026-10-01T08:00:00Z' }), 'READY');
});

test('check-out after the last clean makes it DIRTY, with no change to check-out itself', () => {
  assert.equal(roomStatusOf({ ...base, last_checkout_at: '2026-10-01T11:00:00Z' }), 'DIRTY');
});

test('a manual needs-cleaning mark makes it DIRTY', () => {
  assert.equal(roomStatusOf({ ...base, needs_cleaning: 1 }), 'DIRTY');
});

test('status precedence: out of order > occupied > cleaning > dirty', () => {
  const dirty = { ...base, last_checkout_at: '2026-10-01T11:00:00Z' };
  assert.equal(roomStatusOf({ ...dirty, cleaning_started_at: '2026-10-01T12:00:00Z' }), 'CLEANING');
  assert.equal(roomStatusOf({ ...dirty, cleaning_started_at: '2026-10-01T12:00:00Z', occupied: 1 }), 'OCCUPIED');
  assert.equal(roomStatusOf({ ...dirty, occupied: 1, out_of_order: 1 }), 'OUT_OF_ORDER');
});

test('linen stock: changed-in-rooms is dirty, sent is in laundry, losses leave the lodge', () => {
  // 100 owned; 30 changed in rooms; 20 of those sent; 15 came back, 2 lost and 1 damaged at the laundry; 3 lost from store.
  const stock = linenStockOf({ total_owned: 100, changed: 30, sent: 20, received: 15, lost_laundry: 3, lost_all: 6 });
  assert.deepEqual(stock, { owned: 94, dirty: 10, inLaundry: 2, clean: 82, short: false, lostTotal: 6 });
});

test('linen stock of an item with no movements is all clean', () => {
  assert.deepEqual(linenStockOf({ total_owned: 40 }), { owned: 40, dirty: 0, inLaundry: 0, clean: 40, short: false, lostTotal: 0 });
});

test('sending more than was recorded dirty never shows a negative, and flags impossible counts', () => {
  // Nothing was counted as changed in rooms, 31 went out, only 24 owned.
  const stock = linenStockOf({ total_owned: 24, changed: 0, sent: 31 });
  assert.equal(stock.dirty, 0);
  assert.equal(stock.inLaundry, 31);
  assert.equal(stock.clean, 0);
  assert.equal(stock.short, true);
});
