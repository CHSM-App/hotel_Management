const fs = require('fs');
const path = require('path');
const { sql } = require('./connection');

// Detects what a database is missing relative to schema.sql, and writes the
// migration that closes the gap.
//
// The method is deliberately *not* to parse schema.sql. That file is full of
// conditional logic — IF OBJECT_ID(...) IS NULL, EXEC('ALTER TABLE ...'),
// DROP-and-rebuild blocks whose effect depends on what is already there — and
// a parser that got any of it subtly wrong would emit a migration that looks
// right and corrupts a production database. Instead schema.sql is *executed*
// into a scratch database and the two are compared through sys.* catalog
// views, so the comparison is against what SQL Server actually built.
//
// Scope, stated plainly: this finds added tables, added columns, and added
// indexes — the changes that make up nearly every schema edit in this project,
// and the ones that are safe to generate mechanically. It does NOT emit drops,
// type changes, nullability changes, or constraint edits. Those are destructive
// or data-dependent, and a tool that guesses at them is worse than no tool:
// it is reported as a warning for a human to write by hand.

// The reference is built in a scratch *schema* inside the current database,
// not a scratch database. On shared hosting — which is where this app runs —
// the application login has CREATE TABLE and CREATE SCHEMA in its own database
// but not CREATE DATABASE, so a scratch database is simply not available.
// A schema is, costs nothing extra, and is dropped in the same finally block.
const SCRATCH_PREFIX = 'schemadiff_tmp_';

// ---------------------------------------------------------------------------
// Reading a schema out of a live database
// ---------------------------------------------------------------------------

// One shape for "what is in this schema", read from the catalog views so it
// reflects what SQL Server built rather than what the SQL looked like.
async function readSchema(pool, schemaName) {
  const q = (text) =>
    pool.request().input('schema', sql.NVarChar, schemaName).query(text);

  const columns = await q(`
    SELECT t.name AS table_name,
           c.name AS column_name,
           c.column_id,
           ty.name AS type_name,
           c.max_length,
           c.precision,
           c.scale,
           c.is_nullable,
           c.is_identity,
           dc.definition AS default_definition
      FROM sys.tables t
      JOIN sys.columns c ON c.object_id = t.object_id
      JOIN sys.types ty ON ty.user_type_id = c.user_type_id
      LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
     WHERE t.schema_id = SCHEMA_ID(@schema)
     ORDER BY t.name, c.column_id
  `);

  const indexes = await q(`
    SELECT t.name AS table_name,
           i.name AS index_name,
           i.is_unique,
           i.filter_definition,
           STUFF((
             SELECT ',' + c2.name
               FROM sys.index_columns ic2
               JOIN sys.columns c2
                 ON c2.object_id = ic2.object_id AND c2.column_id = ic2.column_id
              WHERE ic2.object_id = i.object_id
                AND ic2.index_id = i.index_id
                AND ic2.is_included_column = 0
              ORDER BY ic2.key_ordinal
                FOR XML PATH('')
           ), 1, 1, '') AS key_columns
      FROM sys.indexes i
      JOIN sys.tables t ON t.object_id = i.object_id
     WHERE t.schema_id = SCHEMA_ID(@schema)
       AND i.is_primary_key = 0
       AND i.is_unique_constraint = 0
       AND i.type_desc <> 'HEAP'
       AND i.name IS NOT NULL
  `);

  const tables = new Map();
  for (const row of columns.recordset) {
    if (!tables.has(row.table_name)) tables.set(row.table_name, new Map());
    tables.get(row.table_name).set(row.column_name, row);
  }

  const indexesByName = new Map(
    indexes.recordset.map((row) => [`${row.table_name}.${row.index_name}`, row])
  );

  return { tables, indexes: indexesByName };
}

// ---------------------------------------------------------------------------
// Rendering catalog rows back into DDL
// ---------------------------------------------------------------------------

// max_length is in bytes, and for the N types that is two bytes per character —
// so an NVARCHAR(200) reads as 400 here. -1 is the MAX types.
function renderType(col) {
  const t = col.type_name.toUpperCase();
  if (['NVARCHAR', 'NCHAR'].includes(t)) {
    return col.max_length === -1 ? `${t}(MAX)` : `${t}(${col.max_length / 2})`;
  }
  if (['VARCHAR', 'CHAR', 'VARBINARY', 'BINARY'].includes(t)) {
    return col.max_length === -1 ? `${t}(MAX)` : `${t}(${col.max_length})`;
  }
  if (['DECIMAL', 'NUMERIC'].includes(t)) return `${t}(${col.precision},${col.scale})`;
  return t;
}

