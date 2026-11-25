-- AI ID-card scan on the booking form (Claude vision).
--
-- ai_id_scan is a per-property switch, OFF by default: the scan costs money per
-- image, so VengurlaTech turns it on per property (super-admin edit). It lives in
-- dbo.lodge_settings with the other new switches.
--
-- ai_scan_log is a counting log only (for the monthly cap and cost review). It
-- never stores an image or anything read off one.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.lodge_settings', 'ai_id_scan') IS NULL
    EXEC('ALTER TABLE dbo.lodge_settings ADD ai_id_scan BIT NOT NULL CONSTRAINT df_lodge_settings_ai_id_scan DEFAULT 0');
GO

IF OBJECT_ID('dbo.ai_scan_log', 'U') IS NULL
CREATE TABLE dbo.ai_scan_log (
    id            BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_ai_scan_log PRIMARY KEY,
    lodge_id      BIGINT NOT NULL CONSTRAINT fk_ai_scan_log_lodge REFERENCES dbo.lodges(id),
    user_id       BIGINT NULL,
    image_count   INT NOT NULL,
    input_tokens  INT NULL,
    output_tokens INT NULL,
    status        NVARCHAR(10) NOT NULL,
    created_at    DATETIMEOFFSET NOT NULL CONSTRAINT df_ai_scan_log_created_at DEFAULT SYSDATETIMEOFFSET()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_ai_scan_log_lodge_created')
    CREATE INDEX ix_ai_scan_log_lodge_created ON dbo.ai_scan_log (lodge_id, created_at);
GO
