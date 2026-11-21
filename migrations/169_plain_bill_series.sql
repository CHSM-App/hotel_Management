-- Plain numbers for every bill series (169). Restaurant bills run 1, 2, 3 on their own
-- (invoice_series type FOOD), apart from the room/stay/event run, so the same number can
-- exist once in each series. The uniqueness rule becomes per series: number_series is
-- 'MAIN' for every existing bill and 'FOOD' for restaurant bills issued from now on.
-- Remember: the same change must also land in src/config/schema.sql.
IF COL_LENGTH('dbo.invoices', 'number_series') IS NULL
    EXEC('ALTER TABLE dbo.invoices ADD number_series NVARCHAR(10) NOT NULL CONSTRAINT df_invoices_number_series DEFAULT ''MAIN''');
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_invoices_lodge_series_number' AND object_id = OBJECT_ID('dbo.invoices'))
    CREATE UNIQUE INDEX uq_invoices_lodge_series_number ON dbo.invoices(lodge_id, number_series, invoice_number);
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_invoices_lodge_number' AND object_id = OBJECT_ID('dbo.invoices'))
    DROP INDEX uq_invoices_lodge_number ON dbo.invoices;
GO
