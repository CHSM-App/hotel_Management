-- asset_work_orders
--
-- New table for the Assets & Maintenance module. Guarded, so applying this to
-- a database that already has the table is a no-op. Depends on assets (069)
-- and vendors (068) — must apply after both.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- A breakdown report and a maintenance record in one: it opens as the issue
-- filed against an asset, and closing it is the completed service. There is
-- no separate service-history table — an asset's history is just its work
-- orders, oldest to newest.
IF OBJECT_ID('dbo.asset_work_orders', 'U') IS NULL
CREATE TABLE dbo.asset_work_orders (
    id                 BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id           BIGINT NOT NULL REFERENCES dbo.lodges(id),
    asset_id           BIGINT NOT NULL REFERENCES dbo.assets(id),
    issue_type         NVARCHAR(20) NOT NULL DEFAULT 'BREAKDOWN'
        CONSTRAINT ck_wo_issue_type CHECK (issue_type IN ('BREAKDOWN', 'ROUTINE_SERVICE')),
    description        NVARCHAR(400) NOT NULL,
    status             NVARCHAR(20) NOT NULL DEFAULT 'OPEN'
        CONSTRAINT ck_wo_status CHECK (status IN ('OPEN', 'IN_PROGRESS', 'CLOSED')),
    reported_by        BIGINT NULL REFERENCES dbo.users(id),
    assigned_to_name   NVARCHAR(80) NULL,
    vendor_id          BIGINT NULL REFERENCES dbo.vendors(id),
    parts_cost         DECIMAL(12,2) NULL
        CONSTRAINT ck_wo_parts_cost CHECK (parts_cost IS NULL OR parts_cost >= 0),
    labor_cost         DECIMAL(12,2) NULL
        CONSTRAINT ck_wo_labor_cost CHECK (labor_cost IS NULL OR labor_cost >= 0),
    parts_used_note    NVARCHAR(400) NULL,
    is_warranty_claim  BIT NOT NULL DEFAULT 0,
    resolution_note    NVARCHAR(400) NULL,
    opened_at          DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    closed_at          DATETIMEOFFSET NULL,
    created_at         DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    updated_at         DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_wo_lodge' AND object_id = OBJECT_ID('dbo.asset_work_orders'))
CREATE INDEX ix_wo_lodge ON dbo.asset_work_orders(lodge_id, status);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_wo_asset' AND object_id = OBJECT_ID('dbo.asset_work_orders'))
CREATE INDEX ix_wo_asset ON dbo.asset_work_orders(asset_id, id DESC);
GO
