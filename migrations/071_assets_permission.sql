-- assets.manage on the OWNER built-in role.
--
-- Without this, an owner signed in on the shipped OWNER default never sees
-- the new Assets & Maintenance section — permissions.js listing the key
-- doesn't retroactively grant it to any role row already in the database.
-- Applied only where OWNER is still at its shipped defaults; a lodge that
-- has customised the role keeps its own set and grants the section itself
-- from Staff & roles. Same pattern as events.manage (migration 047).
--
-- Remember: the same change must also land in src/config/schema.sql.
IF EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'OWNER'
           AND permissions = '["rooms.manage","bookings.manage","billing.manage","guests.view","reports.view","staff.manage","food.manage","orders.manage","events.manage"]')
UPDATE dbo.roles
SET permissions = '["rooms.manage","bookings.manage","billing.manage","guests.view","reports.view","staff.manage","food.manage","orders.manage","events.manage","assets.manage"]'
WHERE lodge_id IS NULL AND role_key = 'OWNER';
GO
