-- Housekeeping's default role picked up laundry.manage automatically when
-- Laundry was split out as its own add-on (migration 119), so no existing
-- housekeeping login lost a screen it was already using. Going forward,
-- Laundry is meant to be a deliberate choice for a property, not something
-- Housekeeping is handed unasked — a lodge that wants its housekeeping staff
-- doing laundry too can still grant laundry.manage from Staff & roles.
--
-- Only the shared default (lodge_id IS NULL) is touched. Any lodge that
-- already saved its own Housekeeping permissions — with or without laundry —
-- keeps exactly what it saved; this is a go-forward default, not a
-- retroactive takeaway. Application code never writes to the lodge_id IS
-- NULL row (see roles.service.js), so it can only be in the post-119 shape
-- this targets, or already fixed by a prior run of this migration.
--
-- Remember: the same change must also land in src/config/schema.sql.

UPDATE dbo.roles
SET permissions = REPLACE(permissions, '"housekeeping.manage","laundry.manage"', '"housekeeping.manage"')
WHERE lodge_id IS NULL
  AND role_key = 'HOUSEKEEPING'
  AND permissions LIKE '%"housekeeping.manage","laundry.manage"%';
GO
