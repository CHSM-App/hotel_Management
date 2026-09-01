-- invoices.discount_reason
--
-- Why a discount was given, printed on the bill beside the amount.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- A discount with no reason on the document reads as a favour; one that says
-- "Leaving early" reads as a rule. Free text, short, nullable — every bill
-- issued before today has no reason and prints exactly as it did. Snapshotted
-- here like every other figure on an issued bill.
IF COL_LENGTH('dbo.invoices', 'discount_reason') IS NULL
    EXEC('ALTER TABLE dbo.invoices ADD discount_reason NVARCHAR(100) NULL');
GO
