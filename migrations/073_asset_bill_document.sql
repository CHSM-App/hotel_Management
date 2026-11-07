-- bill_document on dbo.assets.
--
-- Stores the uploaded purchase bill's filename (a UUID the upload middleware
-- generated), never the original filename or a path — same reasoning as
-- dbo.bookings.id_proof_document. The file itself lives outside any
-- statically-served directory; access goes through the authenticated
-- GET /assets/:id/bill route.
--
-- Remember: the same change must also land in src/config/schema.sql.
IF COL_LENGTH('dbo.assets', 'bill_document') IS NULL
    EXEC('ALTER TABLE dbo.assets ADD bill_document NVARCHAR(255) NULL');
GO
