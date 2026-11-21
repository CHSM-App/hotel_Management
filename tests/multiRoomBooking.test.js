const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { apportionDiscount, mergeRoomNights, rollUpStatus } = require('../src/modules/bookings/bookingRooms');

test('a concession is split in proportion and sums exactly', () => {
  const shares = apportionDiscount([1000, 2000, 3000], 100);
  assert.deepStrictEqual(shares, [16.67, 33.33, 50]);
  assert.strictEqual(Math.round(shares.reduce((a, b) => a + b, 0) * 100), 10000);
});

test('no concession or no gross means no shares', () => {
  assert.deepStrictEqual(apportionDiscount([500, 500], 0), [0, 0]);
  assert.deepStrictEqual(apportionDiscount([0, 0], 50), [0, 0]);
});

const night = (date, total, label = 'Room rate') => ({ date, total, lines: [{ label, amount: total }] });

test('a single room keeps its snapshot untouched', () => {
  const nights = [night('2026-10-01', 1000)];
  assert.strictEqual(mergeRoomNights([{ roomNumber: '101', nights }]), nights);
});

test('several rooms give one entry per room per night, labelled by room', () => {
  const merged = mergeRoomNights([
    { roomNumber: '101', nights: [night('2026-10-01', 1000), night('2026-10-02', 1000)] },
    { roomNumber: '102', nights: [night('2026-10-02', 2500)] },
  ]);
  assert.strictEqual(merged.length, 3);
  assert.strictEqual(merged[0].lines[0].label, 'Room 101 · Room rate');
  assert.strictEqual(merged[2].lines[0].label, 'Room 102 · Room rate');
  assert.strictEqual(merged.reduce((s, n) => s + n.total, 0), 4500);
});

test('booking status follows its rooms', () => {
  assert.strictEqual(rollUpStatus(['BOOKED', 'BOOKED']), 'BOOKED');
  assert.strictEqual(rollUpStatus(['CHECKED_IN', 'BOOKED']), 'CHECKED_IN');
  assert.strictEqual(rollUpStatus(['CHECKED_OUT', 'BOOKED']), 'CHECKED_IN');
  assert.strictEqual(rollUpStatus(['CHECKED_OUT', 'CHECKED_IN']), 'CHECKED_IN');
  assert.strictEqual(rollUpStatus(['CHECKED_OUT', 'CHECKED_OUT']), 'CHECKED_OUT');
  assert.strictEqual(rollUpStatus(['CANCELLED', 'CHECKED_OUT']), 'CHECKED_OUT');
  assert.strictEqual(rollUpStatus(['CANCELLED']), 'CANCELLED');
});

// ---- the booking form's helpers (frontend/src/pages/lodge/multiRoom.js) -----

const { pathToFileURL } = require('url');
const helpersUrl = pathToFileURL(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'lodge', 'multiRoom.js')
).href;

const baseForm = {
  roomId: '12',
  bedIds: [],
  checkInDate: '2026-10-01',
  checkOutDate: '2026-10-04',
  basePriceOverride: '',
  switchableCharges: [{ id: 3, quantity: '2', agreedAmount: '' }],
  primaryBookingRoomId: null,
  sameDates: true,
  extraRooms: [],
};

test('the stay window spans every picked room, and follows the form when dates are shared', async () => {
  const { bookingWindow } = await import(helpersUrl);
  const own = { roomId: '15', checkInDate: '2026-09-30', checkOutDate: '2026-10-06', bedIds: [], switchableCharges: [] };
  const blank = { roomId: '', checkInDate: '2026-01-01', checkOutDate: '2026-12-31', bedIds: [], switchableCharges: [] };

  // Own dates: earliest arrival to latest departure. An unpicked card counts for nothing.
  assert.deepStrictEqual(bookingWindow({ ...baseForm, sameDates: false, extraRooms: [own, blank] }), {
    checkInDate: '2026-09-30',
    checkOutDate: '2026-10-06',
  });
  // Shared dates: the card's own (stale) dates are ignored.
  assert.deepStrictEqual(bookingWindow({ ...baseForm, sameDates: true, extraRooms: [own] }), {
    checkInDate: '2026-10-01',
    checkOutDate: '2026-10-04',
  });
});

test('the rooms payload carries each room\'s dates, beds, extras and agreed rate', async () => {
  const { roomsPayload } = await import(helpersUrl);
  const rooms = roomsPayload({
    ...baseForm,
    primaryBookingRoomId: 7,
    sameDates: false,
    extraRooms: [
      {
        bookingRoomId: 8,
        roomId: '15',
        bedIds: ['4', '5'],
        checkInDate: '2026-10-02',
        checkOutDate: '2026-10-03',
        basePriceOverride: '1800',
        switchableCharges: [],
      },
    ],
  });
  assert.deepStrictEqual(rooms, [
    {
      bookingRoomId: 7,
      roomId: 12,
      bedIds: [],
      checkInDate: '2026-10-01',
      checkOutDate: '2026-10-04',
      basePriceOverride: null,
      switchableCharges: [{ id: 3, quantity: 2 }],
    },
    {
      bookingRoomId: 8,
      roomId: 15,
      bedIds: [4, 5],
      checkInDate: '2026-10-02',
      checkOutDate: '2026-10-03',
      basePriceOverride: 1800,
      switchableCharges: [],
    },
  ]);
});

