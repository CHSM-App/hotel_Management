const test = require('node:test');
const assert = require('node:assert');

const { createEventSchema, updateEventSchema } = require('../src/modules/events/events.schema');

// Rooms wanted with a function are a need the desk writes down, and the form
// only has to be complete when the box is ticked: unticked, whatever is left
// in the fields is ignored.

const base = {
  eventType: 'WEDDING',
  title: 'Sharma–Patil reception',
  venueId: 1,
  startAt: '2026-11-12T18:00:00+05:30',
  endAt: '2026-11-12T23:00:00+05:30',
  organiserName: 'R. Sharma',
  organiserPhone: '9876543210',
  expectedPax: 200,
};

test('a function without rooms needs none of the rooms fields', () => {
  const parsed = createEventSchema.safeParse({ ...base, roomsRequired: false, roomsCount: '', roomsFrom: '' });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.roomsRequired, false);
  assert.equal(parsed.data.roomsCount, undefined);
});

test('ticking rooms asks for the count and the nights, in that order', () => {
  const firstMessage = (body) => createEventSchema.safeParse(body).error.issues[0];
  assert.deepEqual(firstMessage({ ...base, roomsRequired: true }).path, ['roomsCount']);
  assert.deepEqual(firstMessage({ ...base, roomsRequired: true, roomsCount: 4 }).path, ['roomsFrom']);
  assert.deepEqual(firstMessage({ ...base, roomsRequired: true, roomsCount: 4, roomsFrom: '2026-11-12' }).path, ['roomsTo']);
});

test('the rooms have to be wanted for at least one night', () => {
  const sameDay = createEventSchema.safeParse({ ...base, roomsRequired: true, roomsCount: 4, roomsFrom: '2026-11-12', roomsTo: '2026-11-12' });
  assert.equal(sameDay.success, false);
  assert.match(sameDay.error.issues[0].message, /at least one night/);

  const ok = createEventSchema.safeParse({ ...base, roomsRequired: true, roomsCount: 4, roomsFrom: '2026-11-12', roomsTo: '2026-11-14', roomsNotes: 'Two on the ground floor' });
  assert.equal(ok.success, true);
  assert.equal(ok.data.roomsCount, 4);
  assert.equal(ok.data.roomsNotes, 'Two on the ground floor');
});

test('an edit that says nothing about rooms leaves them alone, and one that does is checked', () => {
  const untouched = updateEventSchema.safeParse({ title: 'Renamed' });
  assert.equal(untouched.success, true);
  assert.equal(untouched.data.roomsRequired, undefined);

  const incomplete = updateEventSchema.safeParse({ roomsRequired: true, roomsCount: 2 });
  assert.equal(incomplete.success, false);
  assert.deepEqual(incomplete.error.issues[0].path, ['roomsFrom']);

  const cleared = updateEventSchema.safeParse({ roomsRequired: false });
  assert.equal(cleared.success, true);
});
