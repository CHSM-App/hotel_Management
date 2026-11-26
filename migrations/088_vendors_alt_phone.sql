-- vendors: alternate phone
--
-- One phone often isn't enough for a vendor firm — the person who picked up
-- last time has moved on, or the shop has an owner's number and a separate
-- staff number. Optional, same shape as phone.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.vendors') AND name = 'alt_phone'
)
ALTER TABLE dbo.vendors ADD alt_phone NVARCHAR(20) NULL;
GO
