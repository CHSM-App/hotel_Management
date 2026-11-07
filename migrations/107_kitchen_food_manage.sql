-- Kitchen can open the Menu & QR codes section (food.manage). Applied only
-- where KITCHEN is still at its shipped default; a customised role is left alone.
IF EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'KITCHEN'
           AND permissions = '["orders.manage","orders.cook"]')
UPDATE dbo.roles
SET permissions = '["orders.manage","orders.cook","food.manage"]'
WHERE lodge_id IS NULL AND role_key = 'KITCHEN';
GO
