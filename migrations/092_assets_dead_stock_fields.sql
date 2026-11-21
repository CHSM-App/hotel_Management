-- Dead stock register fields
--
-- "Dead stock" is just the existing RETIRED status — no new status, no new
-- table. These columns are only ever set when an asset is retired, so they
-- ride along on the same row rather than a parallel register that could
-- drift out of sync with it.

IF COL_LENGTH('dbo.assets', 'dead_date') IS NULL
ALTER TABLE dbo.assets ADD dead_date DATE NULL;
GO

IF COL_LENGTH('dbo.assets', 'dead_reason') IS NULL
ALTER TABLE dbo.assets ADD dead_reason NVARCHAR(200) NULL;
GO

IF COL_LENGTH('dbo.assets', 'disposal_note') IS NULL
ALTER TABLE dbo.assets ADD disposal_note NVARCHAR(300) NULL;
GO

IF COL_LENGTH('dbo.assets', 'recovery_cost') IS NULL
ALTER TABLE dbo.assets ADD recovery_cost DECIMAL(12,2) NULL
    CONSTRAINT ck_assets_recovery_cost CHECK (recovery_cost IS NULL OR recovery_cost >= 0);
GO

IF COL_LENGTH('dbo.assets', 'disposed_by') IS NULL
ALTER TABLE dbo.assets ADD disposed_by NVARCHAR(80) NULL;
GO
