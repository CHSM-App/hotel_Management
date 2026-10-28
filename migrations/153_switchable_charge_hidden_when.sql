-- One-way "hide when" rule: switchable_charges.hidden_when_charge_id
--
-- An extra with this set is not offered (and can't be booked) while the extra
-- it points at is on the booking. E.g. "Extra Person Non AC" hidden when "AC"
-- is ticked. Unlike exclusive_group (migration 152) it is one-directional.
-- NULL (the default) means the extra is never hidden by another.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.switchable_charges', 'hidden_when_charge_id') IS NULL
    ALTER TABLE dbo.switchable_charges ADD hidden_when_charge_id BIGINT NULL;
GO
