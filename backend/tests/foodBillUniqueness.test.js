const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// uq_invoices_booking_active means "one active invoice per booking", and for a
// stay that is exactly right. But a food bill has no booking and inserts
// booking_id NULL — and SQL Server treats every NULL in a unique index as the
// SAME value. So the index also quietly meant "one food bill per property,
// ever": the first table, room or counter bill was accepted and every one after
// it failed with
//
//   Cannot insert duplicate key row ... The duplicate key value is (<NULL>).
//
// which reached the billing desk as a 500 and no bill at all.
//
// The filter needs `booking_id IS NOT NULL` to keep the rule it was written for
// while letting food bills out of its scope. This is enforced at the schema
// level, so that is where it is tested: a filtered index cannot be altered in
// place, so a future edit that rebuilds it must not drop the clause again.

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const schema = read('src/config/schema.sql');
const migration = read('migrations/046_invoices_food_bill_uniqueness.sql');

// Every CREATE of the index, wherever it is declared. schema.sql builds a fresh
// database and the migration carries an existing one forward; the two must not
// disagree, or a rebuilt database gets a different constraint from a migrated
// one.
function createsOf(sqlText) {
  return [...sqlText.matchAll(/CREATE\s+UNIQUE\s+INDEX\s+uq_invoices_booking_active[\s\S]*?;/gi)].map(
    (m) => m[0].replace(/\s+/g, ' ')
  );
}

// schema.sql creates it twice: once with the table, and again after the ALTER
// that makes booking_id nullable — a filtered index naming a column blocks any
// change to that column, so it has to be dropped and put back around it. Both
// must carry the same filter, or which one a database ends up with depends on
// the order the file happened to run in.
test('schema.sql declares the index, and every declaration agrees', () => {
  const creates = createsOf(schema);
  assert.ok(creates.length >= 1, 'schema.sql should create the index');
  for (const create of creates) {
    assert.match(create, /WHERE status = 'ISSUED' AND booking_id IS NOT NULL/i, create);
  }
});

test('the schema index excludes food bills from the uniqueness rule', () => {
  const [create] = createsOf(schema);
  assert.match(create, /WHERE status = 'ISSUED' AND booking_id IS NOT NULL/i, create);
});

test('the migration rebuilds the index with the same filter schema.sql declares', () => {
  const [fromMigration] = createsOf(migration);
  assert.ok(fromMigration, 'migration 046 should create the index');
  assert.match(fromMigration, /WHERE status = 'ISSUED' AND booking_id IS NOT NULL/i, fromMigration);
});

// A filtered index's WHERE clause cannot be changed by ALTER, so the migration
// has to drop before it creates — otherwise it silently no-ops on a database
// that already has the old index, which is every existing one.
test('the migration drops the old index before recreating it', () => {
  const drop = migration.search(/DROP INDEX uq_invoices_booking_active/i);
  const create = migration.search(/CREATE UNIQUE INDEX uq_invoices_booking_active/i);
  assert.ok(drop !== -1, 'migration should drop the old index');
  assert.ok(create !== -1, 'migration should recreate the index');
  assert.ok(drop < create, 'the drop must come before the create');
});

// The rebuild must be guarded, or re-running it drops a live constraint and
// recreates it for no reason.
test('the rebuild is guarded on the filter it is replacing', () => {
  assert.match(migration, /IF EXISTS[\s\S]*sys\.indexes[\s\S]*filter_definition/i);
});

// The rule the index exists for is still enforced: a booking gets one active
// invoice. Narrowing the filter must not have widened that.
test('the index still keys on booking_id and still only covers issued rows', () => {
  const [create] = createsOf(schema);
  assert.match(create, /ON dbo\.invoices\(booking_id\)/i, create);
  assert.match(create, /status = 'ISSUED'/i, create);
  assert.match(create, /UNIQUE/i, create);
});
