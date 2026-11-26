-- rooms
--
-- One table per migration, in foreign-key dependency order: this file is
-- 6 of 32 that together build the database from nothing. The number is
-- the order, so these must be applied in sequence — which the engine does.
--
-- Split out of the single baseline that preceded it; the SQL is unchanged and
-- was verified against SQL Server by building it into a scratch schema and
-- comparing the result to src/config/schema.sql.
--
-- Guarded, so applying this to a database that already has the table is a
-- no-op rather than an error.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- billing_side (GST/NON_GST) is decided at billing time, per booking — not
-- stored here. AC is a priced feature, not a flag. There is no fixed-price
-- override: every room is always priced by category + features + season.
IF OBJECT_ID('dbo.rooms', 'U') IS NULL
CREATE TABLE dbo.rooms (
    id             BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id       BIGINT NOT NULL REFERENCES dbo.lodges(id),
    room_number    NVARCHAR(20) NOT NULL,
    category_id    BIGINT NOT NULL REFERENCES dbo.room_categories(id),
    floor          NVARCHAR(20) NULL,
    bed_size       NVARCHAR(10) NULL
        CONSTRAINT ck_rooms_bed_size CHECK (bed_size IN ('SINGLE', 'DOUBLE', 'QUEEN', 'KING')),
    bathroom_type  NVARCHAR(10) NULL
        CONSTRAINT ck_rooms_bathroom_type CHECK (bathroom_type IN ('ATTACHED', 'COMMON')),
    max_occupancy  INT NULL
        CONSTRAINT ck_rooms_max_occupancy CHECK (max_occupancy IS NULL OR max_occupancy > 0),
    description    NVARCHAR(200) NULL,
    is_active      BIT NOT NULL DEFAULT 1,
    created_at     DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_rooms_lodge_number UNIQUE (lodge_id, room_number)
);
GO
