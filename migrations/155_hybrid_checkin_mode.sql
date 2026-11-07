-- HYBRID check-in mode: early arrivals get 24 hours, later ones a fixed checkout
--
-- A guest arriving before check_in_time (but not before early_arrival_from) is
-- due out 24 hours after they walked in, so a 10:00 arrival leaves at 10:00 the
-- next day. A guest arriving at or after check_in_time is due out at the fixed
-- check_out_time on the departure date. Opt-in; every other mode is untouched.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_lodges_checkin_mode')
    ALTER TABLE dbo.lodges DROP CONSTRAINT ck_lodges_checkin_mode;
GO

ALTER TABLE dbo.lodges WITH CHECK
    ADD CONSTRAINT ck_lodges_checkin_mode CHECK (checkin_mode IN ('HOUR_24', 'NIGHT_BASED', 'CYCLE', 'HYBRID'));
GO

-- The earliest arrival that still counts as "early". NULL means any time before
-- check_in_time qualifies; set it (say 06:00) so a 3am arrival, who is really
-- still in the previous night, keeps the fixed checkout instead of a 3am one.
IF COL_LENGTH('dbo.lodges', 'early_arrival_from') IS NULL
    ALTER TABLE dbo.lodges ADD early_arrival_from TIME(0) NULL;
GO
