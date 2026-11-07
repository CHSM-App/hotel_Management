-- Hotel linen is registered in Asset Inventory, and Laundry reads it from there.
--
-- An asset is one thing with one tag: an AC, a geyser. Linen is a count — fifty
-- bedsheets — so three additions make room for it:
--
--   asset_categories.is_linen   marks the one category ("Hotel linen") whose
--                               assets are linen. Laundry looks for the flag,
--                               not the name.
--   assets.quantity             how many of that item the property owns. NULL
--                               for every ordinary asset, which is one unit.
--   linen_items.asset_id        the asset a laundry linen row stands for. The
--                               linen ledger keeps pointing at linen_items, so
--                               no movement is rewritten; the row takes its
--                               name and count from its asset.
--
-- Linen that was added in Laundry before this is registered as an asset the
-- first time the Laundry screen is opened (housekeeping.service.js), because a
-- tag has to be allocated for each and that is done in code.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.asset_categories', 'is_linen') IS NULL
BEGIN
    EXEC('ALTER TABLE dbo.asset_categories ADD is_linen BIT NOT NULL CONSTRAINT df_asset_categories_is_linen DEFAULT 0');
    EXEC('UPDATE dbo.asset_categories SET is_linen = 1 WHERE LOWER(LTRIM(RTRIM(name))) = ''hotel linen''');
END
GO

IF COL_LENGTH('dbo.assets', 'quantity') IS NULL
    EXEC('ALTER TABLE dbo.assets ADD quantity INT NULL CONSTRAINT ck_assets_quantity CHECK (quantity IS NULL OR quantity >= 0)');
GO

IF COL_LENGTH('dbo.linen_items', 'asset_id') IS NULL
    EXEC('ALTER TABLE dbo.linen_items ADD asset_id BIGINT NULL REFERENCES dbo.assets(id)');
GO
