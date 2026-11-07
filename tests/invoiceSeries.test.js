const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Document numbering. The rules here are the ones that turn into a tax problem
// rather than a bug report, so they are pinned as source-level invariants —
// allocation itself needs a database and is exercised against a real one.

const BILLING_DIR = path.join(__dirname, '..', 'src', 'modules', 'billing');
const read = (f) => fs.readFileSync(path.join(BILLING_DIR, f), 'utf8');

test('no hardcoded document prefix survives anywhere in billing', () => {
  // Bills went out as INV-1 / RCT-1 / ADV-1, chosen by the code. Properties
  // number their bills to match the books they already keep, so the serial is
  // the owner's and the prefix is empty. A reintroduced literal would silently
  // start prefixing again.
  const offenders = [];
  for (const file of fs.readdirSync(BILLING_DIR).filter((f) => f.endsWith('.js'))) {
    const src = read(file).replace(/\/\/.*$/gm, '');
    for (const literal of ["'INV-'", "'RCT-'", "'ADV-'"]) {
      if (src.includes(literal)) offenders.push(`${file}: ${literal}`);
    }
  }
  assert.deepStrictEqual(offenders, [], `hardcoded prefixes: ${offenders.join(', ')}`);
});

test('the allocator bumps the counter atomically rather than reading MAX()+1', () => {
  // Two desks issuing at the same moment must not be handed the same number.
  // SELECT MAX()+1 is the classic way to reintroduce that.
  for (const file of ['billing.service.js', 'advanceReceipts.service.js']) {
    const src = read(file);
    assert.ok(
      /UPDATE dbo\.invoice_series[\s\S]{0,200}SET next_number = next_number \+ 1[\s\S]{0,200}OUTPUT/.test(src),
      `${file} should allocate with an atomic UPDATE ... OUTPUT`
    );
    assert.ok(
      !/MAX\(\s*next_number\s*\)\s*\+\s*1/.test(src),
      `${file} must not allocate with MAX(next_number)+1`
    );
  }
});

test('advance receipts run on their own series, never the bill series', () => {
  // Interleaving the two would leave gaps in the tax-invoice numbering, which
  // is the first thing an auditor asks about.
  const src = read('advanceReceipts.service.js');
  assert.match(src, /series_type = 'ADVANCE'/);
  assert.ok(
    !/series_type = '(GST|NON_GST)'/.test(src),
    'advance receipts must not draw from the bill series'
  );
});

test('a serial can never be set back over a number already issued', () => {
  const src = read('series.service.js');
  // The floor must be derived from the documents themselves, not from
  // next_number — a counter says what comes next, not what has been used.
  assert.match(src, /MAX\(TRY_CAST\(/, 'highest-issued must be read from the document table');
  // And re-checked inside the write, or a bill issued mid-edit slips underneath.
  assert.match(
    src,
    /UPDATE s[\s\S]{0,400}@nextNumber > ISNULL\(\(/,
    'the update must re-derive the floor atomically'
  );
});

test('the series settings route is authenticated and permission-gated', () => {
  const routes = read('billing.routes.js');
  for (const line of routes.split('\n').filter((l) => l.includes("'/series"))) {
    assert.match(line, /authenticate/, `unauthenticated series route: ${line.trim()}`);
    assert.match(line, /staff/, `ungated series route: ${line.trim()}`);
  }
});

test('migration 038 adds the uniqueness that makes a settable serial safe', () => {
  // Without these indexes, setting the serial back would produce two tax
  // documents sharing a number and nothing would object.
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '038_invoice_series_no_prefix.sql'),
    'utf8'
  );
  assert.match(migration, /CREATE UNIQUE INDEX uq_invoices_lodge_number/);
  assert.match(migration, /CREATE UNIQUE INDEX uq_advance_receipts_lodge_number/);
  // And it must refuse to run rather than half-apply if the data already has
  // duplicates — that needs a human to decide which document gets renumbered.
  assert.match(migration, /THROW 501\d\d/);
});

test('schema.sql mirrors the migration, so a fresh database matches a migrated one', () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'src', 'config', 'schema.sql'), 'utf8');
  assert.match(schema, /uq_invoices_lodge_number/);
  assert.match(schema, /uq_advance_receipts_lodge_number/);
  assert.match(schema, /df_invoice_series_prefix/);
});
