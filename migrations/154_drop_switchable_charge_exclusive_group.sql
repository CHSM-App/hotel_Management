-- Drops switchable_charges.exclusive_group, the either/or group added briefly
-- ahead of hidden_when_charge_id (migration 153), which does the job one-way.
-- A no-op where the column was never created.
--
-- Remember: schema.sql carries the same drop.

IF COL_LENGTH('dbo.switchable_charges', 'exclusive_group') IS NOT NULL
    ALTER TABLE dbo.switchable_charges DROP COLUMN exclusive_group;
GO
