-- Splits cooking work out of orders.manage: accepting a pending order and
-- cancelling one stay front-of-house (orders.manage alone), but moving an
-- order through preparing/ready/delivered and ticking dishes off now needs
-- the new orders.cook permission. Without this, OWNER and RECEPTION could
-- push an order through cooking themselves — the queue screen is meant to be
-- view-plus-accept-and-cancel for them, cook-and-tick for the kitchen only.
--
-- KITCHEN is the only role that picks up orders.cook; OWNER and RECEPTION
-- keep orders.manage as before (view, accept, cancel) and lose nothing they
-- didn't already have a reason to keep. Applied only where KITCHEN is still
-- at its shipped default; a lodge that has customised it keeps its own set.
--
-- Remember: the same change must also land in src/config/schema.sql.
IF EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'KITCHEN'
           AND permissions = '["orders.manage"]')
UPDATE dbo.roles
SET permissions = '["orders.manage","orders.cook"]'
WHERE lodge_id IS NULL AND role_key = 'KITCHEN';
GO
