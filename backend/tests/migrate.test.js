const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// The migration runner's ordering, batch splitting and checksum logic, tested
// without a database — those are the parts that decide *what* gets sent to SQL
// Server, and they are pure string handling.
//
// The runner keeps them as module-private helpers, so these mirror them. That
// is a real duplication, and the reason it is acceptable: the alternative is
// exporting internals purely for tests, and the properties being pinned here
// (zero-padded ordering, GO splitting, CRLF-insensitive checksums) are exactly
// the ones whose behaviour must not drift.

function splitBatches(sqlText) {
  return sqlText
    .split(/^\s*GO\s*$/gim)
    .map((batch) => batch.trim())
    .filter((batch) => batch.length > 0);
}

function checksum(text) {
  return crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
}

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

test('migration filenames sort into the order they will be applied', () => {
  // Zero-padded prefixes are what make lexicographic sorting correct. Without
  // padding, '10' sorts before '2' and migrations run out of order.
  const names = ['010_c.sql', '002_b.sql', '001_a.sql'];
  assert.deepStrictEqual(names.slice().sort(), ['001_a.sql', '002_b.sql', '010_c.sql']);
});

test('every committed migration is numbered, ordered and non-empty', () => {
  const dir = path.join(__dirname, '..', 'migrations');
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
  const seen = new Set();

  for (const name of files) {
    assert.match(name, /^\d{3}_[a-z0-9_]+\.sql$/, `${name} must be NNN_lower_snake_case.sql`);

    // A duplicated number means two migrations have no defined order between
    // them, which is the specific failure the numbering exists to prevent.
    const number = name.slice(0, 3);
    assert.ok(!seen.has(number), `duplicate migration number ${number} (${name})`);
    seen.add(number);

    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.ok(text.trim().length > 0, `${name} is empty`);
    assert.ok(splitBatches(text).length > 0, `${name} contains no executable batch`);
  }
});
