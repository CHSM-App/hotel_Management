-- A property's logo, shown before its name in the dashboard's brand mark and,
-- when the owner opts in, printed on the bill masthead alongside the name.
--
-- logo_path stores the file's relative path under the uploads root (see
-- config/uploadRoot.js), not a URL — the same choice room/venue images make,
-- letting the app serve it from whatever host it happens to be answering on.
-- show_logo_on_receipt defaults off: a logo uploaded for the dashboard brand
-- mark should not silently start appearing on a legal document until the
-- owner deliberately turns it on.
--
-- Remember: the same change must also land in src/config/schema.sql.
IF COL_LENGTH('dbo.lodges', 'logo_path') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD logo_path NVARCHAR(500) NULL');
GO

IF COL_LENGTH('dbo.lodges', 'show_logo_on_receipt') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD show_logo_on_receipt BIT NOT NULL CONSTRAINT df_lodges_show_logo_on_receipt DEFAULT 0');
GO
