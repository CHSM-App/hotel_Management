-- Splits "food orders" into two jobs: the kitchen working the queue
-- (orders.manage) and a captain/waiter taking new orders from a table or
-- room (orders.take, new). Seeds a CAPTAIN built-in role carrying the new
-- permission. users.role has no fixed CHECK to widen — role_key is
-- validated against dbo.roles by the application, not by the column.
--
-- KITCHEN loses the ability to place new orders — it never needed to, and
-- the "+ Take an order" button on the dashboard is now gated on orders.take.
-- OWNER and RECEPTION keep placing orders too, so both pick up orders.take
-- alongside their existing orders.manage. Applied only where a role is still
-- at its shipped defaults; a lodge that has customised one keeps its own set.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'OWNER'
           AND permissions = '["rooms.manage","bookings.manage","billing.manage","guests.view","reports.view","staff.manage","food.manage","orders.manage","events.manage","assets.manage","expenses.manage"]')
UPDATE dbo.roles
SET permissions = '["rooms.manage","bookings.manage","billing.manage","guests.view","reports.view","staff.manage","food.manage","orders.manage","orders.take","events.manage","assets.manage","expenses.manage"]'
WHERE lodge_id IS NULL AND role_key = 'OWNER';

IF EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'RECEPTION'
           AND permissions = '["bookings.manage","billing.manage","guests.view","orders.manage","events.manage"]')
UPDATE dbo.roles
SET permissions = '["bookings.manage","billing.manage","guests.view","orders.manage","orders.take","events.manage"]'
WHERE lodge_id IS NULL AND role_key = 'RECEPTION';

-- KITCHEN's permissions are unchanged — it already had orders.manage only,
-- and orders.manage no longer implies taking new orders, so nothing to do.

IF NOT EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'CAPTAIN')
INSERT INTO dbo.roles (lodge_id, role_key, name, description, is_system, permissions) VALUES
    (NULL, 'CAPTAIN', 'Captain', 'Takes orders from tables and rooms.', 1, '["orders.take"]');
GO
