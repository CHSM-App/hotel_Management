-- users
--
-- One table per migration, in foreign-key dependency order: this file is
-- 2 of 32 that together build the database from nothing. The number is
-- the order, so these must be applied in sequence — which the engine does.
--
-- Split out of the single baseline that preceded it; the SQL is unchanged and
-- was verified against SQL Server by building it into a scratch schema and
-- comparing the result to src/config/schema.sql.
--
-- Guarded, so applying this to a database that already has the table is a
-- no-op rather than an error.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- Single login table for everyone: SUPERADMIN (Vengurla Tech) has lodge_id
-- NULL; every other role must be scoped to a property.
--
-- No CHECK on role: it now carries a role_key that may name a lodge-defined
-- role in dbo.roles, validated by the application. The lodge-scope CHECK below
-- still holds the invariant that matters.
IF OBJECT_ID('dbo.users', 'U') IS NULL
CREATE TABLE dbo.users (
    id                  BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id            BIGINT NULL REFERENCES dbo.lodges(id),
    name                NVARCHAR(200) NOT NULL,
    -- Deliberately NOT `NULL UNIQUE`: a UNIQUE constraint treats NULLs as equal
    -- on SQL Server, permitting exactly one row with no email in the whole
    -- table. Email is optional (reception logs in by phone), so uniqueness is a
    -- filtered index below instead.
    email               NVARCHAR(255) NULL,
    phone               NVARCHAR(20) NOT NULL UNIQUE,
    password_hash       NVARCHAR(255) NOT NULL,
    role                NVARCHAR(20) NOT NULL DEFAULT 'OWNER',
    must_reset_password BIT NOT NULL DEFAULT 1,
    is_active           BIT NOT NULL DEFAULT 1,
    created_at          DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT ck_users_lodge_scope CHECK (
        (role = 'SUPERADMIN' AND lodge_id IS NULL) OR
        (role <> 'SUPERADMIN' AND lodge_id IS NOT NULL)
    )
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_users_email' AND object_id = OBJECT_ID('dbo.users'))
    CREATE UNIQUE INDEX uq_users_email ON dbo.users(email) WHERE email IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_users_lodge' AND object_id = OBJECT_ID('dbo.users'))
    CREATE INDEX ix_users_lodge ON dbo.users(lodge_id) WHERE lodge_id IS NOT NULL;
GO
