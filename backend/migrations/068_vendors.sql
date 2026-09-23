-- vendors
--
-- New table for the Assets & Maintenance module. Guarded, so applying this to
-- a database that already has the table is a no-op.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- The people and firms who service assets. Scoped to this module only; a
-- shared procurement vendor directory is a separate decision this table
-- deliberately doesn't make.
IF OBJECT_ID('dbo.vendors', 'U') IS NULL
CREATE TABLE dbo.vendors (
    id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id        BIGINT NOT NULL REFERENCES dbo.lodges(id),
    name            NVARCHAR(120) NOT NULL,
    contact_person  NVARCHAR(80) NULL,
    phone           NVARCHAR(20) NULL,
    email           NVARCHAR(120) NULL,
    specialty       NVARCHAR(80) NULL,
    notes           NVARCHAR(400) NULL,
    is_active       BIT NOT NULL DEFAULT 1,
    created_at      DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_vendors_lodge_name UNIQUE (lodge_id, name)
);
GO
