-- profitLoss.view on the OWNER and ACCOUNTANT built-in roles.
--
-- The Profit & Loss report combines expense-category and income-category
-- detail that expenses.manage/income.manage individually gate elsewhere —
-- without its own permission, anyone with reports.view alone could see that
-- detail through this one tab despite being denied Expenses/Other Income
-- directly. profitLoss.view is required on top of reports.view (see
-- reports.routes.js's profitLossGate), so it needs seeding here the same
-- way income.manage was (migration 096) or the two roles that should have
-- it by default won't, since permissions.js listing the key doesn't
-- retroactively grant it to any role row already in the database.
--
-- Applied only where each role is still at its shipped defaults; a lodge
-- that has customised one keeps its own set.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'OWNER'
           AND permissions = '["rooms.manage","bookings.manage","billing.manage","guests.view","reports.view","staff.manage","food.manage","orders.manage","orders.take","events.manage","assets.manage","expenses.manage","income.manage"]')
UPDATE dbo.roles
SET permissions = '["rooms.manage","bookings.manage","billing.manage","guests.view","reports.view","staff.manage","food.manage","orders.manage","orders.take","events.manage","assets.manage","expenses.manage","income.manage","profitLoss.view"]'
WHERE lodge_id IS NULL AND role_key = 'OWNER';
GO

IF EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'ACCOUNTANT'
           AND permissions = '["billing.manage","expenses.manage","events.manage","income.manage"]')
UPDATE dbo.roles
SET permissions = '["billing.manage","expenses.manage","events.manage","income.manage","profitLoss.view"]'
WHERE lodge_id IS NULL AND role_key = 'ACCOUNTANT';
GO
