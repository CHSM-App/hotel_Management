-- Quotations for Event / Restaurant / Bar (179). One table, a `kind` column. Non-room kinds have no
-- check-in/out dates, so those go nullable; `valid_until` is the day the quote stops being valid
-- (NULL for ROOM, which still expires on its check-in date). `booked_ref_id` is the converted
-- event / food order / bar order. Remember: the same change must also land in src/config/schema.sql.
IF COL_LENGTH('dbo.lodge_quotations', 'kind') IS NULL
    EXEC('ALTER TABLE dbo.lodge_quotations ADD kind NVARCHAR(10) NOT NULL CONSTRAINT df_lodge_quotations_kind DEFAULT ''ROOM''');
GO
IF COL_LENGTH('dbo.lodge_quotations', 'valid_until') IS NULL
    EXEC('ALTER TABLE dbo.lodge_quotations ADD valid_until DATE NULL');
GO
IF COL_LENGTH('dbo.lodge_quotations', 'booked_ref_id') IS NULL
    EXEC('ALTER TABLE dbo.lodge_quotations ADD booked_ref_id BIGINT NULL');
GO
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.lodge_quotations') AND name = 'check_in_date' AND is_nullable = 0)
    EXEC('ALTER TABLE dbo.lodge_quotations ALTER COLUMN check_in_date DATE NULL');
GO
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.lodge_quotations') AND name = 'last_check_out_date' AND is_nullable = 0)
    EXEC('ALTER TABLE dbo.lodge_quotations ALTER COLUMN last_check_out_date DATE NULL');
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_lodge_quotations_kind')
    EXEC('ALTER TABLE dbo.lodge_quotations ADD CONSTRAINT ck_lodge_quotations_kind CHECK (kind IN (''ROOM'', ''EVENT'', ''FOOD'', ''BAR''))');
GO
