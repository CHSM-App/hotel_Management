-- Drops the built-in Events Manager and Assets Manager roles (added in 084).
-- Skipped for any role still assigned to a user, so no login is orphaned.
DELETE FROM dbo.roles
WHERE role_key IN ('EVENTS_MANAGER', 'ASSETS_MANAGER')
  AND NOT EXISTS (SELECT 1 FROM dbo.users u WHERE u.role = dbo.roles.role_key);
GO
