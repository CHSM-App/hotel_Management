-- Shareable quotation link (180): the desk's own PDF of a quotation is uploaded once and served at
-- /public/quotations/:token for 30 days, so it can go in a WhatsApp message as a link. One live
-- link per quotation: sharing again replaces the file and the token.
-- Remember: the same change must also land in src/config/schema.sql.
IF COL_LENGTH('dbo.lodge_quotations', 'share_token') IS NULL
    EXEC('ALTER TABLE dbo.lodge_quotations ADD share_token NVARCHAR(40) NULL, share_file NVARCHAR(80) NULL, share_expires_at DATETIMEOFFSET NULL');
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_lodge_quotations_share' AND object_id = OBJECT_ID('dbo.lodge_quotations'))
    EXEC('CREATE UNIQUE INDEX uq_lodge_quotations_share ON dbo.lodge_quotations(share_token) WHERE share_token IS NOT NULL');
GO
