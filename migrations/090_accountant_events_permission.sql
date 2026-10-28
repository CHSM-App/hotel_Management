-- Adds events.manage to the Accountant built-in's default permission set, so
-- a property with the function diary switched on has its Accountant
-- reconcile event/function revenue too, the same as room and food revenue —
-- billing.manage alone left event bills outside the one role whose whole job
-- is billing and payments.
--
-- No capability gate needed beyond events.manage's own: permissionsFor and
-- validatePermissions already drop it from what a rooms-only or
-- restaurant-only lodge (no hasEvents) can see or save, the same way it's
-- already hidden from every other role there. A lodge without events simply
-- never sees or can grant it, same as before this migration.
--
-- Applied only where the global default is still at its shipped set — a
-- lodge that has already customised its own Accountant (added or removed
-- permissions via Staff & Roles) keeps exactly what it chose.
--
-- Remember: the same change must also land in src/config/schema.sql.
IF EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'ACCOUNTANT'
           AND permissions = '["billing.manage","expenses.manage"]')
UPDATE dbo.roles
SET permissions = '["billing.manage","expenses.manage","events.manage"]'
WHERE lodge_id IS NULL AND role_key = 'ACCOUNTANT';
GO
