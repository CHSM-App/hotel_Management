-- Venue rate cards (175). A venue can be hired several ways: per hour, per day,
-- or a fixed block of hours at one price. A function snapshots the rate it was
-- priced on; NULL rate_* means a booking from before rate cards (per day).
-- Remember: the same change must also land in src/config/schema.sql.
IF OBJECT_ID('dbo.event_venue_rates', 'U') IS NULL
CREATE TABLE dbo.event_venue_rates (
    id           BIGINT IDENTITY(1,1) PRIMARY KEY,
    venue_id     BIGINT NOT NULL REFERENCES dbo.event_venues(id),
    label        NVARCHAR(60) NOT NULL,
    rate_type    NVARCHAR(5) NOT NULL
        CONSTRAINT ck_event_venue_rates_type CHECK (rate_type IN ('HOUR', 'DAY', 'BLOCK')),
    amount       DECIMAL(10,2) NOT NULL CONSTRAINT ck_event_venue_rates_amount CHECK (amount >= 0),
    block_hours  DECIMAL(5,2) NULL,
    sort_order   INT NOT NULL CONSTRAINT df_event_venue_rates_sort DEFAULT 0,
    created_at   DATETIMEOFFSET NOT NULL CONSTRAINT df_event_venue_rates_created DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT ck_event_venue_rates_block CHECK (
        (rate_type = 'BLOCK' AND block_hours > 0) OR (rate_type <> 'BLOCK' AND block_hours IS NULL)
    ),
    CONSTRAINT uq_event_venue_rates_label UNIQUE (venue_id, label)
);
GO

IF COL_LENGTH('dbo.event_bookings', 'rate_type') IS NULL
    EXEC('ALTER TABLE dbo.event_bookings ADD rate_type NVARCHAR(5) NULL
            CONSTRAINT ck_event_bookings_rate_type CHECK (rate_type IN (''HOUR'', ''DAY'', ''BLOCK''))');
GO

IF COL_LENGTH('dbo.event_bookings', 'rate_label') IS NULL
    EXEC('ALTER TABLE dbo.event_bookings ADD rate_label NVARCHAR(60) NULL');
GO

IF COL_LENGTH('dbo.event_bookings', 'rate_amount') IS NULL
    EXEC('ALTER TABLE dbo.event_bookings ADD rate_amount DECIMAL(10,2) NULL');
GO

IF COL_LENGTH('dbo.event_bookings', 'rate_block_hours') IS NULL
    EXEC('ALTER TABLE dbo.event_bookings ADD rate_block_hours DECIMAL(5,2) NULL');
GO
