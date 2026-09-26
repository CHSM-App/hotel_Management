-- Event bookings: a hall, lawn or terrace let out for a birthday, wedding,
-- reception or corporate function.
--
-- This file is both halves at once: guarded CREATEs, so it builds the tables
-- from nothing alongside 004-045, and carries an existing database forward.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- ---------------------------------------------------------------------------
-- The capability
-- ---------------------------------------------------------------------------
-- Not every property has a hall to let. A fifth bit beside has_rooms and
-- serves_food, for the same reason those are bits and not an enum: a
-- rooms-only lodge with a lawn, a restaurant with a party hall, and a lodge
-- with both are all real, and each shows a different sidebar.
IF COL_LENGTH('dbo.lodges', 'has_events') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD has_events BIT NOT NULL CONSTRAINT df_lodges_has_events DEFAULT 0');
GO

-- ---------------------------------------------------------------------------
-- Venues
-- ---------------------------------------------------------------------------
-- A property may have more than one space to let — the banquet hall and the
-- lawn are booked independently and can run on the same evening. Each is its
-- own row so the diary is per venue, and a double-booking is a per-venue
-- question.
IF OBJECT_ID('dbo.event_venues', 'U') IS NULL
CREATE TABLE dbo.event_venues (
    id            BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id      BIGINT NOT NULL REFERENCES dbo.lodges(id),
    name          NVARCHAR(100) NOT NULL,
    -- How many people the space seats. Advisory: the desk is warned when a
    -- party outgrows it, not stopped — a lawn holds what the owner says it does.
    capacity_pax  INT NULL,
    -- The hire charge the quote starts from. Per slot rather than per hour:
    -- halls in this market are let by the morning, the evening or the day, and
    -- an hourly rate is not how anyone quotes a wedding. GST-inclusive, like
    -- every price in this system.
    base_charge   DECIMAL(10,2) NOT NULL CONSTRAINT df_event_venues_base_charge DEFAULT 0,
    is_active     BIT NOT NULL CONSTRAINT df_event_venues_active DEFAULT 1,
    created_at    DATETIMEOFFSET NOT NULL CONSTRAINT df_event_venues_created DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_event_venues_lodge_name UNIQUE (lodge_id, name)
);
GO

-- ---------------------------------------------------------------------------
-- Add-on catalogue
-- ---------------------------------------------------------------------------
-- Decoration, DJ, mandap, extra chairs, generator: the things a function is
-- sold with beyond the hall. The same idea as dbo.switchable_charges for a
-- stay, kept as its own table because an extra bed and a sound system are
-- priced, counted and taxed differently and share nothing but the word.
IF OBJECT_ID('dbo.event_addons', 'U') IS NULL
CREATE TABLE dbo.event_addons (
    id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id        BIGINT NOT NULL REFERENCES dbo.lodges(id),
    name            NVARCHAR(100) NOT NULL,
    -- The list price, per unit when is_per_unit is set ("chairs, ₹20 each")
    -- and for the whole thing otherwise ("DJ, ₹8,000"). What a booking
    -- actually agrees is snapshotted onto the booking's own line.
    default_amount  DECIMAL(10,2) NOT NULL CONSTRAINT df_event_addons_amount DEFAULT 0,
    is_per_unit     BIT NOT NULL CONSTRAINT df_event_addons_per_unit DEFAULT 0,
    is_active       BIT NOT NULL CONSTRAINT df_event_addons_active DEFAULT 1,
    created_at      DATETIMEOFFSET NOT NULL CONSTRAINT df_event_addons_created DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_event_addons_lodge_name UNIQUE (lodge_id, name)
);
GO

