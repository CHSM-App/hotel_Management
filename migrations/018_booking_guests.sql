-- booking_guests
--
-- One table per migration, in foreign-key dependency order: this file is
-- 15 of 32 that together build the database from nothing. The number is
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

-- The primary guest stays on dbo.bookings; this holds every *additional*
-- occupant, each with their own optional phone and ID proof.
--
-- is_child: booking asks for adults and children separately, so a room of six
-- reads as "4 adults and 2 children". The primary guest is always an adult, and
-- adults are derived as num_guests minus the children on file rather than
-- counted from this table, so older bookings still add up.
IF OBJECT_ID('dbo.booking_guests', 'U') IS NULL
CREATE TABLE dbo.booking_guests (
    id                 BIGINT IDENTITY(1,1) PRIMARY KEY,
    booking_id         BIGINT NOT NULL REFERENCES dbo.bookings(id),
    guest_name         NVARCHAR(200) NOT NULL,
    guest_phone        NVARCHAR(20) NULL,
    id_proof_type      NVARCHAR(30) NULL,
    id_proof_document  NVARCHAR(255) NULL,
    is_child           BIT NOT NULL CONSTRAINT df_booking_guests_is_child DEFAULT 0,
    created_at         DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_booking_guests_booking' AND object_id = OBJECT_ID('dbo.booking_guests'))
    CREATE INDEX ix_booking_guests_booking ON dbo.booking_guests(booking_id);
GO
