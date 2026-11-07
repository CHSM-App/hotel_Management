-- A photo of the service — private pool, gaming area, spa — shown on its card
-- in Services & prices. Filename only, under uploads/service-images, the same
-- way a dish photo or a room photo is referenced.
IF COL_LENGTH('dbo.lodge_services', 'image_filename') IS NULL
    EXEC('ALTER TABLE dbo.lodge_services ADD image_filename NVARCHAR(255) NULL');
GO
