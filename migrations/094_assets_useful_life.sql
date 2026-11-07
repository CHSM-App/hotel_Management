-- Expected useful life per asset
--
-- Entered once at registration — how long the hotel expects to actually use
-- this specific unit, in whole years plus months. This drives a simple
-- straight-line depreciation estimate shown on the registration form
-- (purchase cost / useful life), informational only — it never feeds the
-- P/L report, which uses the category's WDV rate instead (migration 093).
-- The two are different questions: WDV is what the books/CA use, this is
-- "roughly how much is this AC costing us a year".

IF COL_LENGTH('dbo.assets', 'useful_life_years') IS NULL
ALTER TABLE dbo.assets ADD useful_life_years TINYINT NULL
    CONSTRAINT ck_assets_useful_life_years CHECK (useful_life_years IS NULL OR useful_life_years >= 0);
GO

IF COL_LENGTH('dbo.assets', 'useful_life_months') IS NULL
ALTER TABLE dbo.assets ADD useful_life_months TINYINT NULL
    CONSTRAINT ck_assets_useful_life_months CHECK (useful_life_months IS NULL OR (useful_life_months >= 0 AND useful_life_months <= 11));
GO
