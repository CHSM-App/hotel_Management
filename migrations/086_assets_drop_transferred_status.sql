-- assets.status: drop TRANSFERRED
--
-- TRANSFERRED never did more than any other status pick — no target
-- location, no history entry, nothing distinguishing it from "someone set
-- this asset's status" in general. Dropping it; existing TRANSFERRED assets
-- become IN_USE (they're still in active service, just not tracked as
-- moved).

UPDATE dbo.assets SET status = 'IN_USE' WHERE status = 'TRANSFERRED';
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_assets_status')
ALTER TABLE dbo.assets DROP CONSTRAINT ck_assets_status;
GO

ALTER TABLE dbo.assets ADD CONSTRAINT ck_assets_status
    CHECK (status IN ('IN_USE', 'UNDER_REPAIR', 'RETIRED'));
GO
