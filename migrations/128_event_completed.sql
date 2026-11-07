-- "Mark as Completed" on a function. The desk says the function is over, which
-- hands the venue to housekeeping at once rather than at the booked end time —
-- a reception that winds up at nine does not wait for its eleven o'clock slot
-- to run out before the hall can be cleaned.
--
--   completed_at   when the desk marked it. NULL is "not marked": the booked
--                  end_at alone decides when the venue needs cleaning, as
--                  before.
--   completed_by   who marked it.
--
-- It is not a booking status. DRAFT -> CONFIRMED -> SETTLED is about the money
-- and stays as it is; a function can be completed and not yet billed, or billed
-- and not yet over.
--
-- No existing row is changed.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.event_bookings', 'completed_at') IS NULL
    EXEC('ALTER TABLE dbo.event_bookings ADD completed_at DATETIMEOFFSET NULL');
GO

IF COL_LENGTH('dbo.event_bookings', 'completed_by') IS NULL
    EXEC('ALTER TABLE dbo.event_bookings ADD completed_by BIGINT NULL REFERENCES dbo.users(id)');
GO
