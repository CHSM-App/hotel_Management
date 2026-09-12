-- booking_vehicles
--
-- One table per migration, in foreign-key dependency order: this file is
-- 14 of 32 that together build the database from nothing. The number is
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

-- A booking can have zero or more vehicles, so they live here rather than as a
-- column on the booking.
--
-- vehicle_type is NULL-able with no default: plates recorded before reception
-- was asked what pulled up have no honest answer, and guessing one would put a
-- number in the parking count that nobody ever typed.
IF OBJECT_ID('dbo.booking_vehicles', 'U') IS NULL
CREATE TABLE dbo.booking_vehicles (
    id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    booking_id      BIGINT NOT NULL REFERENCES dbo.bookings(id),
    vehicle_number  NVARCHAR(20) NOT NULL,
    vehicle_type    NVARCHAR(20) NULL
        CONSTRAINT ck_booking_vehicles_type
        CHECK (vehicle_type IS NULL OR vehicle_type IN ('TWO_WHEELER', 'FOUR_WHEELER', 'TRAVELLER', 'BUS'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_booking_vehicles_booking' AND object_id = OBJECT_ID('dbo.booking_vehicles'))
    CREATE INDEX ix_booking_vehicles_booking ON dbo.booking_vehicles(booking_id);
GO
