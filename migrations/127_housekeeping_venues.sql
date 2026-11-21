-- Event venues on the Housekeeping board. A hall or lawn is cleaned by the same
-- staff, in the same steps, as a room, so it gets the same three things a room
-- has:
--
--   housekeeping_venues    what housekeeping itself decides about a venue —
--                          the same columns as housekeeping_rooms. Rows are
--                          made the first time the board is opened, stamped
--                          "cleaned now". Whether a venue is dirty is derived:
--                          a function ended (event_bookings.end_at) after it
--                          was last cleaned.
--   housekeeping_log.venue_id      a clean, and what was reported with it, is
--                                  for a room or for a venue. room_id becomes
--                                  nullable to allow the second.
--   linen_movements.venue_id       linen changed in a venue, on its way to the
--                                  laundry like a room's.
--
-- No existing row is changed.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF OBJECT_ID('dbo.housekeeping_venues', 'U') IS NULL
CREATE TABLE dbo.housekeeping_venues (
    venue_id            BIGINT NOT NULL PRIMARY KEY REFERENCES dbo.event_venues(id),
    lodge_id            BIGINT NOT NULL REFERENCES dbo.lodges(id),
    last_cleaned_at     DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    needs_cleaning      BIT NOT NULL DEFAULT 0,
    cleaning_started_at DATETIMEOFFSET NULL,
    cleaning_by         BIGINT NULL REFERENCES dbo.users(id),
    out_of_order        BIT NOT NULL DEFAULT 0,
    out_of_order_note   NVARCHAR(300) NULL
);
GO

IF COL_LENGTH('dbo.housekeeping_log', 'venue_id') IS NULL
BEGIN
    EXEC('ALTER TABLE dbo.housekeeping_log ADD venue_id BIGINT NULL REFERENCES dbo.event_venues(id)');
    EXEC('ALTER TABLE dbo.housekeeping_log ALTER COLUMN room_id BIGINT NULL');
END
GO

IF COL_LENGTH('dbo.linen_movements', 'venue_id') IS NULL
    EXEC('ALTER TABLE dbo.linen_movements ADD venue_id BIGINT NULL REFERENCES dbo.event_venues(id)');
GO
