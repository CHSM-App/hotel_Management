const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createBookingSchema } = require('../src/modules/bookings/bookings.schema');

// A guest is registered by their ID. Until now the only way to record one was
// to upload a scan, which a desk without a scanner cannot do — so the number
// typed off the card is accepted as the second way. These check the half of
// that rule that is a branch: what counts as "given", and what the guard in
// bookings.controller.js is allowed to accept as satisfying it.

const base = {
  roomId: 1,
  checkInDate: '2026-01-01',
  checkOutDate: '2026-01-02',
  guestName: 'A',
  guestPhone: '9000000000',
};

test('an ID number is accepted, trimmed', () => {
  const parsed = createBookingSchema.safeParse({
    ...base,
    idProofType: 'AADHAAR',
    idProofNumber: '  1234 5678 9012  ',
  });
  assert.ok(parsed.success, parsed.error?.issues[0]?.message);
  assert.strictEqual(parsed.data.idProofNumber, '1234 5678 9012');
});

test('an untouched input reads as "not given", not as an empty ID', () => {
  // Load-bearing: the writes use COALESCE(@idProofNumber, id_proof_number), so
  // undefined leaves what is on file alone. If '' survived as a string it would
  // overwrite a real number with a blank every time an unrelated field was
  // edited.
  const parsed = createBookingSchema.safeParse({ ...base, idProofNumber: '' });
  assert.ok(parsed.success, parsed.error?.issues[0]?.message);
  assert.strictEqual(parsed.data.idProofNumber, undefined);
});

test('an over-long ID number is rejected', () => {
  const parsed = createBookingSchema.safeParse({ ...base, idProofNumber: 'X'.repeat(51) });
  assert.ok(!parsed.success);
  assert.match(parsed.error.issues[0].message, /too long/);
});

test('the walk-in guard treats a number as proof, and a bare type as none', () => {
  // The rule itself is one expression in the controller; this pins its shape so
  // a refactor cannot quietly drop the number and go back to upload-only.
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'modules', 'bookings', 'bookings.controller.js'),
    'utf8'
  );
  assert.match(
    src,
    /if \(parsed\.data\.idProofType && !primaryFile && !carriedIdProof && !parsed\.data\.idProofNumber\)/,
    'the create guard no longer accepts an ID number in place of a document'
  );
  assert.match(
    src,
    /if \(parsed\.data\.idProofType && !primaryFile && !parsed\.data\.idProofNumber\)/,
    'the check-in guard no longer accepts an ID number in place of a document'
  );
});

test('both tables can hold the number', () => {
  // booking_guests as well as bookings: an additional occupant is registered
  // the same way the primary guest is, and a column on only one of them makes
  // the party half-recordable.
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '039_id_proof_number.sql'),
    'utf8'
  );
  for (const table of ['dbo.bookings', 'dbo.booking_guests']) {
    assert.ok(
      new RegExp(`ALTER TABLE ${table.replace('.', '\.')} ADD id_proof_number`).test(migration),
      `${table} is missing id_proof_number`
    );
  }
  // The column was dropped once before. Nothing may drop it again on the next
  // db:init, which is what schema.sql used to do unconditionally.
  const schema = fs.readFileSync(path.join(__dirname, '..', 'src', 'config', 'schema.sql'), 'utf8');
  assert.ok(!/DROP COLUMN id_proof_number/.test(schema), 'schema.sql still drops id_proof_number');
});

test('a returning-guest suggestion carries the number, paired with its type', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'modules', 'bookings', 'bookings.service.js'),
    'utf8'
  );

  // The column has to survive both hops of the query — the CTE that gathers a
  // guest's stays, and the projection that returns the chosen ones.
  const cte = /SELECT id, guest_name, guest_phone, id_proof_type, id_proof_number, id_proof_document, check_in_date/;
  assert.match(src, cte, 'the suggestions CTE no longer selects id_proof_number');
  assert.match(
    src,
    /SELECT r\.id, r\.guest_name, r\.guest_phone, r\.id_proof_type, r\.id_proof_number/,
    'the suggestions projection no longer returns id_proof_number'
  );

  // The pairing is the part worth pinning. A guest with several stays can have
  // the type on one and a number on another; taking each from whichever row
  // happens to have it would offer "Aadhaar" beside a passport number, which
  // reads as verified and is not.
  assert.match(
    src,
    /const idSource = hasDocument \? chosen : stays\[0\];/,
    'type and number are no longer read from a single stay'
  );
  assert.match(src, /idProofType: idSource\.id_proof_type,/, 'idProofType left the paired source');
  assert.match(src, /idProofNumber: idSource\.id_proof_number \?\? null,/, 'idProofNumber left the paired source');
});

test('picking a guest fills the number, and typing over the name clears it', () => {
  const form = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'lodge', 'Bookings.jsx'),
    'utf8'
  );
  assert.match(form, /idProofNumber: guest\.idProofNumber \?\? '',/, 'onPick no longer fills the ID number');
  // The inverse: a carried number belongs to the guest who was picked. Typing a
  // different name over them must not leave the previous guest's ID behind on
  // what is now a different person.
  assert.match(
    form,
    /fromBookingId: null,\s*\n\s*hasDocument: false,[\s\S]{0,320}?idProofNumber: '',/,
    'typing over a picked name no longer clears the carried ID number'
  );
});
