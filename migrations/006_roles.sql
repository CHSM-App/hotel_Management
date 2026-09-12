-- roles
--
-- One table per migration, in foreign-key dependency order: this file is
-- 3 of 32 that together build the database from nothing. The number is
-- the order, so these must be applied in sequence — which the engine does.
--
-- Split out of the single baseline that preceded it; the SQL is unchanged and
-- was verified against SQL Server by building it into a scratch schema and
-- comparing the result to src/config/schema.sql.
--
-- Guarded, so applying this to a database that already has the table is a
-- no-op rather than an error.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- Roles and their permission sets. lodge_id NULL is a built-in default shared
-- by every lodge; a row with lodge_id set belongs to that lodge and, when its
-- role_key matches a built-in, overrides it.
--
-- role_key takes the database default collation on purpose: it is compared
-- column-to-column against users.role, and a mismatched collation makes that
-- join fail with "Cannot resolve the collation conflict".
IF OBJECT_ID('dbo.roles', 'U') IS NULL
CREATE TABLE dbo.roles (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id    BIGINT NULL REFERENCES dbo.lodges(id),
    role_key    NVARCHAR(40) NOT NULL,
    name        NVARCHAR(60) NOT NULL,
    description NVARCHAR(200) NULL,
    -- Marks a row shadowing a built-in key. Built-ins can be re-scoped but
    -- never deleted or renamed, so the app always has a role to fall back to.
    is_system   BIT NOT NULL DEFAULT 0,
    permissions NVARCHAR(MAX) NOT NULL DEFAULT '[]',
    is_active   BIT NOT NULL DEFAULT 1,
    created_at  DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_roles_lodge_key UNIQUE (lodge_id, role_key)
);
GO

-- Built-in defaults, seeded at their post-food-ordering permission sets. OWNER
-- deliberately holds staff.manage — without it a lodge could lock itself out of
-- that screen.
IF NOT EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'OWNER')
INSERT INTO dbo.roles (lodge_id, role_key, name, description, is_system, permissions) VALUES
    (NULL, 'OWNER', 'Owner', 'Full access to the property, its rates, billing and staff.', 1,
     '["rooms.manage","bookings.manage","billing.manage","guests.view","reports.view","staff.manage","food.manage","orders.manage"]');

IF NOT EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'RECEPTION')
INSERT INTO dbo.roles (lodge_id, role_key, name, description, is_system, permissions) VALUES
    (NULL, 'RECEPTION', 'Reception', 'Front desk — bookings, check-in/out, billing and the guest register.', 1,
     '["bookings.manage","billing.manage","guests.view","orders.manage"]');

IF NOT EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'KITCHEN')
INSERT INTO dbo.roles (lodge_id, role_key, name, description, is_system, permissions) VALUES
    (NULL, 'KITCHEN', 'Kitchen', 'Food orders only.', 1, '["orders.manage"]');
GO