test('a several-room quote folds into the one shape the form reads', async () => {
  const { combineQuote } = await import(helpersUrl);
  const line = (label, amount, extra = {}) => ({ label, amount, isBase: false, ...extra });
  const quote = combineQuote(
    {
      rooms: [
        { nights: [{ date: 'a' }, { date: 'b' }], charges: [line('Room rate', 2000, { isBase: true })] },
        { nights: [{ date: 'b' }, { date: 'c' }], charges: [line('Room rate', 3000)] },
      ],
      grossTotal: 5000,
      discountAmount: 0,
      totalPrice: 5000,
    },
    ['101', '102']
  );
  assert.strictEqual(quote.totalPrice, 5000);
  // The first room's lines stay as they were (its rate is editable); the others are labelled.
  assert.strictEqual(quote.charges[0].isBase, true);
  assert.strictEqual(quote.charges[1].label, 'Room 102 · Room rate');
  assert.strictEqual(quote.charges[1].isBase, false);
  // Nights are the distinct dates across rooms, not their sum.
  assert.strictEqual(quote.nights.length, 3);
});

// ---- ticking rooms in the shared-dates list ----------------------------------

const row = (id, n) => ({ id, roomNumber: n, maxOccupancy: 2, isDormitory: false, categoryName: 'Deluxe' });
const empty = { ...baseForm, roomId: '', extraRooms: [], bedIds: [], switchableCharges: [], basePriceOverride: '' };

test('ticking rooms fills the first slot, then adds a card for each further room', async () => {
  const { toggleRoomChoice, pickedRoomIds } = await import(helpersUrl);
  let f = toggleRoomChoice(empty, row(1, '101'));
  assert.strictEqual(f.roomId, '1');
  assert.strictEqual(f.extraRooms.length, 0);
  f = toggleRoomChoice(f, row(2, '102'));
  f = toggleRoomChoice(f, row(3, '201'));
  assert.deepStrictEqual(pickedRoomIds(f), ['1', '2', '3']);
  assert.strictEqual(f.extraRooms[0].meta.roomNumber, '102');
  // The card starts on the form's dates.
  assert.strictEqual(f.extraRooms[0].checkInDate, '2026-10-01');
});

test('unticking a further room takes only that room off', async () => {
  const { toggleRoomChoice, pickedRoomIds } = await import(helpersUrl);
  let f = toggleRoomChoice(toggleRoomChoice(toggleRoomChoice(empty, row(1, '101')), row(2, '102')), row(3, '201'));
  f = toggleRoomChoice(f, row(2, '102'));
  assert.deepStrictEqual(pickedRoomIds(f), ['1', '3']);
});

test('unticking the first room moves the next one into its place, with its own choices', async () => {
  const { toggleRoomChoice, pickedRoomIds } = await import(helpersUrl);
  let f = toggleRoomChoice(toggleRoomChoice(empty, row(1, '101')), row(2, '102'));
  f = { ...f, extraRooms: [{ ...f.extraRooms[0], bedIds: ['9'], basePriceOverride: '1800', bookingRoomId: 55, status: 'BOOKED' }] };
  f = toggleRoomChoice(f, row(1, '101'));
  assert.deepStrictEqual(pickedRoomIds(f), ['2']);
  assert.strictEqual(f.roomId, '2');
  assert.deepStrictEqual(f.bedIds, ['9']);
  assert.strictEqual(f.basePriceOverride, '1800');
  assert.strictEqual(f.primaryBookingRoomId, 55);
  assert.strictEqual(f.extraRooms.length, 0);
});

test('unticking the only room leaves nothing chosen', async () => {
  const { toggleRoomChoice, pickedRoomIds } = await import(helpersUrl);
  const f = toggleRoomChoice(toggleRoomChoice(empty, row(1, '101')), row(1, '101'));
  assert.deepStrictEqual(pickedRoomIds(f), []);
  assert.strictEqual(f.roomId, '');
});

test('a concession is cleared whenever the set of rooms changes', async () => {
  const { toggleRoomChoice } = await import(helpersUrl);
  const withDiscount = { ...toggleRoomChoice(empty, row(1, '101')), discountAmount: '200', discountPercent: '5', discountSource: 'AMOUNT' };
  const f = toggleRoomChoice(withDiscount, row(2, '102'));
  assert.strictEqual(f.discountAmount, '');
  assert.strictEqual(f.discountSource, '');
});
