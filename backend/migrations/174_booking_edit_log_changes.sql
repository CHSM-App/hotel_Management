-- booking_edit_log (174): what changed, the device description and the invoice
-- an edit restated, next to the who/where already recorded by 165.
-- Remember: the same change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.booking_edit_log', 'device_info') IS NULL
    EXEC('ALTER TABLE dbo.booking_edit_log ADD device_info NVARCHAR(200) NULL');
GO
IF COL_LENGTH('dbo.booking_edit_log', 'changes') IS NULL
    EXEC('ALTER TABLE dbo.booking_edit_log ADD changes NVARCHAR(MAX) NULL');   -- JSON [{field, from, to}]
GO
IF COL_LENGTH('dbo.booking_edit_log', 'invoice_id') IS NULL
    EXEC('ALTER TABLE dbo.booking_edit_log ADD invoice_id BIGINT NULL');
GO
