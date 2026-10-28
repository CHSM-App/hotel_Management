-- assets
--
-- New table for the Assets & Maintenance module. Guarded, so applying this to
-- a database that already has the table is a no-op. Depends on
-- asset_categories (067), vendors (068) and dbo.rooms — must apply after all
-- three.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- One physical piece of equipment. Location is room_id where the asset lives
-- in a room, plus free-text floor/department for anything that doesn't.
-- qr_token is a GUID, not the numeric id, so a printed/scanned QR code never
-- exposes a sequential internal id.
IF OBJECT_ID('dbo.assets', 'U') IS NULL
CREATE TABLE dbo.assets (
    id                 BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id           BIGINT NOT NULL REFERENCES dbo.lodges(id),
    category_id        BIGINT NOT NULL REFERENCES dbo.asset_categories(id),
    name               NVARCHAR(120) NOT NULL,
    asset_tag          NVARCHAR(40) NULL,
    brand              NVARCHAR(80) NULL,
    model              NVARCHAR(80) NULL,
    serial_number      NVARCHAR(120) NULL,
    purchase_date      DATE NULL,
    purchase_cost      DECIMAL(12,2) NULL
        CONSTRAINT ck_assets_purchase_cost CHECK (purchase_cost IS NULL OR purchase_cost >= 0),
    room_id            BIGINT NULL REFERENCES dbo.rooms(id),
    floor              NVARCHAR(20) NULL,
    department         NVARCHAR(60) NULL,
    location_note      NVARCHAR(200) NULL,
    vendor_id          BIGINT NULL REFERENCES dbo.vendors(id),
    warranty_expiry    DATE NULL,
    amc_expiry         DATE NULL,
    amc_coverage_note  NVARCHAR(200) NULL,
    status             NVARCHAR(20) NOT NULL DEFAULT 'IN_USE'
        CONSTRAINT ck_assets_status CHECK (status IN ('IN_USE', 'UNDER_REPAIR', 'TRANSFERRED', 'RETIRED')),
    qr_token           UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
    is_active          BIT NOT NULL DEFAULT 1,
    created_at         DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    updated_at         DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_assets_qr_token UNIQUE (qr_token)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_assets_lodge' AND object_id = OBJECT_ID('dbo.assets'))
CREATE INDEX ix_assets_lodge ON dbo.assets(lodge_id, is_active);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_assets_room' AND object_id = OBJECT_ID('dbo.assets'))
CREATE INDEX ix_assets_room ON dbo.assets(room_id) WHERE room_id IS NOT NULL;
GO
