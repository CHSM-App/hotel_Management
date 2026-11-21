-- Linen a cleaner changes in a room is not in the laundry's hands yet: it is on
-- a trolley until housekeeping hands it over. A CHANGED movement now waits,
-- shown in Laundry with a Receive button, until the laundry marks it received;
-- only then does it count as dirty linen the laundry can send for washing.
--
--   handover_at / handover_by   when the laundry received it, and who
--   log_id                      the room finish it came from, so one room's
--                               linen is received as one entry
--
-- Linen already recorded as changed is marked received as the column is added:
-- it has long since reached the laundry, and the dirty counts must not move.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.linen_movements', 'handover_at') IS NULL
BEGIN
    EXEC('ALTER TABLE dbo.linen_movements ADD
            handover_at DATETIMEOFFSET NULL,
            handover_by BIGINT NULL REFERENCES dbo.users(id),
            log_id      BIGINT NULL REFERENCES dbo.housekeeping_log(id)');
    EXEC('UPDATE dbo.linen_movements SET handover_at = created_at WHERE kind = ''CHANGED''');
END
GO
