require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { getPool } = require('../src/config/connection');
const migrations = require('../src/config/migrations');
const schemaDiff = require('../src/config/schemaDiff');

// CLI over src/config/migrations.js — the engine itself lives there so the
// bootstrap script and the server's boot check share it.
//
//   npm run migrate                    apply anything outstanding
//   npm run migrate:status             list what is applied and what is pending
//   npm run migrate:create -- <name>   scaffold the next numbered migration
//   npm run migrate:diff               compare the database against schema.sql
//                                      and report what is missing
//   npm run migrate:diff -- <name>     ...and write it as the next migration
//   npm run migrate:baseline           record everything as applied WITHOUT
//                                      running it — for a database whose schema
//                                      is already current (built by schema.sql,
//                                      or predating this runner)

function describeTarget() {
  return `${process.env.DB_NAME}@${process.env.DB_SERVER}`;
}

async function status() {
  const pool = await getPool();
  const { all, applied, pending, modified } = await migrations.plan(pool);

  if (all.length === 0) {
    console.log('No migration files found in backend/migrations.');
    return;
  }

  console.log(`\nDatabase: ${describeTarget()}\n`);
  for (const migration of all) {
    const record = applied.get(migration.name);
    if (!record) {
      console.log(`  PENDING  ${migration.name}`);
    } else if (record.checksum !== migration.checksum) {
      console.log(`  MODIFIED ${migration.name}  <-- file changed after it was applied`);
    } else {
      console.log(
        `  applied  ${migration.name}  (${new Date(record.applied_at).toISOString().slice(0, 19)})`
      );
    }
  }
  console.log(`\n${all.length - pending.length} applied, ${pending.length} pending.\n`);
  if (modified.length > 0) process.exitCode = 1;
}

async function migrate() {
  const pool = await getPool();

  // Migrations carry an *existing* schema forward; on an empty database they
  // fail confusingly part-way through (the first ALTER hits a table that was
  // never created). dbo.lodges is the root of the whole schema — if it is
  // missing, this database has never seen schema.sql and needs bootstrapping,
  // not migrating.
  const bootstrapped = await pool
    .request()
    .query("SELECT OBJECT_ID('dbo.lodges', 'U') AS id");
  if (!bootstrapped.recordset[0].id) {
    console.error(
      `\nThis database (${describeTarget()}) is empty — dbo.lodges does not exist.\n` +
        `Migrations only carry an existing schema forward. Build it first:\n\n` +
        `  npm run db:init\n\n` +
        `which applies schema.sql and records every migration as already applied.\n`
    );
    process.exit(1);
  }

  const { pending, modified } = await migrations.plan(pool);

  // A modified migration is a hard stop rather than a warning. Continuing would
  // mean the database and the repository disagree about what has been applied,
  // and every later migration would be built on that assumption.
  if (modified.length > 0) {
    console.error(
      `\nRefusing to run — these migrations were changed after being applied:\n` +
        modified.map((m) => `  - ${m.name}`).join('\n') +
        `\n\nThe database already has the previous version. Add a NEW migration with the\n` +
        `change instead of editing one that has run.\n`
    );
    process.exit(1);
  }

  if (pending.length === 0) {
    console.log('Database is up to date — nothing to apply.');
    return;
  }

  console.log(`\nDatabase: ${describeTarget()}`);
  console.log(`Applying ${pending.length} migration(s):\n`);

  for (const migration of pending) {
    process.stdout.write(`  ${migration.name} ... `);
    try {
      const { skipped } = await migrations.applyMigration(pool, migration);
      console.log(skipped ? 'skipped (applied by a concurrent run)' : 'ok');
    } catch (err) {
      console.log('FAILED');
      console.error(`\n${migration.name} failed and was rolled back:\n  ${err.message}\n`);
      process.exit(1);
    }
  }

  console.log('\nAll migrations applied.\n');
}

async function baseline() {
  const pool = await getPool();
  const { modified } = await migrations.plan(pool);
  if (modified.length > 0) {
    console.error(
      `\nRefusing to baseline — these migrations were changed after being applied:\n` +
        modified.map((m) => `  - ${m.name}`).join('\n') + '\n'
    );
    process.exit(1);
  }
  const recorded = await migrations.baseline(pool);
  if (recorded.length === 0) {
    console.log('Nothing to baseline — every migration is already recorded.');
  } else {
    console.log(`\nDatabase: ${describeTarget()}`);
    console.log(`Recorded as applied without running (schema assumed current):\n`);
    for (const name of recorded) console.log(`  ${name}`);
    console.log('');
  }
}

// Compares the live database against a scratch database built from schema.sql,
// and either reports the difference or writes it as the next migration.
//
// This is the answer to "I changed schema.sql — what migration do I need?".
// Writing that migration by hand means restating a change you have already
// made, and any discrepancy between the two stays invisible until a fresh
// database comes up different from a migrated one.
async function diff(name) {
  const pool = await getPool();
  console.log(`\nDatabase: ${describeTarget()}`);
  console.log('Building a reference database from schema.sql...');

  const result = await schemaDiff.diffAgainstSchemaFile(pool);

  for (const table of result.newTables) {
    console.log(`  + table   dbo.${table.name} (${table.columns.length} columns)`);
  }
  for (const { table, column } of result.newColumns) {
    console.log(`  + column  dbo.${table}.${column.column_name}`);
  }
  for (const index of result.newIndexes) {
    console.log(`  + index   ${index.index_name} on dbo.${index.table_name}`);
  }

  if (result.unsupported.length > 0) {
    console.log('\n  Needs a hand-written migration — not generated:');
    for (const note of result.unsupported) console.log(`    ! ${note}`);
  }

  if (!schemaDiff.hasChanges(result)) {
    console.log('\nNo additive differences — the database matches schema.sql.\n');
    return;
  }

  if (!name) {
    console.log(
      `\nRe-run with a name to write this as a migration:\n` +
        `  npm run migrate:diff -- add_whatever_this_is\n`
    );
    return;
  }

  // createMigration owns the numbering and the filename convention, so the
  // generated file is indistinguishable from a hand-written one.
  const filePath = migrations.createMigration(name);
  fs.writeFileSync(filePath, schemaDiff.renderMigration(result, path.basename(filePath)), 'utf8');
  console.log(`\nWrote ${path.relative(process.cwd(), filePath)}`);
  console.log('Review it before running `npm run migrate` — generated SQL is a draft.\n');
}

// Creating a file needs no database, so this path never touches the pool —
// scaffolding a migration must work with the VPN down.
function create(name) {
  if (!name) {
    console.error('Usage: npm run migrate:create -- <lower_snake_case_name>');
    process.exit(1);
  }
  const filePath = migrations.createMigration(name);
  console.log(`Created ${path.relative(process.cwd(), filePath)}`);
  console.log('Remember to mirror the change in src/config/schema.sql.');
}

async function main() {
  const [flag, arg] = process.argv.slice(2);
  switch (flag) {
    case undefined:
      return migrate();
    case '--status':
      return status();
    case '--baseline':
      return baseline();
    case '--create':
      return create(arg);
    case '--diff':
      return diff(arg);
    default:
      console.error(
        `Unknown option "${flag}". Use --status, --baseline, --create <name> or --diff [name].`
      );
      process.exit(1);
  }
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
