-- Document numbering: drop the prefixes, let the owner choose the serial.
--
-- Bills went out as "INV-1", "RCT-1" and "ADV-1" — a prefix the code chose and
-- nobody could change. Properties number their bills to match the books they
-- already keep, so the prefix is now empty by default and the starting serial
-- is the owner's to set.
--
-- Two things this migration is careful about:
--
-- 1. Numbers already issued are NOT rewritten. dbo.invoices.invoice_number and
--    dbo.advance_receipts.receipt_number hold the string that was printed and
--    handed to a guest; changing it now would make the copy in the file differ
--    from the copy in their hand. Old documents keep "INV-42"; the next one is
--    whatever serial the owner sets.
--
-- 2. It adds the uniqueness that was missing. There was NO constraint stopping
--    two documents sharing a number — the only unique index on dbo.invoices is
--    uq_invoices_booking_active, which limits a booking to one active invoice
--    and says nothing about the number. That was survivable while the counter
--    was untouchable. It stops being survivable the moment someone can set the
--    serial back to a value already used, so the guard goes in with the feature.

SET NOCOUNT ON;
GO

-- ---------------------------------------------------------------------------
-- 1. No prefix
-- ---------------------------------------------------------------------------

-- Existing rows are emptied too, not just the default. A property mid-way
-- through "INV-1..INV-40" continues at plain "41" once the owner sets it; the
-- forty already issued keep the number they were printed with.
UPDATE dbo.invoice_series SET prefix = N'' WHERE prefix <> N'';
GO

-- The column stays NOT NULL — '' is a real value meaning "no prefix", and
-- allowing NULL as well would give two ways to say the same thing.
IF EXISTS (
    SELECT 1 FROM sys.default_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.invoice_series')
      AND COL_NAME(parent_object_id, parent_column_id) = 'prefix'
)
BEGIN
    DECLARE @df SYSNAME;
    SELECT @df = name FROM sys.default_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.invoice_series')
      AND COL_NAME(parent_object_id, parent_column_id) = 'prefix';
    EXEC('ALTER TABLE dbo.invoice_series DROP CONSTRAINT ' + @df);
END;
GO

ALTER TABLE dbo.invoice_series
    ADD CONSTRAINT df_invoice_series_prefix DEFAULT N'' FOR prefix;
GO

-- ---------------------------------------------------------------------------
-- 2. Uniqueness, so a re-set serial can never duplicate a document
-- ---------------------------------------------------------------------------

-- Checked before the index is created so the failure names the problem instead
-- of surfacing as "the CREATE UNIQUE INDEX statement terminated". Duplicates
-- here mean two tax documents share a number and a human has to decide which
-- one gets renumbered — not something a migration should guess at.
IF EXISTS (
    SELECT 1 FROM dbo.invoices
    GROUP BY lodge_id, invoice_number HAVING COUNT(*) > 1
)
BEGIN
    THROW 50100, 'dbo.invoices contains duplicate invoice_number values for a lodge. Resolve them before applying this migration: SELECT lodge_id, invoice_number, COUNT(*) FROM dbo.invoices GROUP BY lodge_id, invoice_number HAVING COUNT(*) > 1;', 1;
END;
GO

IF EXISTS (
    SELECT 1 FROM dbo.advance_receipts
    GROUP BY lodge_id, receipt_number HAVING COUNT(*) > 1
)
BEGIN
    THROW 50101, 'dbo.advance_receipts contains duplicate receipt_number values for a lodge. Resolve them before applying this migration.', 1;
END;
GO

-- Scoped to the lodge: two properties on this platform number their own bills
-- independently, and "invoice 41" at one has nothing to do with "invoice 41"
-- at another.
--
-- Covers VOID rows as well as ISSUED. A voided invoice number is spent — GST
-- expects the void to remain visible in the series rather than the number
-- being handed to a different guest.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_invoices_lodge_number' AND object_id = OBJECT_ID('dbo.invoices'))
    CREATE UNIQUE INDEX uq_invoices_lodge_number ON dbo.invoices(lodge_id, invoice_number);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_advance_receipts_lodge_number' AND object_id = OBJECT_ID('dbo.advance_receipts'))
    CREATE UNIQUE INDEX uq_advance_receipts_lodge_number ON dbo.advance_receipts(lodge_id, receipt_number);
GO
