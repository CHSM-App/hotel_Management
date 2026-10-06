-- Laundry (hotel linen and guest laundry) becomes its own add-on, separate from
-- Housekeeping (room cleaning), so a property can have either without the other.
--
-- Nobody loses anything on the way: every property that has Housekeeping today
-- gets Laundry switched on, and every role that holds housekeeping.manage gets
-- laundry.manage beside it. Both happen once, together with the column, so an
-- owner who later unticks Laundry on a role is not overruled by a re-run.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.lodges', 'has_laundry') IS NULL
BEGIN
    EXEC('ALTER TABLE dbo.lodges ADD has_laundry BIT NOT NULL CONSTRAINT df_lodges_has_laundry DEFAULT 0');
    EXEC('UPDATE dbo.lodges SET has_laundry = 1 WHERE has_housekeeping = 1');
    UPDATE dbo.roles
    SET permissions = REPLACE(permissions, '"housekeeping.manage"', '"housekeeping.manage","laundry.manage"')
    WHERE permissions LIKE '%"housekeeping.manage"%' AND permissions NOT LIKE '%"laundry.manage"%';
END
GO

-- Who washed a batch: the outside laundry's name, or "Own laundry". Free text,
-- because a lodge has one or two of these and no reason to keep a list.
IF COL_LENGTH('dbo.linen_movements', 'washed_by') IS NULL
    EXEC('ALTER TABLE dbo.linen_movements ADD washed_by NVARCHAR(100) NULL');
GO

-- A Laundry built-in role for the property with a linen keeper or its own
-- laundry room: the Laundry section and nothing else. Same shape as
-- HOUSEKEEPING (116).
IF NOT EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'LAUNDRY')
INSERT INTO dbo.roles (lodge_id, role_key, name, description, is_system, permissions) VALUES
    (NULL, 'LAUNDRY', 'Laundry', 'Sends hotel linen for washing, receives it back and takes guest laundry.', 1, '["laundry.manage"]');
GO
