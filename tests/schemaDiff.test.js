const test = require('node:test');
const assert = require('node:assert');

// The generator's pure parts: turning catalog rows back into DDL, deciding
// what is safe to generate, and retargeting schema.sql into a scratch schema.
// These are what decide the *content* of a generated migration, so a silent
// bug here writes wrong SQL into a file a human is invited to trust.
//
// The database-facing halves (readSchema, withScratchSchema) are exercised by
// running `npm run migrate:diff` against a real server; they are catalog
// queries with nothing to unit test that a mock wouldn't just restate.
const {
  renderType,
  renderColumnDefinition,
  compare,
  hasChanges,
  renderMigration,
  retargetToSchema,
} = require('../src/config/schemaDiff');

// Shorthand for a sys.columns row, with the defaults most tests want.
function column(overrides) {
  return {
    table_name: 'lodges',
    column_name: 'note',
    column_id: 1,
    type_name: 'nvarchar',
    max_length: 240,
    precision: 0,
    scale: 0,
    is_nullable: true,
    is_identity: false,
    default_definition: null,
    ...overrides,
  };
}

function schemaOf(tables = {}, indexes = {}) {
  return {
    tables: new Map(
      Object.entries(tables).map(([name, cols]) => [
        name,
        new Map(cols.map((c) => [c.column_name, c])),
      ])
    ),
    indexes: new Map(Object.entries(indexes)),
  };
}

test('renders N-type lengths in characters, not bytes', () => {
  // sys.columns.max_length is bytes, and NVARCHAR is two per character. Getting
  // this wrong silently doubles every string column in a generated migration.
  assert.strictEqual(renderType(column({ type_name: 'nvarchar', max_length: 400 })), 'NVARCHAR(200)');
  assert.strictEqual(renderType(column({ type_name: 'nchar', max_length: 20 })), 'NCHAR(10)');
});

test('renders non-unicode string lengths as-is', () => {
  assert.strictEqual(renderType(column({ type_name: 'varchar', max_length: 50 })), 'VARCHAR(50)');
  assert.strictEqual(renderType(column({ type_name: 'char', max_length: 64 })), 'CHAR(64)');
});

test('renders the MAX types', () => {
  assert.strictEqual(renderType(column({ type_name: 'nvarchar', max_length: -1 })), 'NVARCHAR(MAX)');
  assert.strictEqual(renderType(column({ type_name: 'varbinary', max_length: -1 })), 'VARBINARY(MAX)');
});

test('renders decimal precision and scale', () => {
  const col = column({ type_name: 'decimal', precision: 10, scale: 2 });
  assert.strictEqual(renderType(col), 'DECIMAL(10,2)');
});

test('renders types that take no length', () => {
  assert.strictEqual(renderType(column({ type_name: 'bit' })), 'BIT');
  assert.strictEqual(renderType(column({ type_name: 'datetimeoffset' })), 'DATETIMEOFFSET');
});

test('a column definition carries nullability, identity and default', () => {
  assert.strictEqual(
    renderColumnDefinition(column({ column_name: 'note', max_length: 240 })),
    'note NVARCHAR(120) NULL'
  );
  assert.strictEqual(
    renderColumnDefinition(
      column({ column_name: 'is_active', type_name: 'bit', is_nullable: false, default_definition: '((1))' })
    ),
    'is_active BIT NOT NULL DEFAULT ((1))'
  );
  assert.strictEqual(
    renderColumnDefinition(
      column({ column_name: 'id', type_name: 'bigint', is_nullable: false, is_identity: true })
    ),
    'id BIGINT IDENTITY(1,1) NOT NULL'
  );
});

test('a table only schema.sql has is reported as a new table', () => {
  const diff = compare(schemaOf({}), schemaOf({ lodges: [column({})] }));
  assert.strictEqual(diff.newTables.length, 1);
  assert.strictEqual(diff.newTables[0].name, 'lodges');
  assert.ok(hasChanges(diff));
});

test('a column only schema.sql has is reported as a new column', () => {
  const diff = compare(
    schemaOf({ lodges: [column({ column_name: 'name' })] }),
    schemaOf({ lodges: [column({ column_name: 'name' }), column({ column_name: 'name_mr' })] })
  );
  assert.strictEqual(diff.newColumns.length, 1);
  assert.strictEqual(diff.newColumns[0].column.column_name, 'name_mr');
  assert.strictEqual(diff.newTables.length, 0);
});

test('an identical schema produces no changes', () => {
  const cols = [column({ column_name: 'name' }), column({ column_name: 'name_mr' })];
  const diff = compare(schemaOf({ lodges: cols }), schemaOf({ lodges: cols }));
  assert.strictEqual(hasChanges(diff), false);
  assert.strictEqual(diff.unsupported.length, 0);
});

