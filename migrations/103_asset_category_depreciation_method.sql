-- Depreciation method per asset category
--
-- WDV (declining balance) stays the default — it is what the Income Tax Act
-- and most CAs use, and every existing category keeps it, so no P/L figure
-- changes when this runs. SLM (straight-line) charges the same amount every
-- year: rate_percent x original cost, until the asset is written down to nil.
-- The rate column from migration 093 is reused for both methods.

IF COL_LENGTH('dbo.asset_categories', 'depreciation_method') IS NULL
ALTER TABLE dbo.asset_categories ADD depreciation_method NVARCHAR(3) NOT NULL
    CONSTRAINT df_asset_categories_depreciation_method DEFAULT 'WDV'
    CONSTRAINT ck_asset_categories_depreciation_method CHECK (depreciation_method IN ('WDV', 'SLM'));
GO
