-- events.manage on the built-in roles.
--
-- A permission the roles never held is a section nobody can open: has_events
-- alone only says the property has a hall, and the sidebar is gated by both.
-- Applied to the built-in rows only where they are still at their shipped
-- defaults, so a lodge that has customised a built-in keeps its own set — the
-- owner grants the section from Staff & roles there.
--
-- Remember: the same change must also land in src/config/schema.sql.
IF EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'OWNER'
           AND permissions = '["rooms.manage","bookings.manage","billing.manage","guests.view","reports.view","staff.manage","food.manage","orders.manage"]')
UPDATE dbo.roles
SET permissions = '["rooms.manage","bookings.manage","billing.manage","guests.view","reports.view","staff.manage","food.manage","orders.manage","events.manage"]'
WHERE lodge_id IS NULL AND role_key = 'OWNER';
GO

IF EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'RECEPTION'
           AND permissions = '["bookings.manage","billing.manage","guests.view","orders.manage"]')
UPDATE dbo.roles
SET permissions = '["bookings.manage","billing.manage","guests.view","orders.manage","events.manage"]'
WHERE lodge_id IS NULL AND role_key = 'RECEPTION';
GO
