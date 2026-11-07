-- invoice_series
--
-- One table per migration, in foreign-key dependency order: this file is
-- 23 of 32 that together build the database from nothing. The number is
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

-- One running invoice number sequence per lodge per side. Bills of supply share
-- the GST-side series (both are "GST side" documents). Allocated with an atomic
-- UPDATE ... OUTPUT in billing.service.js — never SELECT MAX()+1.
IF OBJECT_ID('dbo.invoice_series', 'U') IS NULL
CREATE TABLE dbo.invoice_series (
    id            BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id      BIGINT NOT NULL REFERENCES dbo.lodges(id),
    series_type   NVARCHAR(10) NOT NULL
        CONSTRAINT ck_invoice_series_type CHECK (series_type IN ('GST', 'NON_GST')),
    prefix        NVARCHAR(20) NOT NULL,
    next_number   INT NOT NULL DEFAULT 1,
    CONSTRAINT uq_invoice_series_lodge_type UNIQUE (lodge_id, series_type)
);
GO
