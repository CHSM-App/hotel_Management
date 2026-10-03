-- Three more built-in roles, each a single existing permission (or pair)
-- under a job title an owner would otherwise recreate by hand:
--
--   EVENTS_MANAGER — events.manage. Only offered where hasEvents is set —
--   roleAvailableFor hides it at a property with no function diary, same as
--   KITCHEN at a rooms-only lodge.
--   ASSETS_MANAGER — assets.manage. No capability gate: every property type
--   has equipment to track.
--   ACCOUNTANT — billing.manage and expenses.manage. Also no capability
--   gate — every property bills guests and logs its own costs.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF NOT EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'EVENTS_MANAGER')
INSERT INTO dbo.roles (lodge_id, role_key, name, description, is_system, permissions) VALUES
    (NULL, 'EVENTS_MANAGER', 'Events Manager', 'Runs the function diary — enquiries, quotes and event bills.', 1,
     '["events.manage"]');

IF NOT EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'ASSETS_MANAGER')
INSERT INTO dbo.roles (lodge_id, role_key, name, description, is_system, permissions) VALUES
    (NULL, 'ASSETS_MANAGER', 'Assets Manager', 'Equipment, warranty/AMC and maintenance work orders.', 1,
     '["assets.manage"]');

IF NOT EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'ACCOUNTANT')
INSERT INTO dbo.roles (lodge_id, role_key, name, description, is_system, permissions) VALUES
    (NULL, 'ACCOUNTANT', 'Accountant', 'Billing, payments and property expenses.', 1,
     '["billing.manage","expenses.manage"]');
GO
