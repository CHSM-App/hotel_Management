const test = require('node:test');
const assert = require('node:assert');
const { createRoomSchema, updateRoomSchema } = require('../src/modules/rooms/rooms.schema');

// A room's beds arrive as a JSON string (the room form is multipart, because it
// carries photo uploads, and every text field in a multipart body is a string).
// These cover the parse and the bounds — the part that decides whether a bad
// value becomes a validation message or an exception inside the service.

const VALID = {
  categoryId: '1',
  floor: '2',
  bathroomType: 'ATTACHED',
  maxOccupancy: '4',
  roomNumber: '205',
};

const parse = (beds) => createRoomSchema.safeParse({ ...VALID, beds });

test('accepts several bed types in one room', () => {
  const r = parse('[{"size":"DOUBLE","count":1},{"size":"SINGLE","count":2}]');
  assert.ok(r.success, JSON.stringify(r.error?.issues));
  assert.deepStrictEqual(r.data.beds, [
    { size: 'DOUBLE', count: 1 },
    { size: 'SINGLE', count: 2 },
  ]);
});

test('accepts an already-parsed array, so a JSON client works too', () => {
  const r = createRoomSchema.safeParse({ ...VALID, beds: [{ size: 'KING', count: 1 }] });
  assert.ok(r.success, JSON.stringify(r.error?.issues));
});

test('a room must have at least one bed', () => {
  assert.ok(!parse('[]').success);
});

test('malformed JSON is a validation message, not a thrown parse error', () => {
  // The whole reason parsing happens in the schema rather than the service.
  assert.doesNotThrow(() => parse('{not json'));
  assert.ok(!parse('{not json').success);
});

test('rejects a bed size outside the four the property sells', () => {
  assert.ok(!parse('[{"size":"BUNK","count":1}]').success);
});

test('rejects counts that are a slipped keystroke rather than a room', () => {
  assert.ok(!parse('[{"size":"SINGLE","count":0}]').success, 'zero beds of a size is not a bed');
  assert.ok(!parse('[{"size":"SINGLE","count":99}]').success, '99 beds in one room is a typo');
});

test('editing a room takes the same bed list as adding one', () => {
  // The edit form resubmits every field, so a shape accepted on create and
  // rejected on update would strand the room on its next save.
  const r = updateRoomSchema.safeParse({
    roomNumber: '205',
    categoryId: '1',
    floor: '2',
    bathroomType: 'ATTACHED',
    maxOccupancy: '4',
    beds: '[{"size":"DOUBLE","count":1},{"size":"SINGLE","count":2}]',
  });
  assert.ok(r.success, JSON.stringify(r.error?.issues));
  assert.strictEqual(r.data.beds.length, 2);
});

test('bed_size stays derivable from the first bed, for the four readers of it', () => {
  // The public room-type page, the booking chip, the price simulator and the
  // room card all still read rooms.bed_size. It is written from beds[0].
  const service = require('fs').readFileSync(
    require.resolve('../src/modules/rooms/rooms.service.js'),
    'utf8'
  );
  assert.match(service, /function primaryBedSize/);
  assert.ok(
    !/input\('bedSize', sql\.NVarChar, input\.bedSize/.test(service),
    'bed_size is being written from caller input again instead of derived from beds'
  );
});

test('the booking form gets the same bed list the rooms screen does', () => {
  // The booking form lists rooms through bookings.service, not rooms.service.
  // Its two queries are easy to leave behind when the column is added, and the
  // symptom is a room that shows one bed on one screen and three on another.
  const fs = require('fs');
  const src = fs.readFileSync(
    require.resolve('../src/modules/bookings/bookings.service.js'),
    'utf8'
  );
  const selects = src.split('r.bed_size, r.beds,').length - 1;
  assert.strictEqual(selects, 2, 'both available-rooms queries should select r.beds');
  assert.strictEqual(
    src.split('beds: parseBeds(row)').length - 1,
    2,
    'both available-rooms mappers should return the parsed bed list'
  );
  // Reused rather than restated, so the legacy fallback cannot drift apart.
  assert.match(src, /require\('\.\.\/rooms\/rooms\.service'\)/);
});
