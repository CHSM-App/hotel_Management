-- asset_coverage_periods
--
-- New table. Guarded, so applying this to a database that already has the
-- table is a no-op. Depends on assets (069) and vendors (068) — must apply
-- after both.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- The coverage an asset has had over its life: the maker's warranty first,
-- then an AMC, then that AMC renewed — one row per period rather than two
-- flat dates on the asset, so the vendor and terms of a lapsed period are
-- still on record after a newer one starts.
IF OBJECT_ID('dbo.asset_coverage_periods', 'U') IS NULL
CREATE TABLE dbo.asset_coverage_periods (
    id             BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id       BIGINT NOT NULL REFERENCES dbo.lodges(id),
    asset_id       BIGINT NOT NULL REFERENCES dbo.assets(id),
    coverage_type  NVARCHAR(10) NOT NULL
        CONSTRAINT ck_coverage_type CHECK (coverage_type IN ('WARRANTY', 'AMC')),
    vendor_id      BIGINT NULL REFERENCES dbo.vendors(id),
    start_date     DATE NULL,
    end_date       DATE NOT NULL,
    cost           DECIMAL(12,2) NULL
        CONSTRAINT ck_coverage_cost CHECK (cost IS NULL OR cost >= 0),
    coverage_note  NVARCHAR(200) NULL,
    created_at     DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_coverage_asset' AND object_id = OBJECT_ID('dbo.asset_coverage_periods'))
CREATE INDEX ix_coverage_asset ON dbo.asset_coverage_periods(asset_id, coverage_type, end_date DESC);
GO

-- Backfill: every asset that already has a warranty_expiry or amc_expiry
-- becomes its own first coverage row, so the history list isn't empty for
-- assets registered before this table existed.
IF COL_LENGTH('dbo.assets', 'warranty_expiry') IS NOT NULL
BEGIN
    INSERT INTO dbo.asset_coverage_periods (lodge_id, asset_id, coverage_type, vendor_id, end_date)
    SELECT lodge_id, id, 'WARRANTY', vendor_id, warranty_expiry
    FROM dbo.assets
    WHERE warranty_expiry IS NOT NULL;

    INSERT INTO dbo.asset_coverage_periods (lodge_id, asset_id, coverage_type, vendor_id, end_date, coverage_note)
    SELECT lodge_id, id, 'AMC', vendor_id, amc_expiry, amc_coverage_note
    FROM dbo.assets
    WHERE amc_expiry IS NOT NULL;
END
GO