function renderColumnDefinition(col) {
  const parts = [`${col.column_name} ${renderType(col)}`];
  if (col.is_identity) parts.push(`IDENTITY(1,1)`);
  parts.push(col.is_nullable ? 'NULL' : 'NOT NULL');
  if (col.default_definition) parts.push(`DEFAULT ${col.default_definition}`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Comparing
// ---------------------------------------------------------------------------

// `target` is the database being brought forward; `reference` is the scratch
// database freshly built from schema.sql. Everything present in the reference
// and absent from the target is a change to generate.
function compare(target, reference) {
  const newTables = [];
  const newColumns = [];
  const newIndexes = [];
  const unsupported = [];

  for (const [tableName, refColumns] of reference.tables) {
    const targetColumns = target.tables.get(tableName);
    if (!targetColumns) {
      newTables.push({ name: tableName, columns: [...refColumns.values()] });
      continue;
    }
    for (const [columnName, refCol] of refColumns) {
      const targetCol = targetColumns.get(columnName);
      if (!targetCol) {
        // A NOT NULL column with no default cannot be added to a table that
        // already has rows — SQL Server rejects it, and there is no correct
        // value for this tool to invent.
        if (!refCol.is_nullable && !refCol.default_definition) {
          unsupported.push(
            `${tableName}.${columnName} is NOT NULL with no default — adding it to a table ` +
              `with existing rows needs a backfill; write this one by hand.`
          );
          continue;
        }
        newColumns.push({ table: tableName, column: refCol });
        continue;
      }
      // Changes to a column that exists in both are reported, never generated.
      const differences = [];
      if (renderType(targetCol) !== renderType(refCol)) {
        differences.push(`type ${renderType(targetCol)} -> ${renderType(refCol)}`);
      }
      if (targetCol.is_nullable !== refCol.is_nullable) {
        differences.push(refCol.is_nullable ? 'NOT NULL -> NULL' : 'NULL -> NOT NULL');
      }
      if ((targetCol.default_definition || null) !== (refCol.default_definition || null)) {
        differences.push(
          `default ${targetCol.default_definition || 'none'} -> ${refCol.default_definition || 'none'}`
        );
      }
      if (differences.length > 0) {
        unsupported.push(`${tableName}.${columnName} changed (${differences.join('; ')})`);
      }
    }
  }

  for (const [key, refIndex] of reference.indexes) {
    if (!target.indexes.has(key)) newIndexes.push(refIndex);
  }

  // Objects the target has and schema.sql does not. Never generated as drops —
  // this is usually a table schema.sql hasn't caught up with, and guessing
  // wrong means deleting data. schema_migrations is the runner's own bookkeeping
  // and is created by the runner rather than schema.sql, so it is not drift.
  for (const tableName of target.tables.keys()) {
    if (!reference.tables.has(tableName) && tableName !== 'schema_migrations') {
      unsupported.push(
        `dbo.${tableName} exists in the database but not in schema.sql — no drop generated.`
      );
    }
  }

  return { newTables, newColumns, newIndexes, unsupported };
}

function hasChanges(diff) {
  return diff.newTables.length > 0 || diff.newColumns.length > 0 || diff.newIndexes.length > 0;
}

// ---------------------------------------------------------------------------
// Rendering the migration
// ---------------------------------------------------------------------------

// Every statement is guarded, so the generated file is safe to apply to a
// database that already has part of the change — which is exactly the state a
// database is in when someone ran a hand-written fix before this tool.
function renderMigration(diff, filename) {
  const lines = [
    `-- ${filename}`,
    '--',
    '-- Generated by `npm run migrate:diff` — the difference between this',
    '-- database and a scratch database built from schema.sql.',
    '--',
    '-- REVIEW BEFORE APPLYING. Generation covers added tables, columns and',
    '-- indexes; it deliberately never emits drops or type changes. Replace this',
    '-- header with a note on what the change is *for* — the SQL below says what',
    '-- it does, and only you can say why.',
    '',
  ];

  for (const table of diff.newTables) {
    lines.push(`IF OBJECT_ID('dbo.${table.name}', 'U') IS NULL`);
    lines.push(`CREATE TABLE dbo.${table.name} (`);
    lines.push(table.columns.map((c) => `    ${renderColumnDefinition(c)}`).join(',\n'));
    lines.push(');');
    lines.push('');
    lines.push(
      `-- NOTE: primary key, foreign key and check constraints on dbo.${table.name} are not`
    );
    lines.push(`-- generated — copy them from schema.sql.`);
    lines.push('');
  }

  for (const { table, column } of diff.newColumns) {
    lines.push(`IF COL_LENGTH('dbo.${table}', '${column.column_name}') IS NULL`);
    // EXEC, so the statement is compiled only when the guard passes: a bare
    // ALTER naming a column that a later batch adds would fail parse-time in a
    // single-batch file.
    lines.push(
      `    EXEC('ALTER TABLE dbo.${table} ADD ${renderColumnDefinition(column).replace(/'/g, "''")}');`
    );
    lines.push('');
  }

  for (const index of diff.newIndexes) {
    const unique = index.is_unique ? 'UNIQUE ' : '';
    const filter = index.filter_definition ? ` WHERE ${index.filter_definition}` : '';
    lines.push(
      `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = '${index.index_name}' AND object_id = OBJECT_ID('dbo.${index.table_name}'))`
    );
    lines.push(
      `    EXEC('CREATE ${unique}INDEX ${index.index_name} ON dbo.${index.table_name}(${index.key_columns})${filter.replace(/'/g, "''")}');`
    );
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The scratch database
// ---------------------------------------------------------------------------

// schema.sql names dbo. explicitly throughout — it has to, since it is also the
// bootstrap script. Building it into a scratch schema therefore means
// rewriting those references, including the ones inside the quoted strings that
// its EXEC(...) blocks execute.
//
// A blunt textual substitution is acceptable *here* and nowhere else: the input
// is one file in this repository, committed and reviewed, not arbitrary SQL.
// The tests pin the cases that matter.
function retargetToSchema(schemaSql, scratchSchema) {
  return schemaSql
    // dbo.foo -> scratch.foo, including inside single-quoted EXEC bodies.
    .replace(/\bdbo\./g, `${scratchSchema}.`)
    // SCHEMA_ID('dbo') and OBJECT_ID('dbo.x') survive the above (the quoted
    // dbo. form is rewritten with everything else); this catches the bare
    // schema name where it appears alone.
    .replace(/SCHEMA_ID\('dbo'\)/gi, `SCHEMA_ID('${scratchSchema}')`);
}

// The reference schema is built, read and dropped inside one call. Named with
// the process id so two concurrent runs cannot collide.
async function withScratchSchema(pool, fn) {
  const name = `${SCRATCH_PREFIX}${process.pid}`;
  const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

  await dropScratchSchema(pool, name);
  // CREATE SCHEMA must be the only statement in its batch.
  await pool.request().batch(`CREATE SCHEMA [${name}]`);

  try {
    // schema.sql is a single batch by design, which is what lets it go through
    // sp_executesql in one call.
    await pool
      .request()
      .input('stmt', sql.NVarChar(sql.MAX), retargetToSchema(schemaSql, name))
      .query('EXEC sp_executesql @stmt');
    return await fn(name);
  } finally {
    await dropScratchSchema(pool, name).catch(() => {
      // Leaving scratch tables behind is untidy but harmless, and must not
      // mask whatever real error is already propagating.
    });
  }
}

// A schema cannot be dropped while it still contains objects, so its tables go
// first — foreign keys before tables, since those constrain drop order.
async function dropScratchSchema(pool, name) {
  await pool.request().batch(`
    IF SCHEMA_ID('${name}') IS NOT NULL
    BEGIN
        DECLARE @sql NVARCHAR(MAX) = N'';

        SELECT @sql = @sql + 'ALTER TABLE [${name}].[' + t.name + '] DROP CONSTRAINT [' + fk.name + '];'
          FROM sys.foreign_keys fk
          JOIN sys.tables t ON t.object_id = fk.parent_object_id
         WHERE t.schema_id = SCHEMA_ID('${name}');

        SELECT @sql = @sql + 'DROP TABLE [${name}].[' + name + '];'
          FROM sys.tables
         WHERE schema_id = SCHEMA_ID('${name}');

        SELECT @sql = @sql + 'DROP VIEW [${name}].[' + name + '];'
          FROM sys.views
         WHERE schema_id = SCHEMA_ID('${name}');

        EXEC sp_executesql @sql;
        EXEC('DROP SCHEMA [${name}]');
    END
  `);
}

// The whole operation: build a reference from schema.sql, compare, hand back
// the diff. Callers decide whether to write a file or just report.
async function diffAgainstSchemaFile(pool) {
  return withScratchSchema(pool, async (scratchName) => {
    const target = await readSchema(pool, 'dbo');
    const reference = await readSchema(pool, scratchName);
    return compare(target, reference);
  });
}

module.exports = {
  readSchema,
  compare,
  hasChanges,
  renderMigration,
  renderType,
  renderColumnDefinition,
  retargetToSchema,
  withScratchSchema,
  diffAgainstSchemaFile,
};
