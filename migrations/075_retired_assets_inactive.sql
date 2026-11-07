-- retired_assets_inactive
--
-- Data fix, not a schema change. Before this, setAssetStatus only wrote
-- status='RETIRED' and never touched is_active, so an asset retired through
-- the status dropdown kept is_active=1 and stayed in the Asset Register list
-- and its category counts. The service now sets is_active=0 whenever status
-- becomes RETIRED (and back to 1 when it's moved off RETIRED), but that only
-- takes effect on the next status change — this backfills whatever's already
-- sitting in the inconsistent state so retired assets stop showing today,
-- not just going forward.
--
-- Idempotent: re-running only touches rows still in the inconsistent state.

UPDATE dbo.assets
SET is_active = 0, updated_at = SYSDATETIMEOFFSET()
WHERE status = 'RETIRED' AND is_active = 1;
GO
