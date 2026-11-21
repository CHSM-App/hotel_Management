-- dbo.lodge_settings: one row per lodge for NEW per-property settings (the
-- older flags stay on dbo.lodges, untouched). First tenants are the WhatsApp
-- auto/manual switches: 1 = sent automatically, 0 = staff send it by hand.
-- Defaults equal what the app did before this table existed, so no lodge's
-- behaviour changes until someone flips a switch.
--
-- Additive only: creates a table and fills it; never alters dbo.lodges.
-- Remember: the same change must also land in src/config/schema.sql.

IF OBJECT_ID('dbo.lodge_settings', 'U') IS NULL
CREATE TABLE dbo.lodge_settings (
    lodge_id         BIGINT NOT NULL CONSTRAINT pk_lodge_settings PRIMARY KEY
                     CONSTRAINT fk_lodge_settings_lodge REFERENCES dbo.lodges(id),
    wa_auto_bill     BIT NOT NULL CONSTRAINT df_lodge_settings_wa_auto_bill DEFAULT 1,
    wa_auto_receipt  BIT NOT NULL CONSTRAINT df_lodge_settings_wa_auto_receipt DEFAULT 0,
    wa_auto_booking  BIT NOT NULL CONSTRAINT df_lodge_settings_wa_auto_booking DEFAULT 1,
    wa_auto_walkin   BIT NOT NULL CONSTRAINT df_lodge_settings_wa_auto_walkin DEFAULT 1,
    wa_auto_cancel   BIT NOT NULL CONSTRAINT df_lodge_settings_wa_auto_cancel DEFAULT 1,
    updated_at       DATETIMEOFFSET NOT NULL CONSTRAINT df_lodge_settings_updated_at DEFAULT SYSDATETIMEOFFSET()
);
GO

INSERT INTO dbo.lodge_settings (lodge_id)
SELECT l.id FROM dbo.lodges l
WHERE NOT EXISTS (SELECT 1 FROM dbo.lodge_settings s WHERE s.lodge_id = l.id);
GO
