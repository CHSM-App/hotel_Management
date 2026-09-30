-- Reports & Analytics is on by default for the Owner (already has it) and the
-- Accountant. Applied only where ACCOUNTANT still carries the untouched default
-- list, so a role an owner has customised is left alone.
IF EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'ACCOUNTANT'
           AND permissions = '["billing.manage","expenses.manage","events.manage","income.manage","profitLoss.view"]')
UPDATE dbo.roles
SET permissions = '["billing.manage","expenses.manage","events.manage","income.manage","profitLoss.view","reports.view"]'
WHERE lodge_id IS NULL AND role_key = 'ACCOUNTANT';
GO
