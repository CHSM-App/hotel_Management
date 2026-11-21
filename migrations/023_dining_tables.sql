-- dining_tables
--
-- One table per migration, in foreign-key dependency order: this file is
-- 20 of 32 that together build the database from nothing. The number is
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

-- A dining table, for properties doing table service. qr_token is what the
-- table's QR encodes: a random opaque string rather than the table label, so the
-- URLs can't be walked by incrementing a number. BIN2 because it is compared as
-- a URL segment and case has to matter.
IF OBJECT_ID('dbo.dining_tables', 'U') IS NULL
CREATE TABLE dbo.dining_tables (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id    BIGINT NOT NULL REFERENCES dbo.lodges(id),
    label       NVARCHAR(40) NOT NULL,
    seats       INT NULL
        CONSTRAINT ck_dining_tables_seats CHECK (seats IS NULL OR seats > 0),
    qr_token    NVARCHAR(32) COLLATE Latin1_General_BIN2 NOT NULL UNIQUE,
    is_active   BIT NOT NULL DEFAULT 1,
    created_at  DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_dining_tables_lodge_label UNIQUE (lodge_id, label)
);
GO
