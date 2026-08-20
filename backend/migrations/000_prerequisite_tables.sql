-- The two tables that 001 and 002 assume already exist.
--
-- Why this file exists
-- --------------------
-- 001_login_attempts.sql and 002_lodge_marathi_masthead.sql were written for a
-- database that already had dbo.login_attempts' neighbours and dbo.lodges — at
-- the time, the only way to get a database was schema.sql, so a migration could
-- safely assume the table it altered was there.
--
-- The numbered files now build a database from nothing (004 onwards, one table
-- each). That replay reaches 001 and 002 before 004 creates dbo.lodges, and
-- 002's ALTER fails: COL_LENGTH returns NULL for a missing *table* just as it
-- does for a missing column, so its guard passes and the ALTER runs anyway.
--
-- 001 and 002 are applied in production and their checksums are recorded, so
-- editing them is a hard stop for `migrate` and `baseline` (see
-- src/config/migrations.js). Rather than change them, this file runs first and
-- makes their assumption true.
--
-- What it deliberately does NOT do
-- --------------------------------
-- These are the minimum shapes 001 and 002 need to apply — not the finished
-- tables. 004_lodges.sql and 034_login_attempts.sql define the real ones, with
-- every column, constraint and index. Both are guarded on the table's existence,
-- so on a from-scratch build they find these already here and become no-ops,
-- and the columns they would have added arrive from the ALTERs in 001/002 and
-- from 004's own guarded statements.
--
-- On an existing database (production) both tables are already present, so this
-- file changes nothing at all — it is recorded as applied and moves on.
--
-- Keep the column definitions here byte-identical to their counterparts in
-- 004_lodges.sql and src/config/schema.sql. They are the same columns.

-- The tenancy root. Only the columns that exist independently of any later
-- migration; 002 adds name_mr/address_mr, and 004 fills in the rest.
IF OBJECT_ID('dbo.lodges', 'U') IS NULL
CREATE TABLE dbo.lodges (
    id                     BIGINT IDENTITY(1,1) PRIMARY KEY,
    name                   NVARCHAR(200) NOT NULL,
    slug                   NVARCHAR(200) COLLATE Latin1_General_BIN2 NOT NULL UNIQUE,
    phone                  NVARCHAR(20) NULL,
    whatsapp_number        NVARCHAR(20) NULL,
    address                NVARCHAR(500) NULL,
    city                   NVARCHAR(100) NULL,
    state                  NVARCHAR(100) NULL,
    checkin_mode           NVARCHAR(20) NOT NULL DEFAULT 'HOUR_24'
        CONSTRAINT ck_lodges_checkin_mode CHECK (checkin_mode IN ('HOUR_24', 'NIGHT_BASED')),
    is_gst_registered      BIT NOT NULL DEFAULT 0,
    gstin                  NVARCHAR(15) NULL,
    is_specified_premises  BIT NOT NULL DEFAULT 0,
    is_active              BIT NOT NULL DEFAULT 1,
    created_at             DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

-- 001 creates this table itself, guarded, and then indexes it. It is included
-- here only so that this file and 034_login_attempts.sql describe the same
-- shape; whichever of the three runs first wins and the others no-op.
IF OBJECT_ID('dbo.login_attempts', 'U') IS NULL
CREATE TABLE dbo.login_attempts (
    identifier       NVARCHAR(255) NOT NULL,
    door             NVARCHAR(10) NOT NULL
        CONSTRAINT ck_login_attempts_door CHECK (door IN ('STAFF', 'ADMIN')),
    failed_count     INT NOT NULL DEFAULT 0,
    first_failed_at  DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    last_failed_at   DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    locked_until     DATETIMEOFFSET NULL,
    CONSTRAINT pk_login_attempts PRIMARY KEY (identifier, door)
);
GO
