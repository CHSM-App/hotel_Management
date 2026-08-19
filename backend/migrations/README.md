# Database migrations

Numbered SQL files, applied in filename order, exactly once per database.
The engine lives in `src/config/migrations.js`; `scripts/migrate.js` is the
CLI over it, `scripts/init-db.js` uses it to baseline fresh databases, and
`src/server.js` uses it to warn at boot when a database is behind the code.

## The model

- `src/config/schema.sql` builds a complete, current database from nothing.
- `backend/migrations/NNN_name.sql` carries an **existing** database forward.
  Every schema change appears in **both** places: as a new migration, and
  folded into schema.sql, so a database built today matches one migrated
  forward from last year.
- `dbo.schema_migrations` records what has run, with a SHA-256 checksum of the
  file as it was when it ran. Editing an applied migration is detected and
  refused — write a new one instead.

## Commands

```
npm run db:init                     build a fresh database from schema.sql,
                                    baseline all migrations, seed superadmin
npm run migrate                     apply pending migrations, in order, each
                                    in its own transaction
npm run migrate:status              applied / pending / modified, per file
npm run migrate:create -- <name>    scaffold the next numbered file (empty)
npm run migrate:diff                compare the database against schema.sql
                                    and report what is missing
npm run migrate:diff -- <name>      ...and write it as the next migration
npm run migrate:baseline            record everything as applied WITHOUT
                                    running it (schema already current — e.g.
                                    a deployment that predates the runner)
```

## Making a schema change

The short version: **edit schema.sql, then let `migrate:diff` write the
migration.**

1. Make the change in `src/config/schema.sql`.
2. `npm run migrate:diff` — shows what your database is missing relative to
   that file.
3. `npm run migrate:diff -- add_thing_to_table` — writes it as the next
   numbered migration.
4. **Read the generated file.** It is a draft: correct for what it covers, and
   silent about what it doesn't (see below).
5. `npm run migrate` locally; `npm test` (conventions are enforced by
   `tests/migrate.test.js`).
6. Deploy: run `npm run migrate` against production **before** restarting the
   app. The app also checks at boot and logs a warning if the database is
   behind — advisory, it does not refuse to start.

Prefer `migrate:create` over `migrate:diff` when the change is not expressible
as "what's missing" — data backfills, renames, anything with an ordering the
generator cannot infer.

### How the diff works, and what it will not do

`migrate:diff` does **not** parse schema.sql. That file is full of conditional
logic (`IF OBJECT_ID(...) IS NULL`, `EXEC('ALTER TABLE ...')`) whose effect
depends on what already exists, and a parser that got it subtly wrong would
emit confident, wrong SQL. Instead it *executes* schema.sql into a scratch
schema inside the same database, compares the two through `sys.*` catalog
views, and drops the scratch schema afterwards. The comparison is therefore
against what SQL Server actually builds.

(A scratch *schema* rather than a scratch *database* because the app's login on
shared hosting has `CREATE TABLE` and `CREATE SCHEMA` in its own database, but
not `CREATE DATABASE`.)

It generates added tables, columns and indexes. It deliberately **never**
generates:

| Change | Why not |
|---|---|
| Dropped tables/columns | Usually means schema.sql is behind, not that the object is unwanted — guessing deletes data |
| Type or nullability changes | Can truncate or fail against existing rows |
| `NOT NULL` columns with no default | SQL Server rejects these on a non-empty table; the backfill value is a decision, not a derivation |
| Constraints on new tables | PK/FK/CHECK are reported as a note to copy from schema.sql |

All four are **reported** so you know to write them by hand. A clean
`migrate:diff` means "no additive differences", not "identical".

## Guarantees

- **Ordered**: zero-padded prefixes; duplicate numbers fail the test suite.
- **Transactional**: a migration applies completely or not at all; its history
  row commits in the same transaction. (Caveat: some SQL Server DDL cannot
  roll back cleanly — keep each migration to one logical change.)
- **Tamper-evident**: checksums are line-ending-insensitive but otherwise
  strict; a modified applied file is a hard stop for `migrate` and `baseline`.
- **Concurrency-safe**: each migration takes an exclusive `sp_getapplock`
  inside its transaction and re-checks the history table, so two deploys
  running `migrate` at once serialize — the loser skips instead of reapplying.
