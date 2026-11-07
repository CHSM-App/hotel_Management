-- income.manage on the OWNER and ACCOUNTANT built-in roles.
--
-- Without this, an owner/accountant signed in on the shipped defaults never
-- sees the new Other Income section — permissions.js listing the key
-- doesn't retroactively grant it to any role row already in the database.
-- Applied only where each role is still at its shipped defaults; a lodge
-- that has customised one keeps its own set. Same pattern as
-- expenses.manage (migration 077) and events.manage on Accountant (090).
--
-- Remember: the same change must also land in src/config/schema.sql.

IF EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'OWNER'
           AND permissions = '["rooms.manage","bookings.manage","billing.manage","guests.view","reports.view","staff.manage","food.manage","orders.manage","orders.take","events.manage","assets.manage","expenses.manage"]')
UPDATE dbo.roles
SET permissions = '["rooms.manage","bookings.manage","billing.manage","guests.view","reports.view","staff.manage","food.manage","orders.manage","orders.take","events.manage","assets.manage","expenses.manage","income.manage"]'
WHERE lodge_id IS NULL AND role_key = 'OWNER';
GO

IF EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'ACCOUNTANT'
           AND permissions = '["billing.manage","expenses.manage","events.manage"]')
UPDATE dbo.roles
SET permissions = '["billing.manage","expenses.manage","events.manage","income.manage"]'
WHERE lodge_id IS NULL AND role_key = 'ACCOUNTANT';
GO
