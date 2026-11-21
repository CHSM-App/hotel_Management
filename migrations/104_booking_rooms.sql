-- Multiple rooms in one booking
--
-- bookings.room_id (015) held exactly one room. One guest / one stay / one
-- bill can now span several rooms, each with its own dates, price, extras
-- and check-in/out. dbo.booking_rooms holds one row per room of a booking
-- and is the source of truth for which rooms a booking holds.
--
-- bookings.room_id keeps mirroring the FIRST (primary) room, kept in sync,
-- so every reader that only knows bookings.room_id keeps working (same
-- back-compat trick as bookings.bed_id, 089). bookings.check_in_date /
-- check_out_date / total_price / status become the roll-up of the rooms.
--
-- Remember: the same change must also land in src/config/schema.sql.
IF OBJECT_ID('dbo.booking_rooms', 'U') IS NULL
CREATE TABLE dbo.booking_rooms (
    id                    BIGINT IDENTITY(1,1) PRIMARY KEY,
    booking_id            BIGINT NOT NULL REFERENCES dbo.bookings(id),
    room_id               BIGINT NOT NULL REFERENCES dbo.rooms(id),
    check_in_date         DATE NOT NULL,
    check_out_date        DATE NOT NULL,
    status                NVARCHAR(20) NOT NULL
        CONSTRAINT df_booking_rooms_status DEFAULT 'BOOKED'
        CONSTRAINT ck_booking_rooms_status CHECK (status IN ('BOOKED','CHECKED_IN','CHECKED_OUT','CANCELLED')),
    actual_check_in_at    DATETIMEOFFSET NULL,
    actual_check_out_at   DATETIMEOFFSET NULL,
    base_price_override   DECIMAL(10,2) NULL,
    total_price           DECIMAL(10,2) NOT NULL CONSTRAINT df_booking_rooms_total DEFAULT 0,
    nightly_breakdown     NVARCHAR(MAX) NULL
        CONSTRAINT ck_booking_rooms_breakdown CHECK (nightly_breakdown IS NULL OR ISJSON(nightly_breakdown) = 1),
    late_checkout_charge  DECIMAL(10,2) NULL,
    late_checkout_minutes INT NULL,
    food_pin              NVARCHAR(6) NULL,
    CONSTRAINT uq_booking_rooms_booking_room UNIQUE (booking_id, room_id),
    CONSTRAINT ck_booking_rooms_dates CHECK (check_out_date > check_in_date)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_booking_rooms_room_dates' AND object_id = OBJECT_ID('dbo.booking_rooms'))
    CREATE INDEX ix_booking_rooms_room_dates ON dbo.booking_rooms(room_id, check_in_date, check_out_date);
GO

-- Per-room extras (AC, extra bed). booking_switchable_charges (016) stays for
-- bookings that predate this table.
IF OBJECT_ID('dbo.booking_room_switchable_charges', 'U') IS NULL
CREATE TABLE dbo.booking_room_switchable_charges (
    booking_room_id BIGINT NOT NULL REFERENCES dbo.booking_rooms(id),
    charge_id       BIGINT NOT NULL REFERENCES dbo.switchable_charges(id),
    quantity        INT NOT NULL CONSTRAINT df_brsc_quantity DEFAULT 1
        CONSTRAINT ck_brsc_quantity CHECK (quantity >= 1),
    agreed_amount   DECIMAL(10,2) NULL
        CONSTRAINT ck_brsc_agreed CHECK (agreed_amount IS NULL OR agreed_amount >= 0),
    CONSTRAINT pk_booking_room_switchable_charges PRIMARY KEY (booking_room_id, charge_id)
);
GO

-- Backfill: every existing booking becomes a one-room booking.
INSERT INTO dbo.booking_rooms
    (booking_id, room_id, check_in_date, check_out_date, status, actual_check_in_at,
     actual_check_out_at, base_price_override, total_price, nightly_breakdown,
     late_checkout_charge, late_checkout_minutes, food_pin)
SELECT b.id, b.room_id, b.check_in_date, b.check_out_date, b.status, b.actual_check_in_at,
       b.actual_check_out_at, b.base_price_override, b.total_price, b.nightly_breakdown,
       b.late_checkout_charge, b.late_checkout_minutes, b.food_pin
FROM dbo.bookings b
WHERE b.check_out_date > b.check_in_date
  AND NOT EXISTS (SELECT 1 FROM dbo.booking_rooms br WHERE br.booking_id = b.id);
GO

INSERT INTO dbo.booking_room_switchable_charges (booking_room_id, charge_id, quantity, agreed_amount)
SELECT br.id, bsc.charge_id, bsc.quantity, bsc.agreed_amount
FROM dbo.booking_switchable_charges bsc
JOIN dbo.booking_rooms br ON br.booking_id = bsc.booking_id
WHERE NOT EXISTS (SELECT 1 FROM dbo.booking_room_switchable_charges x WHERE x.booking_room_id = br.id);
GO
