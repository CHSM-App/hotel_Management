-- What a cleaner reports when finishing a room (a problem, or something a guest
-- left behind) was saved on housekeeping_log and then shown nowhere. These
-- columns turn each report into something the desk can see and close:
--   issue_*   the problem, open until someone marks it fixed
--   found_*   the found item, open until it is returned or handed in
--   blocked_room  the cleaner said the room cannot be let until it is fixed
--
-- Reports older than a week are closed as they are added, so switching this on
-- does not open the Issues list on months of problems nobody remembers.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.housekeeping_log', 'issue_resolved_at') IS NULL
BEGIN
    EXEC('ALTER TABLE dbo.housekeeping_log ADD
            issue_resolved_at DATETIMEOFFSET NULL,
            issue_resolved_by BIGINT NULL REFERENCES dbo.users(id),
            issue_resolution  NVARCHAR(300) NULL,
            found_closed_at   DATETIMEOFFSET NULL,
            found_closed_by   BIGINT NULL REFERENCES dbo.users(id),
            found_resolution  NVARCHAR(300) NULL,
            blocked_room      BIT NOT NULL CONSTRAINT df_housekeeping_log_blocked DEFAULT 0');
    EXEC('UPDATE dbo.housekeeping_log SET issue_resolved_at = done_at
          WHERE issues IS NOT NULL AND done_at < DATEADD(DAY, -7, SYSDATETIMEOFFSET())');
    EXEC('UPDATE dbo.housekeeping_log SET found_closed_at = done_at
          WHERE lost_found IS NOT NULL AND done_at < DATEADD(DAY, -7, SYSDATETIMEOFFSET())');
END
GO