-- ---------------------------------------------------------------------------
-- Event bookings
-- ---------------------------------------------------------------------------
-- One function, from the first phone call to the settled bill.
--
-- Its own table rather than a bookings row with no room: a stay is priced by
-- the night and identified by a room, a function is priced by the slot and the
-- plate and identified by a venue, and the two share no column that means the
-- same thing. Forcing one into the other's shape would have every reader
-- branching on which it was holding.
--
-- Time is a real range, not a date pair. A wedding runs 6 pm to 1 am; the
-- stay's exclusive check_out_date could not say that, and neither could a
-- single event_date. The same two columns answer the diary ("what is on this
-- evening") and the clash check ("is the hall free 6 to 1").
--
-- status walks the way a real banquet desk does:
--   ENQUIRY    a call or a walk-in; nothing held, nothing paid
--   TENTATIVE  the date is blocked until hold_expires_at, pending the advance
--   CONFIRMED  money down; the venue is theirs
--   SETTLED    the final bill has been issued
--   CANCELLED  called off by either side
--   EXPIRED    a tentative hold that lapsed before the advance arrived
-- TENTATIVE and CONFIRMED block the venue; the rest do not.
IF OBJECT_ID('dbo.event_bookings', 'U') IS NULL
CREATE TABLE dbo.event_bookings (
    id                  BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id            BIGINT NOT NULL REFERENCES dbo.lodges(id),
    venue_id            BIGINT NOT NULL REFERENCES dbo.event_venues(id),
    event_type          NVARCHAR(20) NOT NULL
        CONSTRAINT ck_event_bookings_type
        CHECK (event_type IN ('BIRTHDAY', 'WEDDING', 'RECEPTION', 'ENGAGEMENT', 'CORPORATE', 'OTHER')),
    -- "Sharma–Patil wedding", "Aarav's 5th birthday": what the diary shows.
    title               NVARCHAR(200) NOT NULL,
    -- Whoever is paying, and how to reach them. No ID proof: a function is
    -- not a stay, and the register a lodge keeps for the police does not
    -- cover it.
    organiser_name      NVARCHAR(200) NOT NULL,
    organiser_phone     NVARCHAR(20) NOT NULL,
    organiser_alt_phone NVARCHAR(20) NULL,
    start_at            DATETIMEOFFSET NOT NULL,
    end_at              DATETIMEOFFSET NOT NULL,
    -- How the desk described the slot when taking it. Display only; the
    -- clash check reads the two instants above.
    slot                NVARCHAR(10) NOT NULL
        CONSTRAINT ck_event_bookings_slot CHECK (slot IN ('MORNING', 'EVENING', 'FULL_DAY', 'CUSTOM')),
    -- How many the organiser says are coming; the floor they agreed to pay for
    -- regardless; and the number confirmed a day or two before. Catering is
    -- billed on the larger of final and guaranteed — the guaranteed minimum is
    -- what the kitchen bought for.
    expected_pax        INT NOT NULL CONSTRAINT ck_event_bookings_expected CHECK (expected_pax >= 0),
    guaranteed_pax      INT NOT NULL CONSTRAINT df_event_bookings_guaranteed DEFAULT 0,
    final_pax           INT NULL,
    -- The quote, as agreed. venue_charge starts from the venue's base charge
    -- and is what the desk actually agreed; per_plate_rate is the catering
    -- rate, 0 when the property is not catering; the rest are derived and
    -- snapshotted so the quote the organiser was given never moves under them.
    venue_charge        DECIMAL(10,2) NOT NULL CONSTRAINT df_event_bookings_venue_charge DEFAULT 0,
    per_plate_rate      DECIMAL(10,2) NOT NULL CONSTRAINT df_event_bookings_plate DEFAULT 0,
    catering_amount     DECIMAL(10,2) NOT NULL CONSTRAINT df_event_bookings_catering DEFAULT 0,
    addons_total        DECIMAL(10,2) NOT NULL CONSTRAINT df_event_bookings_addons DEFAULT 0,
    discount_amount     DECIMAL(10,2) NOT NULL CONSTRAINT df_event_bookings_discount DEFAULT 0,
    discount_reason     NVARCHAR(100) NULL,
    total_amount        DECIMAL(10,2) NOT NULL CONSTRAINT df_event_bookings_total DEFAULT 0,
    -- The labelled lines the total is made of, frozen at the time of quoting
    -- — same rule as bookings.nightly_breakdown.
    pricing_breakdown   NVARCHAR(MAX) NULL
        CONSTRAINT ck_event_bookings_breakdown_json CHECK (pricing_breakdown IS NULL OR ISJSON(pricing_breakdown) = 1),
    -- Money held against this function. Written by the receipt paths exactly
    -- as bookings.advance_amount is, and read by the final bill as "Less
    -- Advance". Source of truth for the amount; the receipts are the paper.
    advance_amount      DECIMAL(10,2) NULL,
    advance_payment_method NVARCHAR(20) NULL
        CONSTRAINT ck_event_bookings_advance_method CHECK (advance_payment_method IN ('CASH', 'UPI', 'CARD')),
    -- The function sheet. Free text on purpose: what the kitchen, the decorator
    -- and the security guard each need to know is not the same shape twice.
    menu_notes          NVARCHAR(MAX) NULL,
    setup_notes         NVARCHAR(MAX) NULL,
    schedule_notes      NVARCHAR(MAX) NULL,
    status              NVARCHAR(10) NOT NULL CONSTRAINT df_event_bookings_status DEFAULT 'ENQUIRY'
        CONSTRAINT ck_event_bookings_status
        CHECK (status IN ('ENQUIRY', 'TENTATIVE', 'CONFIRMED', 'SETTLED', 'CANCELLED', 'EXPIRED')),
    hold_expires_at     DATETIMEOFFSET NULL,
    cancel_reason       NVARCHAR(200) NULL,
    -- What was handed back on a cancellation, if anything. Recorded, not
    -- computed: the tiered forfeit is the owner's call, made on the day.
    refund_amount       DECIMAL(10,2) NULL,
    created_by          BIGINT NULL REFERENCES dbo.users(id),
    created_at          DATETIMEOFFSET NOT NULL CONSTRAINT df_event_bookings_created DEFAULT SYSDATETIMEOFFSET(),
    updated_at          DATETIMEOFFSET NOT NULL CONSTRAINT df_event_bookings_updated DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT ck_event_bookings_range CHECK (end_at > start_at)
);
GO

-- The clash check and the diary both ask "what is on at this venue between
-- these instants".
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_event_bookings_venue_time' AND object_id = OBJECT_ID('dbo.event_bookings'))
    CREATE INDEX ix_event_bookings_venue_time ON dbo.event_bookings(venue_id, start_at, end_at) INCLUDE (status);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_event_bookings_lodge_status' AND object_id = OBJECT_ID('dbo.event_bookings'))
    CREATE INDEX ix_event_bookings_lodge_status ON dbo.event_bookings(lodge_id, status, start_at);
GO

-- ---------------------------------------------------------------------------
-- Add-ons on a booking
-- ---------------------------------------------------------------------------
-- What this function was sold with, at the price agreed for it. label and
-- unit_amount are copied off the catalogue at the time — a re-priced DJ next
-- season must not restate a wedding already quoted. addon_id is kept for
-- reporting and is NULL for a one-off line typed at the desk ("valet parking").
-- agreed_amount is the whole line, the same rule as booking_switchable_charges:
-- the desk agrees "₹1,000 for the chairs", not a per-chair figure that leaves a
-- stray paisa when multiplied back.
IF OBJECT_ID('dbo.event_booking_addons', 'U') IS NULL
CREATE TABLE dbo.event_booking_addons (
    id                BIGINT IDENTITY(1,1) PRIMARY KEY,
    event_booking_id  BIGINT NOT NULL REFERENCES dbo.event_bookings(id),
    addon_id          BIGINT NULL REFERENCES dbo.event_addons(id),
    label             NVARCHAR(100) NOT NULL,
    quantity          INT NOT NULL CONSTRAINT df_event_booking_addons_qty DEFAULT 1
        CONSTRAINT ck_event_booking_addons_qty CHECK (quantity >= 1),
    unit_amount       DECIMAL(10,2) NOT NULL CONSTRAINT df_event_booking_addons_unit DEFAULT 0,
    agreed_amount     DECIMAL(10,2) NOT NULL
        CONSTRAINT ck_event_booking_addons_agreed CHECK (agreed_amount >= 0)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_event_booking_addons_booking' AND object_id = OBJECT_ID('dbo.event_booking_addons'))
    CREATE INDEX ix_event_booking_addons_booking ON dbo.event_booking_addons(event_booking_id);
GO

-- ---------------------------------------------------------------------------
-- GST: hall hire is its own supply
-- ---------------------------------------------------------------------------
-- Renting out a hall is SAC 997212 (rental of non-residential property), a
-- flat 18% — neither banded like accommodation nor decided by the premises
-- like food. A third supply_type row, so a rate change stays an UPDATE and
-- not a deploy. Catering served with the function is billed on the FOOD rate
-- as its own line: the two are itemised separately on the document, which is
-- what lets each be reported on its own SAC.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_gst_slabs_supply')
    ALTER TABLE dbo.gst_slabs DROP CONSTRAINT ck_gst_slabs_supply;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_gst_slabs_supply')
    ALTER TABLE dbo.gst_slabs ADD CONSTRAINT ck_gst_slabs_supply
        CHECK (supply_type IN ('ACCOMMODATION', 'FOOD', 'VENUE'));
GO

IF NOT EXISTS (SELECT 1 FROM dbo.gst_slabs WHERE supply_type = 'VENUE')
    INSERT INTO dbo.gst_slabs (supply_type, max_amount, rate_percent, applies_to_specified, sac_code)
    VALUES ('VENUE', NULL, 18, NULL, '997212');
GO

-- ---------------------------------------------------------------------------
-- Money documents against a function
-- ---------------------------------------------------------------------------
-- The final bill and the advance receipt both hang off the same documents a
-- stay uses: same numbering series, same tax arithmetic, same printed form.
-- Each gains a nullable event_booking_id beside its booking_id.
--
-- On invoices, room_subtotal carries the venue side (hall plus add-ons, SAC
-- 997212) and food_subtotal carries the catering, so every reader that sums,
-- reports or prints those two columns keeps working; the document decides its
-- labels from event_booking_id being set. Recorded here because the column
-- names say "room" and someone will otherwise wonder.
IF COL_LENGTH('dbo.invoices', 'event_booking_id') IS NULL
    EXEC('ALTER TABLE dbo.invoices ADD event_booking_id BIGINT NULL REFERENCES dbo.event_bookings(id)');
GO

-- One live bill per function, like one per stay: void then reissue.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_invoices_event_active' AND object_id = OBJECT_ID('dbo.invoices'))
    EXEC('CREATE UNIQUE INDEX uq_invoices_event_active ON dbo.invoices(event_booking_id)
          WHERE status = ''ISSUED'' AND event_booking_id IS NOT NULL');
GO

-- A receipt is against a stay or against a function, never both. booking_id
-- was NOT NULL; it has to give way, and the pair is then held to exactly one
-- the way payment_lines holds its parents.
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.advance_receipts') AND name = 'booking_id' AND is_nullable = 0
)
    ALTER TABLE dbo.advance_receipts ALTER COLUMN booking_id BIGINT NULL;
GO

IF COL_LENGTH('dbo.advance_receipts', 'event_booking_id') IS NULL
    EXEC('ALTER TABLE dbo.advance_receipts ADD event_booking_id BIGINT NULL REFERENCES dbo.event_bookings(id)');
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_advance_receipts_parent')
    EXEC('ALTER TABLE dbo.advance_receipts ADD CONSTRAINT ck_advance_receipts_parent CHECK (
        (CASE WHEN booking_id IS NULL THEN 0 ELSE 1 END)
      + (CASE WHEN event_booking_id IS NULL THEN 0 ELSE 1 END) = 1)');
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_advance_receipts_event' AND object_id = OBJECT_ID('dbo.advance_receipts'))
    EXEC('CREATE INDEX ix_advance_receipts_event ON dbo.advance_receipts(event_booking_id, status)
          WHERE event_booking_id IS NOT NULL');
GO
