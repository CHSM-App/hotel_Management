const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sql } = require('./connection');

// The migration engine, shared by the `migrate` CLI (scripts/migrate.js), the
// bootstrap script (scripts/init-db.js) and the startup drift check in
// server.js. Keeping it in one module is what makes the system end-to-end:
// every entry point agrees on what a migration is, what has been applied, and
// what "up to date" means, because they all ask the same code.
//
// The model:
//   - backend/migrations holds numbered .sql files, applied in filename order.
//   - dbo.schema_migrations records what has run, with a checksum of the file
//     as it was when it ran.
//   - schema.sql builds a database from nothing and is kept current, so a
//     fresh database is *baselined*: every migration file is recorded as
//     applied without being executed. Migrations only carry existing
//     databases forward.
//
// Deliberately dependency-free. Reach for Flyway or Knex when there are
// branches to merge or down-migrations to run — neither applies here yet.

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

// A single well-known name, locked via sp_getapplock inside each migration's
// transaction, so two deploys running `migrate` at the same moment serialize
// instead of interleaving DDL.
const LOCK_RESOURCE = 'hotel_management.schema_migrations';

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

// The three states a database can be in relative to the repository, computed
// once and shared so `migrate`, `migrate:status` and the boot check cannot
// classify the same file differently.
async function plan(pool) {
  await ensureHistoryTable(pool);
  const applied = await appliedMigrations(pool);
  const all = listMigrations();
  return {
    all,
    applied,
    pending: all.filter((m) => !applied.has(m.name)),
    // An applied migration whose file has since changed. The database does NOT
    // have what the file now says, and re-running is not the fix — write a new
    // migration instead.
    modified: all.filter((m) => {
      const record = applied.get(m.name);
      return record && record.checksum !== m.checksum;
    }),
  };
}

// Applies one migration in one transaction: the applock serializes concurrent
// runners, the re-check makes the loser of that race skip instead of reapply,
// and the history row commits with the DDL so the two can never disagree.
//
// Caveat worth knowing: some DDL in SQL Server cannot be rolled back cleanly
// inside a transaction, and a batch containing CREATE PROCEDURE or CREATE
// TRIGGER must be its own batch. Keep migrations to one logical change and
// this stays predictable.
async function applyMigration(pool, migration) {
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction).batch(`
      DECLARE @lock INT;
      EXEC @lock = sp_getapplock
          @Resource = '${LOCK_RESOURCE}',
          @LockMode = 'Exclusive',
          @LockOwner = 'Transaction',
          @LockTimeout = 60000;
      IF @lock < 0
          THROW 51000, 'Another migration run holds the schema lock.', 1;
    `);

    const raced = await new sql.Request(transaction)
      .input('name', sql.NVarChar, migration.name)
      .query('SELECT 1 AS applied FROM dbo.schema_migrations WHERE name = @name');
    if (raced.recordset.length > 0) {
      await transaction.rollback();
      return { skipped: true };
    }

    for (const batch of splitBatches(migration.text)) {
      await new sql.Request(transaction).batch(batch);
    }
    await new sql.Request(transaction)
      .input('name', sql.NVarChar, migration.name)
      .input('checksum', sql.Char(64), migration.checksum)
      .query('INSERT INTO dbo.schema_migrations (name, checksum) VALUES (@name, @checksum)');
    await transaction.commit();
    return { skipped: false };
  } catch (err) {
    await transaction.rollback().catch(() => {});
    throw err;
  }
}

// Records every migration file as applied without executing any of them. For
// databases whose schema already contains what the migrations describe — a
// fresh one built by schema.sql, or a pre-runner deployment being adopted.
// Idempotent: files already in the history are left alone.
async function baseline(pool) {
  await ensureHistoryTable(pool);
  const applied = await appliedMigrations(pool);
  const recorded = [];
  for (const migration of listMigrations()) {
    if (applied.has(migration.name)) continue;
    await pool
      .request()
      .input('name', sql.NVarChar, migration.name)
      .input('checksum', sql.Char(64), migration.checksum)
      .query('INSERT INTO dbo.schema_migrations (name, checksum) VALUES (@name, @checksum)');
    recorded.push(migration.name);
  }
  return recorded;
}

// Read-only comparison of the database against the repository, for the boot
// check in server.js. Unlike plan(), this never creates the history table —
// observing a database at startup must not alter it, and on a database that
// has never seen the runner the missing table is itself the finding.
async function drift(pool) {
  const all = listMigrations();
  const exists = await pool
    .request()
    .query("SELECT OBJECT_ID('dbo.schema_migrations', 'U') AS id");
  if (!exists.recordset[0].id) {
    return { tracked: false, pending: all.map((m) => m.name), modified: [] };
  }
  const applied = await appliedMigrations(pool);
  return {
    tracked: true,
    pending: all.filter((m) => !applied.has(m.name)).map((m) => m.name),
    modified: all
      .filter((m) => {
        const record = applied.get(m.name);
        return record && record.checksum !== m.checksum;
      })
      .map((m) => m.name),
  };
}

// Scaffolds the next numbered migration file and returns its path. The number
// continues from the highest existing file, not from the count, so a gap left
// by a deleted draft never causes a duplicate.
function createMigration(name) {
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new Error(
      `Migration name must be lower_snake_case (got "${name}") — it becomes part of the filename.`
    );
  }
  const numbers = listMigrations().map((m) => Number(m.name.slice(0, 3)));
  const next = String((numbers.length ? Math.max(...numbers) : 0) + 1).padStart(3, '0');
  const filename = `${next}_${name}.sql`;
  const filePath = path.join(MIGRATIONS_DIR, filename);
  fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
  fs.writeFileSync(
    filePath,
    `-- ${filename}
--
-- What this changes and why. A migration runs exactly once per database, in
-- one transaction, so write it against the schema as it stands after
-- ${numbers.length ? String(Math.max(...numbers)).padStart(3, '0') : 'schema.sql'} — no need for IF COL_LENGTH guards unless the change may
-- already exist in databases built from an updated schema.sql.
--
-- Separate batches with GO where SQL Server requires it (CREATE TRIGGER,
-- CREATE VIEW, CREATE PROCEDURE must each start their own batch).
--
-- Remember to make the same change in src/config/schema.sql so a database
-- built from nothing matches one migrated forward.

`,
    'utf8'
  );
  return filePath;
}

module.exports = {
  MIGRATIONS_DIR,
  splitBatches,
  checksum,
  listMigrations,
  ensureHistoryTable,
  appliedMigrations,
  plan,
  drift,
  applyMigration,
  baseline,
  createMigration,
};
