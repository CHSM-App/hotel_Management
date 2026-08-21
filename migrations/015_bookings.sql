-- bookings
--
-- One table per migration, in foreign-key dependency order: this file is
-- 12 of 32 that together build the database from nothing. The number is
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

-- ---------------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------------

-- A booking is a single room reserved for a guest over a date range.
-- total_price is a snapshot taken from the pricing engine at creation time — it
-- does not drift if categories, features or seasons change afterward.
-- check_out_date is exclusive (the last occupied night is check_out_date - 1).
IF OBJECT_ID('dbo.bookings', 'U') IS NULL
CREATE TABLE dbo.bookings (
    id                      BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id                BIGINT NOT NULL REFERENCES dbo.lodges(id),
    room_id                 BIGINT NOT NULL REFERENCES dbo.rooms(id),
    guest_name              NVARCHAR(200) NOT NULL,
    guest_phone             NVARCHAR(20) NOT NULL,
    num_guests              INT NOT NULL DEFAULT 1 CHECK (num_guests >= 1),
    id_proof_type           NVARCHAR(30) NULL,
    -- The ID proof is uploaded (image or PDF) under uploads/id-proofs and
    -- referenced by filename. A typed-in id_proof_number is retired.
    id_proof_document       NVARCHAR(255) NULL,
    check_in_date           DATE NOT NULL,
    check_out_date          DATE NOT NULL,
    total_price             DECIMAL(10,2) NOT NULL,
    status                  NVARCHAR(20) NOT NULL DEFAULT 'BOOKED'
        CONSTRAINT ck_bookings_status CHECK (status IN ('BOOKED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED')),
    actual_check_in_at      DATETIMEOFFSET NULL,
    actual_check_out_at     DATETIMEOFFSET NULL,
    advance_amount          DECIMAL(10,2) NULL,
    advance_payment_method  NVARCHAR(20) NULL
        CONSTRAINT ck_bookings_payment_method CHECK (advance_payment_method IN ('CASH', 'UPI', 'CARD')),
    -- A UPI or card payment leaves a number on both sides — the guest's app and
    -- the property's settlement statement — and reconciling the two at month end
    -- is impossible without it. Cash needs none, so this is nullable; the
    -- requirement lives on the payment method, in the schemas.
    advance_reference       NVARCHAR(64) NULL,
    -- Snapshot of the per-night price breakdown computed at booking time, same
    -- [{date, total}] shape as pricing.service.js's priceStay(). Billing taxes
    -- each night on its actual rate instead of an average, and never re-runs the
    -- pricing engine, so a later season edit can't move an issued bill. NULL on
    -- bookings predating the column; billing falls back to an even split.
    nightly_breakdown       NVARCHAR(MAX) NULL
        CONSTRAINT ck_bookings_nightly_breakdown_json CHECK (nightly_breakdown IS NULL OR ISJSON(nightly_breakdown) = 1),
    -- Read, never written now: superseded by discount_amount. Stays booked at a
    -- negotiated rate keep pricing at it.
    base_price_override     DECIMAL(10,2) NULL,
    -- The concession reception agreed at the desk, once, on the whole stay after
    -- every extra was on it. Haggling happens over the total a guest is quoted,
    -- not over the per-night rate it was built from; it is spread back across the
    -- nights in nightly_breakdown so billing keeps taxing each night correctly.
    discount_amount         DECIMAL(10,2) NOT NULL CONSTRAINT df_bookings_discount DEFAULT 0,
    -- What reception actually decided, not what the policy suggested — the point
    -- of the prompt is that it can be waived for a guest whose taxi was late.
    -- Zero is a real answer meaning "waived", hence NOT NULL DEFAULT 0.
    late_checkout_charge    DECIMAL(10,2) NOT NULL CONSTRAINT df_bookings_late_charge DEFAULT 0,
    -- How far past the deadline they actually were, frozen at checkout. The
    -- charge alone doesn't say whether Rs 0 was a waiver or an on-time
    -- departure, and that is the first question asked of a disputed bill.
    late_checkout_minutes   INT NULL,
    -- The PIN a guest types to order from the property's food link. Issued at
    -- check-in and cleared at check-out, so it is only live while somebody is
    -- actually staying in that room.
    food_pin                NVARCHAR(6) NULL,
    created_by              BIGINT NULL REFERENCES dbo.users(id),
    created_at              DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT ck_bookings_dates CHECK (check_out_date > check_in_date)
);
GO

-- Speeds up the overlap check (room + date range) run on every new booking, and
-- the tape chart's per-room date-range query.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_bookings_room_dates' AND object_id = OBJECT_ID('dbo.bookings'))
    CREATE INDEX ix_bookings_room_dates ON dbo.bookings(room_id, check_in_date, check_out_date);
GO

-- The returning-guest suggestions offered while a name is typed into the booking
-- form, which run a debounced query per keystroke. The search matches anywhere
-- in the name, so this can't seek on the name itself — what it does is keep the
-- scan inside one lodge and carry every column the suggestion list reads, so the
-- query never touches the table.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_bookings_lodge_guest_name' AND object_id = OBJECT_ID('dbo.bookings'))
    CREATE INDEX ix_bookings_lodge_guest_name ON dbo.bookings(lodge_id, guest_name)
        INCLUDE (guest_phone, id_proof_type, id_proof_document, check_in_date, status);
GO
