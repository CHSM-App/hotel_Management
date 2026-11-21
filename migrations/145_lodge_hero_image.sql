-- The public page's hero background: an owner or Vengurla Tech staff can set
-- one directly (PUT /me/lodge/hero-image, PUT /internal/lodges/:id/hero-image).
-- Left NULL, the page falls back to the first room/venue photo, as it always
-- has. Served from its own static mount the same way logo_path is — see
-- middleware/heroImageUpload.js and app.js's '/lodge-hero-images' mount.
IF COL_LENGTH('dbo.lodges', 'hero_image_path') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD hero_image_path NVARCHAR(500) NULL');
GO
