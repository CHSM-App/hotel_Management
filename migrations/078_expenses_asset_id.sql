-- expenses.asset_id
--
-- Same "origin marker" pattern as recurring_template_id (076): a nullable FK
-- back to the asset that generated this expense automatically (purchase cost
-- at registration, a work order's parts/labor cost on close, a coverage
-- period's AMC/warranty cost) versus NULL for a manually-typed expense. One
-- column covers all three trigger sites since they're all asset-scoped and
-- the expense's own title already says which kind ("Asset purchase: …",
-- "Repair: …", "AMC/warranty: …").

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.expenses') AND name = 'asset_id')
ALTER TABLE dbo.expenses ADD asset_id BIGINT NULL REFERENCES dbo.assets(id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_expenses_asset' AND object_id = OBJECT_ID('dbo.expenses'))
CREATE INDEX ix_expenses_asset ON dbo.expenses(asset_id) WHERE asset_id IS NOT NULL;
GO
