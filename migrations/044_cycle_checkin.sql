-- Fixed check-in / checkout cycle
--
-- A third checkin_mode, CYCLE, and the check-in time that goes with it.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- ---------------------------------------------------------------------------
-- The CYCLE mode
-- ---------------------------------------------------------------------------

-- Some lodges sell a fixed cycle: check in from 11:00, out by 09:00 the next
-- morning, and that is one night whatever the clock said on arrival. A guest
-- who is still in the room past the checkout time has started the next night
-- and is charged a whole one, not a part-day late fee. Counted as the number
-- of checkout-time boundaries the stay actually crossed, minimum one.
--
-- NIGHT_BASED already turns everyone out at check_out_time but prices an
-- overstay as a percentage band; HOUR_24 counts 24 hours from arrival. Neither
-- is this, and both keep behaving exactly as before — CYCLE is opt-in.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_lodges_checkin_mode')
    ALTER TABLE dbo.lodges DROP CONSTRAINT ck_lodges_checkin_mode;
GO

ALTER TABLE dbo.lodges WITH CHECK
    ADD CONSTRAINT ck_lodges_checkin_mode CHECK (checkin_mode IN ('HOUR_24', 'NIGHT_BASED', 'CYCLE'));
GO

-- When the room is ready. Not used in the night arithmetic — the checkout time
-- alone defines the cycle — but it is what the desk quotes ("rooms from 11") and
-- the other half of the rule the owner thinks in.
IF COL_LENGTH('dbo.lodges', 'check_in_time') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD check_in_time TIME(0) NOT NULL CONSTRAINT df_lodges_check_in_time DEFAULT ''11:00:00''');
GO
