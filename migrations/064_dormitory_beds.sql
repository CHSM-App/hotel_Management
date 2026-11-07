-- Dormitory beds
--
-- dbo.rooms.beds (040) is descriptive JSON on purpose — "nothing queries a
-- bed" was true until now. A dormitory room sells its beds individually, so
-- unlike an ordinary multi-bed room, something does query a bed: booking,
-- pricing and the overlap check all need a bed as a real row, not a count.
-- This graduates dormitory beds only, for rooms opted into it — an ordinary
-- room's beds JSON is untouched and this table stays empty for it.
--
-- Remember: the same change must also land in src/config/schema.sql.
IF COL_LENGTH('dbo.rooms', 'is_dormitory') IS NULL
    EXEC('ALTER TABLE dbo.rooms ADD is_dormitory BIT NOT NULL CONSTRAINT df_rooms_is_dormitory DEFAULT 0');
GO

-- One row per physical bed. price_override is this bed's own nightly rate (a
-- window bunk costs more than an aisle one); NULL falls back to the room's
-- category base_price, the same fallback base_price_override already uses on
-- a booking — a bed that has never been priced individually is priced
-- exactly as if it weren't a dormitory bed at all.
IF OBJECT_ID('dbo.dormitory_beds', 'U') IS NULL
CREATE TABLE dbo.dormitory_beds (
    id             BIGINT IDENTITY(1,1) PRIMARY KEY,
    room_id        BIGINT NOT NULL REFERENCES dbo.rooms(id),
    bed_label      NVARCHAR(20) NOT NULL,
    price_override DECIMAL(10,2) NULL
        CONSTRAINT ck_dormitory_beds_price CHECK (price_override IS NULL OR price_override > 0),
    is_active      BIT NOT NULL DEFAULT 1,
    created_at     DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_dormitory_beds_room_label UNIQUE (room_id, bed_label)
);
GO

-- Which bed a booking holds, when it holds one bed rather than the whole
-- room. NULL means a whole-room booking: unchanged behaviour for every
-- non-dormitory room, and on a dormitory room deliberately how a buyout is
-- represented — not a separate flag, because a buyout is in every other
-- respect exactly the whole-room booking this table already knew how to
-- hold (same pricing path, same check-in/out, same billing).
IF COL_LENGTH('dbo.bookings', 'bed_id') IS NULL
    EXEC('ALTER TABLE dbo.bookings ADD bed_id BIGINT NULL REFERENCES dbo.dormitory_beds(id)');
GO

-- Mirrors ix_bookings_room_dates but keyed on the bed, so a bed-level
-- overlap check (bed_id, dates) seeks instead of scanning every booking on
-- the room. Doesn't replace the room-keyed index — a buyout check still
-- needs "any booking on this room_id", bed or not, and that index still
-- carries it. Filtered so ordinary-room bookings never touch it.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_bookings_bed_dates' AND object_id = OBJECT_ID('dbo.bookings'))
    CREATE INDEX ix_bookings_bed_dates ON dbo.bookings(bed_id, check_in_date, check_out_date)
        WHERE bed_id IS NOT NULL;
GO
