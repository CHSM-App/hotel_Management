-- Depreciation rate per asset category
--
-- WDV (written down value / declining balance) at Income Tax Act block
-- rates is what hotels and their CAs actually use, not straight-line — see
-- depreciation.js. The rate is set once per category (all ACs depreciate
-- the same way), not per asset, since that's how the IT Act blocks work:
-- every asset in a block shares one rate.
--
-- depreciation_block is a label only (which IT Act block this category was
-- assigned to), never read by the calculation — rate_percent is. Keeping it
-- lets the category list show "Plant & Machinery (15%)" instead of a bare
-- number an owner has to remember the reasoning for.

IF COL_LENGTH('dbo.asset_categories', 'depreciation_block') IS NULL
ALTER TABLE dbo.asset_categories ADD depreciation_block NVARCHAR(40) NULL;
GO

IF COL_LENGTH('dbo.asset_categories', 'depreciation_rate_percent') IS NULL
ALTER TABLE dbo.asset_categories ADD depreciation_rate_percent DECIMAL(5,2) NULL
    CONSTRAINT ck_asset_categories_depreciation_rate CHECK (depreciation_rate_percent IS NULL OR (depreciation_rate_percent >= 0 AND depreciation_rate_percent <= 100));
GO
