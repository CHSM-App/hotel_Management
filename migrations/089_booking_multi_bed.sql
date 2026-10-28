-- Multiple dormitory beds in one booking
--
-- bookings.bed_id (064) holds exactly one bed (or NULL for a whole-room
-- stay). The desk now needs to book several beds for one party in a single
-- booking — one guest name, one stay, one bill, several beds.
--
-- A booking that holds two or more beds gets one row here per bed (bed_id
-- also mirrors the first of them, kept in sync, so every existing reader
-- that only ever looked at bookings.bed_id — a bill line, a tape-chart cell —
-- still sees a real bed and keeps working unchanged). A booking that holds
-- only one bed, or the whole room, or isn't a dormitory booking at all,
-- gets no rows here at all: bed_id alone still describes it completely,
-- exactly as before this table existed.
--
-- Remember: the same change must also land in src/config/schema.sql.
IF OBJECT_ID('dbo.booking_beds', 'U') IS NULL
CREATE TABLE dbo.booking_beds (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    booking_id  BIGINT NOT NULL REFERENCES dbo.bookings(id),
    bed_id      BIGINT NOT NULL REFERENCES dbo.dormitory_beds(id),
    CONSTRAINT uq_booking_beds_booking_bed UNIQUE (booking_id, bed_id)
);
GO

-- Every bed a booking holds, its own bed_id included, is looked up by
-- booking_id far more often than the reverse (pricing, billing, editing) —
-- indexed for that direction. bed_id's own overlap check still goes through
-- ix_bookings_bed_dates on the bookings table itself, since availability is
-- asked per bed/date, not per booking.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_booking_beds_booking' AND object_id = OBJECT_ID('dbo.booking_beds'))
    CREATE INDEX ix_booking_beds_booking ON dbo.booking_beds(booking_id);
GO
