-- Either/or extras: switchable_charges.exclusive_group
--
-- Extras that share a group name are alternatives — a booking (or a room of
-- one) can carry at most one of them. "Per person - Non AC" and "Per person -
-- AC" both set to the group "AC type" means ticking one hides the other.
-- NULL (the default) keeps an extra independent, exactly as before.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.switchable_charges', 'exclusive_group') IS NULL
    ALTER TABLE dbo.switchable_charges ADD exclusive_group NVARCHAR(50) NULL;
GO
