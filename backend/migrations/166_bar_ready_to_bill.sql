-- Bar orders can be marked "ready to bill" (captain / reception), and reception
-- gets the bar order and billing permissions (166). Remember: the same change
-- must also land in src/config/schema.sql.
--
-- Roles are touched once, together with the column, so a role an owner later
-- trims is not overruled on a re-run. Owners are always granted the bar
-- permissions in code (roles.service getEffectiveRole).
IF COL_LENGTH('dbo.bar_orders', 'ready_to_bill_at') IS NULL
BEGIN
    EXEC('ALTER TABLE dbo.bar_orders ADD ready_to_bill_at DATETIMEOFFSET NULL');
    UPDATE dbo.roles
    SET permissions = LEFT(permissions, LEN(permissions) - 1) + ',"bar.take"]'
    WHERE role_key = 'RECEPTION' AND permissions LIKE '%]' AND permissions NOT LIKE '%"bar.take"%';
    UPDATE dbo.roles
    SET permissions = LEFT(permissions, LEN(permissions) - 1) + ',"bar.bill"]'
    WHERE role_key = 'RECEPTION' AND permissions LIKE '%]' AND permissions NOT LIKE '%"bar.bill"%';
END
