-- Restaurant bills get a series of their own (167): numbered <booking code>R<n>
-- (for example SKR12), separate from the room/stay run. Allocation is the same
-- atomic UPDATE on dbo.invoice_series, under a new 'FOOD' series type. Bills
-- already issued keep the numbers they were printed with.
-- Remember: the same change must also land in src/config/schema.sql.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_invoice_series_type')
ALTER TABLE dbo.invoice_series DROP CONSTRAINT ck_invoice_series_type;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_invoice_series_type')
ALTER TABLE dbo.invoice_series ADD CONSTRAINT ck_invoice_series_type
    CHECK (series_type IN ('GST', 'NON_GST', 'ADVANCE', 'FOOD'));
GO
