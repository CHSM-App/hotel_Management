-- Drops users.must_reset_password along with the "First login pending"
-- feature — the login flow never enforced it, it was just a badge, and the
-- password-reset UI it was tracking for has been removed.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.users', 'must_reset_password') IS NOT NULL
BEGIN
    DECLARE @constraintName NVARCHAR(200);
    SELECT @constraintName = dc.name
    FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.users') AND c.name = 'must_reset_password';

    IF @constraintName IS NOT NULL
        EXEC('ALTER TABLE dbo.users DROP CONSTRAINT ' + @constraintName);

    EXEC('ALTER TABLE dbo.users DROP COLUMN must_reset_password');
END
GO
