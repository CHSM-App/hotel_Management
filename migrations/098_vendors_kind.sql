-- vendors: scope by kind (asset / expense / income)
--
-- dbo.vendors was widened from an assets-only table into a shared payee
-- directory (see 068_vendors.sql, and the comment trail in vendors.service.js),
-- but nothing ever scoped it — every module reads and writes the exact same
-- rows, so a vendor added under Assets shows up in Expenses and Income too.
-- Existing rows are backfilled as 'expense' (that's the older shared use);
-- Assets and Income effectively start with an empty list of their own, which
-- matches what should have been true all along.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.vendors') AND name = 'kind'
)
BEGIN
    ALTER TABLE dbo.vendors ADD kind NVARCHAR(20) NOT NULL DEFAULT 'expense';

    IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'uq_vendors_lodge_name')
        ALTER TABLE dbo.vendors DROP CONSTRAINT uq_vendors_lodge_name;

    ALTER TABLE dbo.vendors ADD CONSTRAINT uq_vendors_lodge_kind_name UNIQUE (lodge_id, kind, name);
END
GO
