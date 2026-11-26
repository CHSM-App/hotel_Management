-- One record per real person, not per stay or per booking. Today a repeat
-- guest's name, phone and ID proof live only inside each of their bookings —
-- there is no single place that says "this is Mr. Sharma, he has stayed 5
-- times and spent X". This table is that place, and the one the loyalty
-- points and marketing-message features planned for later will build on.
--
-- Matched by phone number within a lodge, not name+phone: the same guest
-- typed as "Rajesh Kumar" one visit and "R. Kumar" the next is still one
-- person by phone, which is the reliable anchor. See searchGuests() in
-- bookings.service.js for the old name+phone grouping this supersedes.
--
-- Room-side and event-side activity are kept as separate column pairs
-- (total_stays/total_room_spend vs total_events/total_event_spend) rather
-- than blended into one "total" — same shape as invoices/advance_receipts
-- already keeping booking_id and event_booking_id side by side. A person who
-- both stays in rooms and books the hall shows up once, with both kinds of
-- history, without either number losing where it came from.
--
-- loyalty_points, marketing_opt_in and tags exist now but are inert in this
-- migration — no rule earns a point and nothing sends a message yet. They're
-- here so the feature that does either doesn't need another schema change.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF OBJECT_ID('dbo.customers', 'U') IS NULL
CREATE TABLE dbo.customers (
    id                 BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id           BIGINT NOT NULL REFERENCES dbo.lodges(id),

    phone              NVARCHAR(20) NOT NULL,
    name               NVARCHAR(200) NOT NULL,
    email              NVARCHAR(255) NULL,

    id_proof_type      NVARCHAR(30) NULL,
    id_proof_number    NVARCHAR(50) NULL,
    id_proof_document  NVARCHAR(255) NULL,

    notes              NVARCHAR(1000) NULL,

    loyalty_points     INT NOT NULL CONSTRAINT df_customers_loyalty_points DEFAULT 0,
    marketing_opt_in   BIT NOT NULL CONSTRAINT df_customers_marketing_opt_in DEFAULT 0,
    tags               NVARCHAR(500) NULL,

    total_stays        INT NOT NULL CONSTRAINT df_customers_total_stays DEFAULT 0,
    total_room_spend   DECIMAL(12,2) NOT NULL CONSTRAINT df_customers_total_room_spend DEFAULT 0,
    last_stay_date     DATE NULL,

    total_events       INT NOT NULL CONSTRAINT df_customers_total_events DEFAULT 0,
    total_event_spend  DECIMAL(12,2) NOT NULL CONSTRAINT df_customers_total_event_spend DEFAULT 0,
    last_event_date    DATE NULL,

    created_at         DATETIMEOFFSET NOT NULL CONSTRAINT df_customers_created_at DEFAULT SYSDATETIMEOFFSET(),
    updated_at         DATETIMEOFFSET NOT NULL CONSTRAINT df_customers_updated_at DEFAULT SYSDATETIMEOFFSET(),

    CONSTRAINT uq_customers_lodge_phone UNIQUE (lodge_id, phone)
);
GO

-- The list screen's free-text search (by name) and the upsert hook's lookup
-- by phone are both scoped to one lodge; the unique constraint above already
-- indexes (lodge_id, phone), this covers the name side.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_customers_lodge_name' AND object_id = OBJECT_ID('dbo.customers'))
    CREATE INDEX ix_customers_lodge_name ON dbo.customers(lodge_id, name);
GO
