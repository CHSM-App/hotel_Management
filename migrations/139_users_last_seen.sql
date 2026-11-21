-- users.last_seen
--
-- Set each time the user signs in or renews their session (auth.service.js's
-- loginWithRoles and refresh), so the superadmin panel can show when a login
-- was last actually used. NULL means "never signed in".
--
-- Remember: the same change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.users', 'last_seen') IS NULL
    EXEC('ALTER TABLE dbo.users ADD last_seen DATETIMEOFFSET NULL');
GO
