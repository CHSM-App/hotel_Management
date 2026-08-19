require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getPool, sql } = require('../src/config/connection');

// Applies the numbered files in backend/migrations, in order, once each.
//
// Before this, a schema change meant editing schema.sql and re-running it as
// one batch, relying on every statement being written defensively enough to be
// harmless the second time. That works — schema.sql is carefully written that
// way — but nothing recorded what had actually been applied to a given
// database, so "is production on the current schema?" could only be answered by
// inspecting it, and two people adding columns in the same week had no defined
// order.
//
//   npm run migrate          apply anything outstanding
//   npm run migrate:status   list what is applied and what is pending
//
// schema.sql keeps its job of building a database from nothing. Migrations
// carry it forward from there, which is why 001 is the first *new* change
// rather than a replay of the existing schema.
//
// Deliberately small: a dependency-free runner is ~100 lines and does what this
// project needs. Reach for Flyway or Knex when there are branches to merge or
// down-migrations to run — neither of which applies here yet.

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

// GO is a batch separator understood by sqlcmd and SSMS, not by SQL Server
// itself — sending a file containing it as one statement fails. mssql's
// .batch() handles a single batch, so the file is split and each part sent in
// turn, which is also what makes CREATE TRIGGER / CREATE VIEW work (both must
// be the first statement in their batch).
function splitBatches(sqlText) {
  return sqlText
    .split(/^\s*GO\s*$/gim)
    .map((batch) => batch.trim())
    .filter((batch) => batch.length > 0);
}

function checksum(text) {
  // Normalises line endings first: a file checked out with CRLF on Windows and
  // LF on the CI runner is the same migration and must not look modified.
  return crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
}

function listMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    // Lexicographic order over zero-padded numeric prefixes, which is why the
    // naming convention is 001_, 002_, ... rather than 1_, 2_.
    .sort()
    .map((name) => {
      const text = fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
      return { name, text, checksum: checksum(text) };
    });
}

async function ensureHistoryTable(pool) {
  await pool.request().batch(`
    IF OBJECT_ID('dbo.schema_migrations', 'U') IS NULL
    CREATE TABLE dbo.schema_migrations (
        name        NVARCHAR(200) NOT NULL PRIMARY KEY,
        checksum    CHAR(64)      NOT NULL,
        applied_at  DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
        applied_by  NVARCHAR(128) NOT NULL DEFAULT SUSER_SNAME()
    );
  `);
}

async function appliedMigrations(pool) {
  const result = await pool
    .request()
    .query('SELECT name, checksum, applied_at FROM dbo.schema_migrations ORDER BY name');
  return new Map(result.recordset.map((row) => [row.name, row]));
}

async function status() {
  const pool = await getPool();
  await ensureHistoryTable(pool);
  const applied = await appliedMigrations(pool);
  const all = listMigrations();

  if (all.length === 0) {
    console.log('No migration files found in backend/migrations.');
    return;
  }

  console.log(`\nDatabase: ${process.env.DB_NAME}@${process.env.DB_SERVER}\n`);
  let pending = 0;
  for (const migration of all) {
    const record = applied.get(migration.name);
    if (!record) {
      pending += 1;
      console.log(`  PENDING  ${migration.name}`);
    } else if (record.checksum !== migration.checksum) {
      // An applied migration whose file has since changed. The database does
      // NOT have what the file now says, and re-running is not the fix — write
      // a new migration instead.
      console.log(`  MODIFIED ${migration.name}  <-- file changed after it was applied`);
    } else {
      console.log(`  applied  ${migration.name}  (${new Date(record.applied_at).toISOString().slice(0, 19)})`);
    }
  }
  console.log(`\n${all.length - pending} applied, ${pending} pending.\n`);
}

async function migrate() {
  const pool = await getPool();
  await ensureHistoryTable(pool);
  const applied = await appliedMigrations(pool);
  const all = listMigrations();

  // A modified migration is a hard stop rather than a warning. Continuing would
  // mean the database and the repository disagree about what has been applied,
  // and every later migration would be built on that assumption.
  const modified = all.filter((m) => {
    const record = applied.get(m.name);
    return record && record.checksum !== m.checksum;
  });
  if (modified.length > 0) {
    console.error(
      `\nRefusing to run — these migrations were changed after being applied:\n` +
        modified.map((m) => `  - ${m.name}`).join('\n') +
        `\n\nThe database already has the previous version. Add a NEW migration with the\n` +
        `change instead of editing one that has run.\n`
    );
    process.exit(1);
  }

  const pending = all.filter((m) => !applied.has(m.name));
  if (pending.length === 0) {
    console.log('Database is up to date — nothing to apply.');
    return;
  }

  console.log(`\nDatabase: ${process.env.DB_NAME}@${process.env.DB_SERVER}`);
  console.log(`Applying ${pending.length} migration(s):\n`);

  for (const migration of pending) {
    process.stdout.write(`  ${migration.name} ... `);

    // Each migration is one transaction: it applies completely or not at all,
    // and its history row commits with it so the two can never disagree.
    //
    // Caveat worth knowing: some DDL in SQL Server cannot be rolled back
    // cleanly inside a transaction, and a batch containing CREATE PROCEDURE or
    // CREATE TRIGGER must be its own batch. Keep migrations to one logical
    // change and this stays predictable.
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      for (const batch of splitBatches(migration.text)) {
        await new sql.Request(transaction).batch(batch);
      }
      await new sql.Request(transaction)
        .input('name', sql.NVarChar, migration.name)
        .input('checksum', sql.Char(64), migration.checksum)
        .query('INSERT INTO dbo.schema_migrations (name, checksum) VALUES (@name, @checksum)');
      await transaction.commit();
      console.log('ok');
    } catch (err) {
      await transaction.rollback().catch(() => {});
      console.log('FAILED');
      console.error(`\n${migration.name} failed and was rolled back:\n  ${err.message}\n`);
      process.exit(1);
    }
  }

  console.log('\nAll migrations applied.\n');
}

const command = process.argv[2] === '--status' ? status : migrate;

command()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