test('a NOT NULL column with no default is refused, not generated', () => {
  // Adding one to a table with rows is rejected by SQL Server, and there is no
  // correct value for the generator to invent — it needs a backfill decision.
  const diff = compare(
    schemaOf({ lodges: [column({ column_name: 'name' })] }),
    schemaOf({
      lodges: [column({ column_name: 'name' }), column({ column_name: 'gstin', is_nullable: false })],
    })
  );
  assert.strictEqual(diff.newColumns.length, 0);
  assert.match(diff.unsupported.join('\n'), /gstin is NOT NULL with no default/);
});

test('a NOT NULL column WITH a default is safe and is generated', () => {
  const diff = compare(
    schemaOf({ lodges: [column({ column_name: 'name' })] }),
    schemaOf({
      lodges: [
        column({ column_name: 'name' }),
        column({ column_name: 'is_active', type_name: 'bit', is_nullable: false, default_definition: '((1))' }),
      ],
    })
  );
  assert.strictEqual(diff.newColumns.length, 1);
  assert.strictEqual(diff.unsupported.length, 0);
});

test('a changed column type is reported but never generated', () => {
  // Type changes can truncate data; a generator that guesses is worse than none.
  const diff = compare(
    schemaOf({ lodges: [column({ column_name: 'phone', max_length: 40 })] }),
    schemaOf({ lodges: [column({ column_name: 'phone', max_length: 400 })] })
  );
  assert.strictEqual(hasChanges(diff), false);
  assert.match(diff.unsupported.join('\n'), /phone changed \(type NVARCHAR\(20\) -> NVARCHAR\(200\)\)/);
});

test('a table the database has and schema.sql does not is never dropped', () => {
  const diff = compare(schemaOf({ legacy_notes: [column({})] }), schemaOf({}));
  assert.strictEqual(hasChanges(diff), false);
  assert.match(diff.unsupported.join('\n'), /legacy_notes exists in the database but not in schema\.sql/);
});

test('the runner\'s own history table is not reported as drift', () => {
  // schema_migrations is created by the migration runner, not schema.sql, so it
  // is expected to be absent from the reference on every single run.
  const diff = compare(schemaOf({ schema_migrations: [column({})] }), schemaOf({}));
  assert.strictEqual(diff.unsupported.length, 0);
});

test('generated column SQL is guarded and defers compilation', () => {
  const diff = compare(
    schemaOf({ lodges: [column({ column_name: 'name' })] }),
    schemaOf({ lodges: [column({ column_name: 'name' }), column({ column_name: 'name_mr' })] })
  );
  const migration = renderMigration(diff, '003_x.sql');
  // The guard makes it safe to re-run against a database that already has the
  // column; EXEC defers compiling a statement naming a column that does not
  // exist yet, which would otherwise fail at parse time.
  assert.match(migration, /IF COL_LENGTH\('dbo\.lodges', 'name_mr'\) IS NULL/);
  assert.match(migration, /EXEC\('ALTER TABLE dbo\.lodges ADD name_mr NVARCHAR\(120\) NULL'\)/);
});

test('generated index SQL preserves uniqueness and filters', () => {
  const diff = compare(
    schemaOf({}, {}),
    schemaOf({}, {
      'food_orders.ix_public_token': {
        table_name: 'food_orders',
        index_name: 'ix_public_token',
        is_unique: true,
        filter_definition: '([public_token] IS NOT NULL)',
        key_columns: 'public_token',
      },
    })
  );
  const migration = renderMigration(diff, '003_x.sql');
  assert.match(migration, /CREATE UNIQUE INDEX ix_public_token ON dbo\.food_orders\(public_token\)/);
  // Single quotes inside the filter must be doubled to survive the EXEC string.
  assert.match(migration, /WHERE \(\[public_token\] IS NOT NULL\)/);
});

test('retargeting rewrites dbo references, including inside EXEC strings', () => {
  const source = [
    "IF OBJECT_ID('dbo.lodges', 'U') IS NULL",
    'CREATE TABLE dbo.lodges (id BIGINT);',
    "IF COL_LENGTH('dbo.lodges', 'x') IS NULL",
    "    EXEC('ALTER TABLE dbo.lodges ADD x BIT');",
    "SELECT 1 FROM sys.tables WHERE schema_id = SCHEMA_ID('dbo');",
  ].join('\n');

  const out = retargetToSchema(source, 'scratch_1');

  // Nothing may still point at dbo — a single missed reference would build the
  // reference schema on top of the real tables, which is the one outcome this
  // whole tool must never have.
  assert.ok(!/\bdbo\./.test(out), `dbo. survived retargeting:\n${out}`);
  assert.ok(!/SCHEMA_ID\('dbo'\)/i.test(out));
  assert.match(out, /CREATE TABLE scratch_1\.lodges/);
  assert.match(out, /EXEC\('ALTER TABLE scratch_1\.lodges ADD x BIT'\)/);
  assert.match(out, /SCHEMA_ID\('scratch_1'\)/);
});

test('retargeting leaves sys and other schemas alone', () => {
  const out = retargetToSchema('SELECT * FROM sys.indexes JOIN sys.tables t ON 1=1;', 'scratch_1');
  assert.match(out, /sys\.indexes/);
  assert.ok(!out.includes('scratch_1'));
});
