const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// The migration engine's ordering, batch splitting and checksum logic, tested
// without a database — those are the parts that decide *what* gets sent to SQL
// Server, and they are pure string handling.
//
// These used to mirror module-private helpers inside scripts/migrate.js; the
// engine now lives in src/config/migrations.js precisely so the CLI, the
// bootstrap script, the boot check and these tests all run the same code.
const {
  splitBatches,
  checksum,
  listMigrations,
  createMigration,
  MIGRATIONS_DIR,
} = require('../src/config/migrations');

test('splits a file on GO into separate batches', () => {
  // GO is understood by sqlcmd and SSMS, not by SQL Server itself — sending a
  // file containing it as one statement is a syntax error.
  const sql = `CREATE TABLE dbo.a (id INT);\nGO\nCREATE TABLE dbo.b (id INT);\nGO\n`;
  const batches = splitBatches(sql);
  assert.strictEqual(batches.length, 2);
  assert.match(batches[0], /CREATE TABLE dbo\.a/);
  assert.match(batches[1], /CREATE TABLE dbo\.b/);
});

test('ignores case and surrounding whitespace on the GO separator', () => {
  const batches = splitBatches('SELECT 1;\n  go  \nSELECT 2;\nGo\nSELECT 3;');
  assert.strictEqual(batches.length, 3);
});

test('does not split on GO inside an identifier or string', () => {
  // "GOOD" and "GO" are different words; a naive split would break this file.
  const batches = splitBatches("SELECT 'GO';\nSELECT 1 AS GOOD;");
  assert.strictEqual(batches.length, 1);
});

test('a file with no GO is a single batch', () => {
  assert.strictEqual(splitBatches('SELECT 1;').length, 1);
});

test('checksums ignore line-ending differences', () => {
  // The same migration checked out with CRLF on Windows and LF in CI must not
  // look like it was modified after being applied.
  assert.strictEqual(checksum('SELECT 1;\nSELECT 2;'), checksum('SELECT 1;\r\nSELECT 2;'));
});

test('checksums change when the SQL actually changes', () => {
  assert.notStrictEqual(checksum('SELECT 1;'), checksum('SELECT 2;'));
});

test('listMigrations returns committed files in application order', () => {
  const migrations = listMigrations();
  const names = migrations.map((m) => m.name);
  // Zero-padded prefixes are what make lexicographic sorting correct. Without
  // padding, '10' sorts before '2' and migrations run out of order.
  assert.deepStrictEqual(names, names.slice().sort());
  for (const m of migrations) {
    assert.strictEqual(m.checksum, checksum(m.text), `${m.name} checksum mismatch`);
  }
});

test('every committed migration is numbered, ordered and non-empty', () => {
  if (!fs.existsSync(MIGRATIONS_DIR)) return;

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  const seen = new Set();

  for (const name of files) {
    assert.match(name, /^\d{3}_[a-z0-9_]+\.sql$/, `${name} must be NNN_lower_snake_case.sql`);

    // A duplicated number means two migrations have no defined order between
    // them, which is the specific failure the numbering exists to prevent.
    const number = name.slice(0, 3);
    assert.ok(!seen.has(number), `duplicate migration number ${number} (${name})`);
    seen.add(number);

    const text = fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
    assert.ok(text.trim().length > 0, `${name} is empty`);
    assert.ok(splitBatches(text).length > 0, `${name} contains no executable batch`);
  }
});

test('createMigration rejects names that would break the filename convention', () => {
  // The filename IS the identity and the ordering; anything outside
  // lower_snake_case would fail the convention check above on the next run.
  for (const bad of ['Add Column', 'add-column', 'AddColumn', 'añadir', '']) {
    assert.throws(() => createMigration(bad), /lower_snake_case/, `accepted "${bad}"`);
  }
});

test('createMigration continues numbering from the highest existing file', () => {
  // Written to the real migrations directory and removed again — the scaffold
  // is pure filesystem, and the number it picks must be derived from what is
  // actually committed, so a fake directory would test nothing.
  const before = listMigrations().map((m) => m.name);
  const highest = before.length ? Math.max(...before.map((n) => Number(n.slice(0, 3)))) : 0;

  const filePath = createMigration('migration_scaffold_selftest');
  try {
    const name = path.basename(filePath);
    assert.strictEqual(name, `${String(highest + 1).padStart(3, '0')}_migration_scaffold_selftest.sql`);
    // The scaffold must itself satisfy the committed-migration convention the
    // test above enforces, and remind the author to keep schema.sql current —
    // that mirror is what keeps fresh and migrated databases identical.
    assert.match(name, /^\d{3}_[a-z0-9_]+\.sql$/);
    const text = fs.readFileSync(filePath, 'utf8');
    assert.match(text, /schema\.sql/);
  } finally {
    fs.unlinkSync(filePath);
  }
});
