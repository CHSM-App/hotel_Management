-- Run once against the database before starting the API.
-- One login table for everyone: SUPERADMIN (Vengurla Tech, lodge_id NULL)
-- and lodge staff (OWNER / RECEPTION / KITCHEN, scoped to lodge_id).

IF OBJECT_ID('dbo.lodges', 'U') IS NULL
CREATE TABLE dbo.lodges (
    id                     BIGINT IDENTITY(1,1) PRIMARY KEY,
    name                   NVARCHAR(200) NOT NULL,
    slug                   NVARCHAR(200) COLLATE Latin1_General_BIN2 NOT NULL UNIQUE,
    phone                  NVARCHAR(20) NULL,
    whatsapp_number        NVARCHAR(20) NULL,
    address                NVARCHAR(500) NULL,
    -- The masthead in Devanagari, as the property wrote it — the bill prints
    -- these when its language toggle is set to Marathi, falling back to the
    -- English fields when empty. See migration 002.
    name_mr                NVARCHAR(200) NULL,
    address_mr             NVARCHAR(500) NULL,
    city                   NVARCHAR(100) NULL,
    state                  NVARCHAR(100) NULL,
    checkin_mode           NVARCHAR(20) NOT NULL DEFAULT 'HOUR_24'
        CONSTRAINT ck_lodges_checkin_mode CHECK (checkin_mode IN ('HOUR_24', 'NIGHT_BASED', 'CYCLE')),
    is_gst_registered      BIT NOT NULL DEFAULT 0,
    gstin                  NVARCHAR(15) NULL,
    is_specified_premises  BIT NOT NULL DEFAULT 0,
    is_active              BIT NOT NULL DEFAULT 1,
    created_at             DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

-- Single login table. SUPERADMIN rows have lodge_id = NULL (Vengurla
-- Tech isn't scoped to one property). Every other role must have one.
IF OBJECT_ID('dbo.users', 'U') IS NULL
CREATE TABLE dbo.users (
    id                  BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id            BIGINT NULL REFERENCES dbo.lodges(id),
    name                NVARCHAR(200) NOT NULL,
    email               NVARCHAR(255) NULL UNIQUE,
    phone               NVARCHAR(20) NOT NULL UNIQUE,
    password_hash       NVARCHAR(255) NOT NULL,
    role                NVARCHAR(20) NOT NULL DEFAULT 'OWNER'
        CONSTRAINT ck_users_role CHECK (role IN ('SUPERADMIN', 'OWNER', 'RECEPTION', 'KITCHEN')),
    must_reset_password BIT NOT NULL DEFAULT 1,
    is_active           BIT NOT NULL DEFAULT 1,
    created_at          DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT ck_users_lodge_scope CHECK (
        (role = 'SUPERADMIN' AND lodge_id IS NULL) OR
        (role <> 'SUPERADMIN' AND lodge_id IS NOT NULL)
    )
);

-- The flat rate/category-as-text version of dbo.rooms shipped for a few
-- minutes with zero real rows in it. Replaced by the category + feature
-- price-chart model below before anyone used it, so a clean drop is safe.
IF OBJECT_ID('dbo.rooms', 'U') IS NOT NULL AND COL_LENGTH('dbo.rooms', 'category_id') IS NULL
    DROP TABLE dbo.rooms;

-- A category is the room "shape" (Standard, Deluxe, ...). Its base_price is
-- the price of the cheapest version of that room — the price chart adds
-- feature amounts on top of this to compute each room's price live.
IF OBJECT_ID('dbo.room_categories', 'U') IS NULL
CREATE TABLE dbo.room_categories (
    id           BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id     BIGINT NOT NULL REFERENCES dbo.lodges(id),
    name         NVARCHAR(100) NOT NULL,
    base_price   DECIMAL(10,2) NOT NULL,
    is_active    BIT NOT NULL DEFAULT 1,
    created_at   DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_categories_lodge_name UNIQUE (lodge_id, name)
);

-- A feature is any priced characteristic a room can have (sea facing,
-- attached bathroom, balcony, ...). Each carries the amount it adds to
-- the category's base price on the chart.
IF OBJECT_ID('dbo.features', 'U') IS NULL
CREATE TABLE dbo.features (
    id           BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id     BIGINT NOT NULL REFERENCES dbo.lodges(id),
    name         NVARCHAR(100) NOT NULL,
    price_delta  DECIMAL(10,2) NOT NULL DEFAULT 0,
    is_active    BIT NOT NULL DEFAULT 1,
    created_at   DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_features_lodge_name UNIQUE (lodge_id, name)
);

-- billing_side (GST/NON_GST) is decided at billing time, per booking —
-- not stored on the room. AC is represented as a priced feature
-- (dbo.features), not a flag on the room. There is no fixed-price/pin
-- override — every room is always priced by the category+features+season
-- formula.
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

-- description — a short free-text note about the room, added after
-- dbo.rooms already existed live. No CHECK/DEFAULT, so a plain ADD is safe.
IF OBJECT_ID('dbo.rooms', 'U') IS NOT NULL AND COL_LENGTH('dbo.rooms', 'description') IS NULL
    ALTER TABLE dbo.rooms ADD description NVARCHAR(200) NULL;

-- fixed_price (the pin-a-price override) removed — no DEFAULT/CHECK on
-- this column, so a plain DROP COLUMN is safe unlike the billing_side/
-- is_ac_capable migrations above it.
IF OBJECT_ID('dbo.rooms', 'U') IS NOT NULL AND COL_LENGTH('dbo.rooms', 'fixed_price') IS NOT NULL
    ALTER TABLE dbo.rooms DROP COLUMN fixed_price;

-- bed_size / bathroom_type — descriptive only, no price impact, added
-- after dbo.rooms already existed live. EXEC(...) forces each ALTER into
-- its own sub-batch — otherwise "ADD CONSTRAINT ... CHECK (bed_size ...)"
-- fails to parse in the same batch as the ADD COLUMN just before it.
IF OBJECT_ID('dbo.rooms', 'U') IS NOT NULL AND COL_LENGTH('dbo.rooms', 'bed_size') IS NULL
BEGIN
    EXEC('ALTER TABLE dbo.rooms ADD bed_size NVARCHAR(10) NULL');
    EXEC('ALTER TABLE dbo.rooms ADD CONSTRAINT ck_rooms_bed_size CHECK (bed_size IN (''SINGLE'', ''DOUBLE'', ''QUEEN'', ''KING''))');
END

IF OBJECT_ID('dbo.rooms', 'U') IS NOT NULL AND COL_LENGTH('dbo.rooms', 'bathroom_type') IS NULL
BEGIN
    EXEC('ALTER TABLE dbo.rooms ADD bathroom_type NVARCHAR(10) NULL');
    EXEC('ALTER TABLE dbo.rooms ADD CONSTRAINT ck_rooms_bathroom_type CHECK (bathroom_type IN (''ATTACHED'', ''COMMON''))');
END

-- max_occupancy — how many guests a room sleeps, added after dbo.rooms
-- already existed live, same EXEC sub-batch pattern as bed_size/bathroom_type.
IF OBJECT_ID('dbo.rooms', 'U') IS NOT NULL AND COL_LENGTH('dbo.rooms', 'max_occupancy') IS NULL
BEGIN
    EXEC('ALTER TABLE dbo.rooms ADD max_occupancy INT NULL');
    EXEC('ALTER TABLE dbo.rooms ADD CONSTRAINT ck_rooms_max_occupancy CHECK (max_occupancy IS NULL OR max_occupancy > 0)');
END

-- Dropping a column with a DEFAULT (and, for billing_side, a CHECK) needs
-- their auto-generated constraint names looked up first — SQL Server names
-- them like DF__rooms__billing_s__<hash>, not something we can hardcode.
DECLARE @dropConstraintName NVARCHAR(200), @dropConstraintSql NVARCHAR(500);

-- billing_side moved off dbo.rooms — it's decided at billing time now.
IF OBJECT_ID('dbo.rooms', 'U') IS NOT NULL AND COL_LENGTH('dbo.rooms', 'billing_side') IS NOT NULL
BEGIN
    SELECT @dropConstraintName = dc.name
    FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.rooms') AND c.name = 'billing_side';
    IF @dropConstraintName IS NOT NULL
    BEGIN
        SET @dropConstraintSql = 'ALTER TABLE dbo.rooms DROP CONSTRAINT ' + QUOTENAME(@dropConstraintName);
        EXEC sp_executesql @dropConstraintSql;
    END

    SELECT @dropConstraintName = cc.name
    FROM sys.check_constraints cc
    JOIN sys.columns c ON c.object_id = cc.parent_object_id AND c.column_id = cc.parent_column_id
    WHERE cc.parent_object_id = OBJECT_ID('dbo.rooms') AND c.name = 'billing_side';
    IF @dropConstraintName IS NOT NULL
    BEGIN
        SET @dropConstraintSql = 'ALTER TABLE dbo.rooms DROP CONSTRAINT ' + QUOTENAME(@dropConstraintName);
        EXEC sp_executesql @dropConstraintSql;
    END

    ALTER TABLE dbo.rooms DROP COLUMN billing_side;
END

-- is_ac_capable moved off dbo.rooms — AC is already represented as a
-- priced feature via dbo.features / dbo.room_features.
IF OBJECT_ID('dbo.rooms', 'U') IS NOT NULL AND COL_LENGTH('dbo.rooms', 'is_ac_capable') IS NOT NULL
BEGIN
    SELECT @dropConstraintName = dc.name
    FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.rooms') AND c.name = 'is_ac_capable';
    IF @dropConstraintName IS NOT NULL
    BEGIN
        SET @dropConstraintSql = 'ALTER TABLE dbo.rooms DROP CONSTRAINT ' + QUOTENAME(@dropConstraintName);
        EXEC sp_executesql @dropConstraintSql;
    END

    ALTER TABLE dbo.rooms DROP COLUMN is_ac_capable;
END

IF OBJECT_ID('dbo.room_features', 'U') IS NULL
CREATE TABLE dbo.room_features (
    room_id     BIGINT NOT NULL REFERENCES dbo.rooms(id),
    feature_id  BIGINT NOT NULL REFERENCES dbo.features(id),
    CONSTRAINT pk_room_features PRIMARY KEY (room_id, feature_id)
);

-- Room photos — a small ordered gallery per room. Filenames point into
-- uploads/room-images, served from a public static mount (unlike guest ID
-- proofs, a room photo isn't sensitive, so it skips the authenticated-route
-- pattern those use).
IF OBJECT_ID('dbo.room_images', 'U') IS NULL
CREATE TABLE dbo.room_images (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    room_id     BIGINT NOT NULL REFERENCES dbo.rooms(id),
    filename    NVARCHAR(255) NOT NULL,
    sort_order  INT NOT NULL DEFAULT 0,
    created_at  DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'ix_room_images_room' AND object_id = OBJECT_ID('dbo.room_images')
)
    CREATE INDEX ix_room_images_room ON dbo.room_images(room_id);

-- A switchable charge is a variable, per-night charge (AC, extra bed) —
-- unlike dbo.features, which is constant and always priced in, a room only
-- has the *capability* for a switchable charge here. Whether it actually
-- applies on a given night is a booking-time decision (not built yet).
IF OBJECT_ID('dbo.switchable_charges', 'U') IS NULL
CREATE TABLE dbo.switchable_charges (
    id                BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id          BIGINT NOT NULL REFERENCES dbo.lodges(id),
    name              NVARCHAR(100) NOT NULL,
    charge_per_night  DECIMAL(10,2) NOT NULL,
    is_active         BIT NOT NULL DEFAULT 1,
    created_at        DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_switchable_charges_lodge_name UNIQUE (lodge_id, name)
);

-- is_counter — whether this extra is taken in counts or is simply on or off.
-- An extra bed is counted (a party of five takes three of them); AC is not,
-- it is on or it isn't. It exists so the booking form knows which extras to
-- put a count box beside, and is not something an owner configures — no
-- screen shows or sets it.
IF OBJECT_ID('dbo.switchable_charges', 'U') IS NOT NULL
   AND COL_LENGTH('dbo.switchable_charges', 'is_counter') IS NULL
    EXEC('ALTER TABLE dbo.switchable_charges ADD is_counter BIT NOT NULL
          CONSTRAINT df_switchable_charges_is_counter DEFAULT 0');

-- The Extra bed rows themselves are seeded further down, after the migration
-- that adds lodges.has_rooms — the seed reads that column, and this file runs
-- top to bottom as one batch.

-- Which rooms are capable of which switchable charge (e.g. only rooms with
-- an AC unit can ever have the AC charge switched on).
IF OBJECT_ID('dbo.room_switchable_charges', 'U') IS NULL
CREATE TABLE dbo.room_switchable_charges (
    room_id    BIGINT NOT NULL REFERENCES dbo.rooms(id),
    charge_id  BIGINT NOT NULL REFERENCES dbo.switchable_charges(id),
    CONSTRAINT pk_room_switchable_charges PRIMARY KEY (room_id, charge_id)
);

-- A season is a calendar date range with a percentage adjustment applied
-- on top of a room's price for stays that fall inside it (festivals,
-- weekends the owner paints in manually).
IF OBJECT_ID('dbo.seasons', 'U') IS NULL
CREATE TABLE dbo.seasons (
    id                  BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id            BIGINT NOT NULL REFERENCES dbo.lodges(id),
    name                NVARCHAR(100) NOT NULL,
    start_date          DATE NOT NULL,
    end_date            DATE NOT NULL,
    adjustment_percent  DECIMAL(6,2) NOT NULL,
    is_active           BIT NOT NULL DEFAULT 1,
    created_at          DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT ck_seasons_dates CHECK (end_date >= start_date)
);

-- A booking is a single room reserved for a guest over a date range.
-- total_price is a snapshot taken from the pricing engine at creation time —
-- it does not drift if categories/features/seasons change afterward.
-- check_out_date is exclusive (the last occupied night is check_out_date - 1),
-- same convention as the pricing simulator's per-date lookup.
IF OBJECT_ID('dbo.bookings', 'U') IS NULL
CREATE TABLE dbo.bookings (
    id                      BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id                BIGINT NOT NULL REFERENCES dbo.lodges(id),
    room_id                 BIGINT NOT NULL REFERENCES dbo.rooms(id),
    guest_name              NVARCHAR(200) NOT NULL,
    guest_phone             NVARCHAR(20) NOT NULL,
    num_guests              INT NOT NULL DEFAULT 1 CHECK (num_guests >= 1),
    id_proof_type           NVARCHAR(30) NULL,
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
    created_by              BIGINT NULL REFERENCES dbo.users(id),
    created_at              DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT ck_bookings_dates CHECK (check_out_date > check_in_date)
);

-- Speeds up the overlap check (room_id + date range) run on every new
-- booking, and the tape chart's per-room date-range query.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_bookings_room_dates' AND object_id = OBJECT_ID('dbo.bookings'))
CREATE INDEX ix_bookings_room_dates ON dbo.bookings(room_id, check_in_date, check_out_date);

-- Which switchable charges (AC, extra bed) were switched on for this
-- booking's stay — applied flat per night across the whole stay, same as
-- the pricing simulator's chargeIds handling.
IF OBJECT_ID('dbo.booking_switchable_charges', 'U') IS NULL
CREATE TABLE dbo.booking_switchable_charges (
    booking_id  BIGINT NOT NULL REFERENCES dbo.bookings(id),
    charge_id   BIGINT NOT NULL REFERENCES dbo.switchable_charges(id),
    CONSTRAINT pk_booking_switchable_charges PRIMARY KEY (booking_id, charge_id)
);

-- quantity — switchable_charges.charge_per_night is the price of ONE of the
-- thing (one extra bed), and this is how many of it the guest took. Three
-- extra beds at ₹100 is ₹300 a night, one row, quantity 3 — not three rows,
-- which the primary key forbids anyway. DEFAULT 1 makes every extra already
-- on a booking mean exactly what it meant before this column existed.
IF OBJECT_ID('dbo.booking_switchable_charges', 'U') IS NOT NULL
   AND COL_LENGTH('dbo.booking_switchable_charges', 'quantity') IS NULL
BEGIN
    EXEC('ALTER TABLE dbo.booking_switchable_charges ADD quantity INT NOT NULL
          CONSTRAINT df_booking_switchable_charges_quantity DEFAULT 1');
    EXEC('ALTER TABLE dbo.booking_switchable_charges ADD CONSTRAINT ck_booking_switchable_charges_quantity
          CHECK (quantity >= 1)');
END

-- vehicle_number moved off dbo.bookings — a booking can now have zero or
-- more vehicles, so it lives in its own table. No DEFAULT/CHECK on
-- vehicle_number, so a plain DROP COLUMN is safe, same as fixed_price above.
IF OBJECT_ID('dbo.bookings', 'U') IS NOT NULL AND COL_LENGTH('dbo.bookings', 'vehicle_number') IS NOT NULL
    ALTER TABLE dbo.bookings DROP COLUMN vehicle_number;

IF OBJECT_ID('dbo.booking_vehicles', 'U') IS NULL
CREATE TABLE dbo.booking_vehicles (
    id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    booking_id      BIGINT NOT NULL REFERENCES dbo.bookings(id),
    vehicle_number  NVARCHAR(20) NOT NULL,
    vehicle_type    NVARCHAR(20) NULL
        CONSTRAINT ck_booking_vehicles_type
        CHECK (vehicle_type IS NULL OR vehicle_type IN ('TWO_WHEELER', 'FOUR_WHEELER', 'TRAVELLER', 'BUS'))
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_booking_vehicles_booking' AND object_id = OBJECT_ID('dbo.booking_vehicles'))
CREATE INDEX ix_booking_vehicles_booking ON dbo.booking_vehicles(booking_id);

-- vehicle_type — reception now picks what pulled up, because "how many cars
-- do we need to park tonight" is a different question from "who is staying".
-- NULL, not a default: plates recorded before this column existed have no
-- honest answer, and guessing one would put a number in the parking count
-- that nobody ever typed.
IF OBJECT_ID('dbo.booking_vehicles', 'U') IS NOT NULL AND COL_LENGTH('dbo.booking_vehicles', 'vehicle_type') IS NULL
BEGIN
    EXEC('ALTER TABLE dbo.booking_vehicles ADD vehicle_type NVARCHAR(20) NULL');
    EXEC('ALTER TABLE dbo.booking_vehicles ADD CONSTRAINT ck_booking_vehicles_type
          CHECK (vehicle_type IS NULL OR vehicle_type IN (''TWO_WHEELER'', ''FOUR_WHEELER'', ''TRAVELLER'', ''BUS''))');
END

-- The primary guest (name/phone/ID proof) stays on dbo.bookings — this
-- table holds every *additional* occupant, each with their own optional
-- phone and ID proof, up to the booking's num_guests.
IF OBJECT_ID('dbo.booking_guests', 'U') IS NULL
CREATE TABLE dbo.booking_guests (
    id                 BIGINT IDENTITY(1,1) PRIMARY KEY,
    booking_id         BIGINT NOT NULL REFERENCES dbo.bookings(id),
    guest_name         NVARCHAR(200) NOT NULL,
    guest_phone        NVARCHAR(20) NULL,
    id_proof_type      NVARCHAR(30) NULL,
    id_proof_document  NVARCHAR(255) NULL,
    is_child           BIT NOT NULL DEFAULT 0,
    created_at         DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_booking_guests_booking' AND object_id = OBJECT_ID('dbo.booking_guests'))
CREATE INDEX ix_booking_guests_booking ON dbo.booking_guests(booking_id);

-- is_child — booking now asks for adults and children separately, so a room
-- of six can be read as "4 adults and 2 children" instead of a bare count.
-- The primary guest on dbo.bookings is always an adult, and adults are
-- derived as num_guests minus the children on file rather than counted from
-- this table, so bookings made before this column existed (and guests added
-- at check-in) still add up.
IF OBJECT_ID('dbo.booking_guests', 'U') IS NOT NULL AND COL_LENGTH('dbo.booking_guests', 'is_child') IS NULL
    ALTER TABLE dbo.booking_guests ADD is_child BIT NOT NULL CONSTRAINT df_booking_guests_is_child DEFAULT 0;

-- Snapshot of the per-night price breakdown computed at booking time
-- (same [{date, total}] shape as pricing.service.js's priceStay()). Billing
-- reads this to tax each night on its actual rate instead of an average —
-- and, per the "snapshot, never recompute" rule, never re-runs the pricing
-- engine at bill time, so a later season/feature edit can't move an issued
-- bill. NULL on bookings created before this column existed; billing falls
-- back to an even split of total_price across nights for those.
IF OBJECT_ID('dbo.bookings', 'U') IS NOT NULL AND COL_LENGTH('dbo.bookings', 'nightly_breakdown') IS NULL
BEGIN
    EXEC('ALTER TABLE dbo.bookings ADD nightly_breakdown NVARCHAR(MAX) NULL');
    EXEC('ALTER TABLE dbo.bookings ADD CONSTRAINT ck_bookings_nightly_breakdown_json CHECK (nightly_breakdown IS NULL OR ISJSON(nightly_breakdown) = 1)');
END

-- base_price_override — the rate reception actually agreed for this stay,
-- standing in for the room category's base_price when the booking is priced.
-- Seasons and switchable charges still apply on top of it, exactly as they do
-- to the category price, so an override moves the floor and nothing else.
-- NULL (the normal case) means "charge the category's price".
IF OBJECT_ID('dbo.bookings', 'U') IS NOT NULL AND COL_LENGTH('dbo.bookings', 'base_price_override') IS NULL
    ALTER TABLE dbo.bookings ADD base_price_override DECIMAL(10,2) NULL;

-- id_proof_document — the guest's ID proof is uploaded (image or PDF) and
-- stored on disk under uploads/id-proofs, referenced here by filename.
IF OBJECT_ID('dbo.bookings', 'U') IS NOT NULL AND COL_LENGTH('dbo.bookings', 'id_proof_document') IS NULL
    ALTER TABLE dbo.bookings ADD id_proof_document NVARCHAR(255) NULL;

-- id_proof_number — was retired in favour of the upload, and is back as an
-- *alternative* to it rather than a replacement for it. A desk that can read a
-- number off a card but has no scanner to hand can still register the guest,
-- which is what the upload-only rule made impossible. Either satisfies the
-- "this guest identified themselves" requirement; neither is required when the
-- other is present. See the guards in bookings.controller.js.
--
-- Deliberately not validated per ID type: an Aadhaar is 12 digits and a
-- passport is not, and a desk mistyping one is a correction, not a security
-- boundary — the document upload is what carries evidential weight.
IF OBJECT_ID('dbo.bookings', 'U') IS NOT NULL AND COL_LENGTH('dbo.bookings', 'id_proof_number') IS NULL
    ALTER TABLE dbo.bookings ADD id_proof_number NVARCHAR(50) NULL;

IF OBJECT_ID('dbo.booking_guests', 'U') IS NOT NULL AND COL_LENGTH('dbo.booking_guests', 'id_proof_number') IS NULL
    ALTER TABLE dbo.booking_guests ADD id_proof_number NVARCHAR(50) NULL;

-- The returning-guest suggestions offered while a name is being typed into the
-- booking form, which run a debounced query per keystroke against one lodge's
-- history. The search matches anywhere in the name, so this can't seek on the
-- name itself — what it does is keep the scan inside one lodge and carry every
-- column the suggestion list reads, so the query never touches the table.
--
-- Placed here, below the ALTERs, rather than beside the other bookings index:
-- this file runs as one batch, and on a database that predates
-- id_proof_document that column does not exist until the statement above has
-- run. EXEC on top of that, so the INCLUDE list isn't parsed before then
-- either — the same deferral as ix_food_orders_public_token near the end.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_bookings_lodge_guest_name' AND object_id = OBJECT_ID('dbo.bookings'))
    EXEC('CREATE INDEX ix_bookings_lodge_guest_name ON dbo.bookings(lodge_id, guest_name)
          INCLUDE (guest_phone, id_proof_type, id_proof_document, check_in_date, status)');

-- GST slabs for accommodation (SAC 996311) — a rate change is a row update,
-- not a deploy. Looked up by nightly rate: the first row (ascending by
-- max_amount, NULL last) whose max_amount the rate falls at-or-under.
IF OBJECT_ID('dbo.gst_slabs', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.gst_slabs (
        id            BIGINT IDENTITY(1,1) PRIMARY KEY,
        max_amount    DECIMAL(10,2) NULL,
        rate_percent  DECIMAL(5,2) NOT NULL,
        is_active     BIT NOT NULL DEFAULT 1,
        created_at    DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
    );
    INSERT INTO dbo.gst_slabs (max_amount, rate_percent) VALUES
        (1000,  0),
        (7500,  5),
        (NULL, 18);
END

-- One running invoice number sequence per lodge per side. Bills of supply
-- share the GST-side series (both are "GST side" documents). Allocated with
-- an atomic UPDATE ... OUTPUT in billing.service.js — never SELECT MAX()+1.
IF OBJECT_ID('dbo.invoice_series', 'U') IS NULL
CREATE TABLE dbo.invoice_series (
    id            BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id      BIGINT NOT NULL REFERENCES dbo.lodges(id),
    series_type   NVARCHAR(10) NOT NULL
        CONSTRAINT ck_invoice_series_type CHECK (series_type IN ('GST', 'NON_GST')),
    prefix        NVARCHAR(20) NOT NULL,
    next_number   INT NOT NULL DEFAULT 1,
    CONSTRAINT uq_invoice_series_lodge_type UNIQUE (lodge_id, series_type)
);

-- The issued bill for a booking (flow 08/09: assemble folio, choose
-- document type, collect balance). One ISSUED invoice per booking at a
-- time — the filtered unique index allows a VOID followed by a fresh
-- reissue, matching "issued invoices are immutable, void in place, reissue".
IF OBJECT_ID('dbo.invoices', 'U') IS NULL
CREATE TABLE dbo.invoices (
    id                    BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id              BIGINT NOT NULL REFERENCES dbo.lodges(id),
    booking_id            BIGINT NOT NULL REFERENCES dbo.bookings(id),
    document_type         NVARCHAR(20) NOT NULL
        CONSTRAINT ck_invoices_document_type CHECK (document_type IN ('TAX_INVOICE', 'BILL_OF_SUPPLY', 'CASH_RECEIPT')),
    billing_side          NVARCHAR(10) NOT NULL
        CONSTRAINT ck_invoices_billing_side CHECK (billing_side IN ('GST', 'NON_GST')),
    invoice_number        NVARCHAR(50) NOT NULL,
    room_subtotal         DECIMAL(10,2) NOT NULL,
    cgst_amount           DECIMAL(10,2) NOT NULL DEFAULT 0,
    sgst_amount           DECIMAL(10,2) NOT NULL DEFAULT 0,
    round_off             DECIMAL(10,2) NOT NULL DEFAULT 0,
    total_amount          DECIMAL(10,2) NOT NULL,
    advance_paid          DECIMAL(10,2) NOT NULL DEFAULT 0,
    balance_collected     DECIMAL(10,2) NOT NULL DEFAULT 0,
    balance_payment_method NVARCHAR(20) NULL
        CONSTRAINT ck_invoices_payment_method CHECK (balance_payment_method IN ('CASH', 'UPI', 'CARD')),
    status                NVARCHAR(10) NOT NULL DEFAULT 'ISSUED'
        CONSTRAINT ck_invoices_status CHECK (status IN ('ISSUED', 'VOID')),
    void_reason           NVARCHAR(200) NULL,
    voided_at             DATETIMEOFFSET NULL,
    created_by            BIGINT NULL REFERENCES dbo.users(id),
    created_at            DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_invoices_booking_active' AND object_id = OBJECT_ID('dbo.invoices'))
CREATE UNIQUE INDEX uq_invoices_booking_active ON dbo.invoices(booking_id) WHERE status = 'ISSUED';

-- The receipt handed to a guest who pays an advance when the booking is taken.
-- Under GST an advance against a supply is a Receipt Voucher (Rule 50) — not an
-- invoice: it acknowledges money received against a stay that has not happened
-- yet, and the tax invoice cut at checkout is a separate document reporting the
-- whole stay.
--
-- Its own table rather than a row in dbo.invoices, because the filtered unique
-- index there allows one ISSUED invoice per booking and an advance receipt is
-- not that invoice — a booking can have both, and (part payments) more than one
-- receipt.
--
-- Amounts are GST-inclusive, like every price in this system: amount_received is
-- what the guest actually handed over, and cgst/sgst are the tax already inside
-- it, extracted by billing.service.js's taxWithin. That is what keeps the final
-- bill's arithmetic untouched — it subtracts the same inclusive advance from an
-- inclusive total, so nobody is taxed twice.
IF OBJECT_ID('dbo.advance_receipts', 'U') IS NULL
CREATE TABLE dbo.advance_receipts (
    id                  BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id            BIGINT NOT NULL REFERENCES dbo.lodges(id),
    booking_id          BIGINT NOT NULL REFERENCES dbo.bookings(id),
    receipt_number      NVARCHAR(50) NOT NULL,
    -- RECEIPT_VOUCHER where the lodge is GST registered and the stay is
    -- taxable, ADVANCE_RECEIPT where there is no tax to state. The document
    -- prints its own title from this.
    document_type       NVARCHAR(20) NOT NULL
        CONSTRAINT ck_advance_receipts_document_type
        CHECK (document_type IN ('RECEIPT_VOUCHER', 'ADVANCE_RECEIPT')),
    billing_side        NVARCHAR(10) NOT NULL
        CONSTRAINT ck_advance_receipts_billing_side CHECK (billing_side IN ('GST', 'NON_GST')),
    -- What the guest handed over, tax inside.
    amount_received     DECIMAL(10,2) NOT NULL,
    -- The tax sitting inside amount_received, and the rate it was taken at.
    -- Snapshotted rather than re-derived: a later rate change must not move a
    -- figure on a document already in a guest's hand.
    cgst_amount         DECIMAL(10,2) NOT NULL CONSTRAINT df_advance_receipts_cgst DEFAULT 0,
    sgst_amount         DECIMAL(10,2) NOT NULL CONSTRAINT df_advance_receipts_sgst DEFAULT 0,
    rate_percent        DECIMAL(5,2) NOT NULL CONSTRAINT df_advance_receipts_rate DEFAULT 0,
    -- The stay this was taken against, frozen for the same reason: the receipt
    -- states the balance due, and an extended booking must not silently restate
    -- a receipt already issued.
    stay_total          DECIMAL(10,2) NOT NULL,
    payment_method      NVARCHAR(20) NOT NULL
        CONSTRAINT ck_advance_receipts_payment_method
        CHECK (payment_method IN ('CASH', 'UPI', 'CARD')),
    payment_reference   NVARCHAR(64) NULL,
    status              NVARCHAR(10) NOT NULL CONSTRAINT df_advance_receipts_status DEFAULT 'ISSUED'
        CONSTRAINT ck_advance_receipts_status CHECK (status IN ('ISSUED', 'VOID')),
    void_reason         NVARCHAR(200) NULL,
    voided_at           DATETIMEOFFSET NULL,
    created_by          BIGINT NULL REFERENCES dbo.users(id),
    created_at          DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

-- A receipt number is a money document's identity: unique per lodge even across
-- a void, so a voided receipt's number is never reissued.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_advance_receipts_number' AND object_id = OBJECT_ID('dbo.advance_receipts'))
CREATE UNIQUE INDEX uq_advance_receipts_number ON dbo.advance_receipts(lodge_id, receipt_number);

-- "What has this booking been given?" — asked by the booking detail screen on
-- every open, and by the issue path to stop a second receipt for the same money.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_advance_receipts_booking' AND object_id = OBJECT_ID('dbo.advance_receipts'))
CREATE INDEX ix_advance_receipts_booking ON dbo.advance_receipts(booking_id, status);

-- How a settlement was actually tendered, one row per method.
--
-- A guest often hands over money in two ways — some cash, the rest by UPI or
-- card. Both money documents record exactly one method
-- (invoices.balance_payment_method, advance_receipts.payment_method), so the
-- desk had to pick one and the other half was filed under a method it never
-- used. That misstates the takings by mode and prints something untrue on the
-- guest's own bill.
--
-- One table serves both documents: a payment is the same fact whichever
-- document acknowledges it, and a second table would be a second set of
-- constraints to keep in step.
--
-- IMPORTANT: these lines only ever *split* a total, never carry one.
-- bookings.advance_amount is written by five different paths — booking create,
-- check-in, an edit that can set any value or clear it, receipt issue, and a
-- void that floors it to NULL — so a report summing these lines instead of
-- reading that column would invent or lose money the first time a booking was
-- corrected. getCollectionsInPeriod reads totals as it always has and uses
-- these lines only to apportion them.
--
-- Nothing historical is backfilled. A document with no lines reads as a single
-- line built from its own scalar columns, which is what every bill and receipt
-- issued before this table existed actually is.
IF OBJECT_ID('dbo.payment_lines', 'U') IS NULL
CREATE TABLE dbo.payment_lines (
    id                  BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id            BIGINT NOT NULL REFERENCES dbo.lodges(id),
    -- Exactly one parent, enforced below. No booking_id: reachable through
    -- either parent, and a denormalised copy is a third thing to keep in step
    -- when a receipt is voided.
    invoice_id          BIGINT NULL REFERENCES dbo.invoices(id),
    advance_receipt_id  BIGINT NULL REFERENCES dbo.advance_receipts(id),
    method              NVARCHAR(20) NOT NULL
        CONSTRAINT ck_payment_lines_method CHECK (method IN ('CASH', 'UPI', 'CARD')),
    -- Strictly positive. A zero line is not a payment; a negative one is a
    -- refund, which is a void against the document rather than a line on it.
    amount              DECIMAL(10,2) NOT NULL
        CONSTRAINT ck_payment_lines_amount CHECK (amount > 0),
    -- Same rule as everywhere money changes hands here: UPI and card leave a
    -- number on both sides and it is recorded, cash leaves none.
    reference           NVARCHAR(64) NULL,
    -- Insertion order is entry order is print order, so there is no sort
    -- column. Deliberately NOT a payment date: the collections report dates
    -- money by booking/invoice creation, and a real payment date here would
    -- invite changing that proxy — which moves figures in periods already
    -- reconciled. That is its own decision.
    created_at          DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    -- A line belongs to a bill or to an advance receipt, never both and never
    -- neither. Written as a sum rather than an OR pair so "exactly one" is
    -- stated once instead of as two clauses that can drift apart.
    CONSTRAINT ck_payment_lines_parent CHECK (
        (CASE WHEN invoice_id IS NULL THEN 0 ELSE 1 END)
      + (CASE WHEN advance_receipt_id IS NULL THEN 0 ELSE 1 END) = 1)
);

-- Both reads are "the lines of this one document", one index per parent.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_payment_lines_invoice' AND object_id = OBJECT_ID('dbo.payment_lines'))
CREATE INDEX ix_payment_lines_invoice ON dbo.payment_lines(invoice_id) WHERE invoice_id IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_payment_lines_receipt' AND object_id = OBJECT_ID('dbo.payment_lines'))
CREATE INDEX ix_payment_lines_receipt ON dbo.payment_lines(advance_receipt_id) WHERE advance_receipt_id IS NOT NULL;

-- Roles and their permission sets. A row with lodge_id IS NULL is a built-in
-- default shared by every lodge; a row with lodge_id set belongs to that lodge
-- and, when its role_key matches a built-in, overrides it. That's what lets an
-- owner grant extra access to "Reception" without affecting other lodges, and
-- lets them define entirely new roles alongside the built-ins.
IF OBJECT_ID('dbo.roles', 'U') IS NULL
CREATE TABLE dbo.roles (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id    BIGINT NULL REFERENCES dbo.lodges(id),
    -- Database default collation on purpose: this is compared column-to-column
    -- against users.role, and a mismatched collation makes that join fail.
    role_key    NVARCHAR(40) NOT NULL,
    name        NVARCHAR(60) NOT NULL,
    description NVARCHAR(200) NULL,
    -- Marks a row that shadows a built-in key. Built-ins can be re-scoped but
    -- never deleted or renamed, so the app always has a role to fall back to.
    is_system   BIT NOT NULL DEFAULT 0,
    permissions NVARCHAR(MAX) NOT NULL DEFAULT '[]',
    is_active   BIT NOT NULL DEFAULT 1,
    created_at  DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_roles_lodge_key UNIQUE (lodge_id, role_key)
);

-- Built-in defaults. OWNER deliberately holds every permission including
-- staff.manage — without it a lodge could lock itself out of this screen.
IF NOT EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'OWNER')
INSERT INTO dbo.roles (lodge_id, role_key, name, description, is_system, permissions) VALUES
    (NULL, 'OWNER', 'Owner', 'Full access to the property, its rates, billing and staff.', 1,
     '["rooms.manage","bookings.manage","billing.manage","guests.view","reports.view","staff.manage"]');

IF NOT EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'RECEPTION')
INSERT INTO dbo.roles (lodge_id, role_key, name, description, is_system, permissions) VALUES
    (NULL, 'RECEPTION', 'Reception', 'Front desk — bookings, check-in/out, billing and the guest register.', 1,
     '["bookings.manage","billing.manage","guests.view"]');

IF NOT EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'KITCHEN')
INSERT INTO dbo.roles (lodge_id, role_key, name, description, is_system, permissions) VALUES
    (NULL, 'KITCHEN', 'Kitchen', 'Food orders only.', 1, '[]');

-- users.role now carries a role_key that may name a lodge-defined role, so the
-- fixed four-value CHECK has to go. The lodge-scope rule below still holds the
-- important invariant (only SUPERADMIN is lodge-less), and every non-superadmin
-- role_key is validated against dbo.roles by the application.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_users_role')
ALTER TABLE dbo.users DROP CONSTRAINT ck_users_role;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_users_lodge' AND object_id = OBJECT_ID('dbo.users'))
CREATE INDEX ix_users_lodge ON dbo.users(lodge_id) WHERE lodge_id IS NOT NULL;

-- roles.role_key originally shipped as COLLATE Latin1_General_BIN2 (copied from
-- lodges.slug, where case-sensitivity matters because it's a URL). users.role
-- uses the database default, so joining the two raised
-- "Cannot resolve the collation conflict". Re-align it with the database
-- default; the UNIQUE constraint has to come off and go back on around it.
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.roles') AND name = 'role_key'
      AND collation_name <> CONVERT(sysname, DATABASEPROPERTYEX(DB_NAME(), 'Collation'))
)
BEGIN
    IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'uq_roles_lodge_key')
        ALTER TABLE dbo.roles DROP CONSTRAINT uq_roles_lodge_key;
    ALTER TABLE dbo.roles ALTER COLUMN role_key NVARCHAR(40) NOT NULL;
    ALTER TABLE dbo.roles ADD CONSTRAINT uq_roles_lodge_key UNIQUE (lodge_id, role_key);
END

-- ---------------------------------------------------------------------------
-- Food ordering
-- ---------------------------------------------------------------------------

-- What this property actually is. The product started as a rooms-only PMS, so
-- has_rooms defaults to 1 and every existing lodge keeps working untouched.
-- These are four independent bits rather than one property_type enum because
-- the combinations are real: a restaurant with no rooms (0,1,0,1), a lodge
-- that doesn't serve food (1,0,0,0), a lodge serving meals to rooms only
-- (1,1,1,0), and one doing both room and table service (1,1,1,1). An enum
-- would need a new value for each pairing.
IF COL_LENGTH('dbo.lodges', 'has_rooms') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD has_rooms BIT NOT NULL CONSTRAINT df_lodges_has_rooms DEFAULT 1');

IF COL_LENGTH('dbo.lodges', 'serves_food') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD serves_food BIT NOT NULL CONSTRAINT df_lodges_serves_food DEFAULT 0');

-- Room service means the in-room QR flow; table service means the dining-table
-- QR flow. Both hang off serves_food — neither is reachable without it.
IF COL_LENGTH('dbo.lodges', 'food_room_service') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD food_room_service BIT NOT NULL CONSTRAINT df_lodges_food_room_service DEFAULT 0');

IF COL_LENGTH('dbo.lodges', 'food_table_service') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD food_table_service BIT NOT NULL CONSTRAINT df_lodges_food_table_service DEFAULT 0');

-- Every lodge that lets rooms gets an Extra bed extra, because every one of
-- them has an extra bed to sell. The rate is seeded at 0 for the owner to set
-- on Rooms & rates: a made-up price here would be billed to real guests at a
-- number nobody chose. A lodge that already has a row by that name keeps its
-- own rate and simply gains the counter. Sits here rather than beside the
-- table because it reads has_rooms, added just above.
--
-- EXEC, not bare SQL: the batch is compiled in one pass, so a statement naming
-- is_counter directly would fail against a table that doesn't have it yet.
EXEC('UPDATE dbo.switchable_charges SET is_counter = 1
      WHERE name = ''Extra bed'' AND is_counter = 0');

EXEC('INSERT INTO dbo.switchable_charges (lodge_id, name, charge_per_night, is_counter)
      SELECT l.id, ''Extra bed'', 0, 1
      FROM dbo.lodges l
      WHERE l.has_rooms = 1
        AND NOT EXISTS (
          SELECT 1 FROM dbo.switchable_charges sc
          WHERE sc.lodge_id = l.id AND sc.name = ''Extra bed''
        )');

-- The PIN a guest types to order from their room's QR. Issued at check-in and
-- cleared at check-out, so a QR stuck to the wall is only live while somebody
-- is actually staying in that room — the QR itself carries no secret.
IF COL_LENGTH('dbo.bookings', 'food_pin') IS NULL
    EXEC('ALTER TABLE dbo.bookings ADD food_pin NVARCHAR(6) NULL');

IF OBJECT_ID('dbo.menu_categories', 'U') IS NULL
CREATE TABLE dbo.menu_categories (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id    BIGINT NOT NULL REFERENCES dbo.lodges(id),
    name        NVARCHAR(100) NOT NULL,
    sort_order  INT NOT NULL DEFAULT 0,
    is_active   BIT NOT NULL DEFAULT 1,
    created_at  DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_menu_categories_lodge_name UNIQUE (lodge_id, name)
);

-- is_available is the kitchen's "we're out of this today" toggle and is
-- deliberately separate from is_active, which is the owner retiring an item.
-- Reachable from the kitchen screen per the ordering rules — an item that
-- runs out at 8pm can't wait for the owner to log in.
--
-- No modifiers in v1: half and full plates are two rows, not one row with
-- options. That keeps an order line a flat (item, qty, price) and avoids a
-- price-resolution step between the menu and the kitchen ticket.
IF OBJECT_ID('dbo.menu_items', 'U') IS NULL
CREATE TABLE dbo.menu_items (
    id            BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id      BIGINT NOT NULL REFERENCES dbo.lodges(id),
    category_id   BIGINT NOT NULL REFERENCES dbo.menu_categories(id),
    name          NVARCHAR(150) NOT NULL,
    description   NVARCHAR(300) NULL,
    price         DECIMAL(10,2) NOT NULL
        CONSTRAINT ck_menu_items_price CHECK (price >= 0),
    food_type     NVARCHAR(10) NOT NULL DEFAULT 'VEG'
        CONSTRAINT ck_menu_items_food_type CHECK (food_type IN ('VEG', 'NON_VEG')),
    is_available  BIT NOT NULL DEFAULT 1,
    sort_order    INT NOT NULL DEFAULT 0,
    is_active     BIT NOT NULL DEFAULT 1,
    created_at    DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_menu_items_category_name UNIQUE (category_id, name)
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_menu_items_lodge' AND object_id = OBJECT_ID('dbo.menu_items'))
CREATE INDEX ix_menu_items_lodge ON dbo.menu_items(lodge_id, category_id);

-- image_filename — a photo of the dish, stored on disk under
-- uploads/menu-images and referenced here by filename, exactly as room photos
-- are. A guest ordering from a phone buys with their eyes, and a menu that is
-- a wall of names sells the cheap familiar things and nothing else.
-- NULL is the norm: a kitchen photographs its signature dishes, not all forty.
IF OBJECT_ID('dbo.menu_items', 'U') IS NOT NULL AND COL_LENGTH('dbo.menu_items', 'image_filename') IS NULL
    ALTER TABLE dbo.menu_items ADD image_filename NVARCHAR(255) NULL;

-- Egg was a third food type sitting between veg and non-veg, and it is gone:
-- the mark a guest actually reads is the one that answers "can I eat this",
-- and for everyone the veg mark is for, an omelette is on the far side of the
-- line with the chicken. Two types, and every egg dish keeps its name, price
-- and section — only its mark changes.
--
-- The rows have to move before the constraint that forbids them goes on, and
-- the constraint has to come off before the rows can move, so the drop is
-- first. Guarded on the old definition still mentioning EGG, so this is a
-- no-op on every run after the first; the ADD is guarded on absence instead,
-- which also puts the constraint back if it was ever dropped by hand.
IF OBJECT_ID('dbo.menu_items', 'U') IS NOT NULL
BEGIN
    IF EXISTS (
        SELECT 1 FROM sys.check_constraints
        WHERE name = 'ck_menu_items_food_type'
          AND parent_object_id = OBJECT_ID('dbo.menu_items')
          AND definition LIKE '%EGG%'
    )
        EXEC('ALTER TABLE dbo.menu_items DROP CONSTRAINT ck_menu_items_food_type');

    EXEC('UPDATE dbo.menu_items SET food_type = ''NON_VEG'' WHERE food_type = ''EGG''');

    IF NOT EXISTS (
        SELECT 1 FROM sys.check_constraints
        WHERE name = 'ck_menu_items_food_type'
          AND parent_object_id = OBJECT_ID('dbo.menu_items')
    )
        EXEC('ALTER TABLE dbo.menu_items ADD CONSTRAINT ck_menu_items_food_type CHECK (food_type IN (''VEG'', ''NON_VEG''))');
END

-- A dining table, for properties doing table service. qr_token is what the
-- table's QR encodes: a random opaque string rather than the table label, so
-- the URLs can't be walked by incrementing a number. BIN2 because it's
-- compared as a URL segment and case has to matter.
IF OBJECT_ID('dbo.dining_tables', 'U') IS NULL
CREATE TABLE dbo.dining_tables (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id    BIGINT NOT NULL REFERENCES dbo.lodges(id),
    label       NVARCHAR(40) NOT NULL,
    seats       INT NULL
        CONSTRAINT ck_dining_tables_seats CHECK (seats IS NULL OR seats > 0),
    qr_token    NVARCHAR(32) COLLATE Latin1_General_BIN2 NOT NULL UNIQUE,
    is_active   BIT NOT NULL DEFAULT 1,
    created_at  DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_dining_tables_lodge_label UNIQUE (lodge_id, label)
);

-- Order numbers restart at 1 each day and are read aloud across a kitchen
-- ("order 14 is ready"), so they have to be short and per-day, not a global
-- identity. Allocated with an atomic MERGE in orders.service.js — never
-- SELECT MAX()+1, same rule as invoice_series.
IF OBJECT_ID('dbo.food_order_counters', 'U') IS NULL
CREATE TABLE dbo.food_order_counters (
    lodge_id     BIGINT NOT NULL REFERENCES dbo.lodges(id),
    order_date   DATE NOT NULL,
    next_number  INT NOT NULL DEFAULT 1,
    CONSTRAINT pk_food_order_counters PRIMARY KEY (lodge_id, order_date)
);

-- One order, from a room QR, a table QR, or typed in at the counter.
--
-- PENDING exists only for table orders: a table QR has no booking behind it,
-- so anyone who has ever scanned it could place an order from anywhere. Rather
-- than gate that with a login the guest doesn't have, a table order waits for
-- the kitchen to accept it before it becomes a ticket. Room orders clear the
-- booking PIN before they're written at all, so they start at QUEUED and the
-- kitchen sees them immediately.
--
-- booking_id is captured at placement so a later check-out can't orphan the
-- charge — folio posting (next pass) needs to know which stay owes for it.
IF OBJECT_ID('dbo.food_orders', 'U') IS NULL
CREATE TABLE dbo.food_orders (
    id             BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id       BIGINT NOT NULL REFERENCES dbo.lodges(id),
    order_date     DATE NOT NULL,
    order_number   INT NOT NULL,
    source         NVARCHAR(10) NOT NULL
        CONSTRAINT ck_food_orders_source CHECK (source IN ('ROOM', 'TABLE', 'COUNTER')),
    room_id        BIGINT NULL REFERENCES dbo.rooms(id),
    booking_id     BIGINT NULL REFERENCES dbo.bookings(id),
    table_id       BIGINT NULL REFERENCES dbo.dining_tables(id),
    guest_name     NVARCHAR(200) NULL,
    guest_phone    NVARCHAR(20) NULL,
    note           NVARCHAR(300) NULL,
    status         NVARCHAR(12) NOT NULL DEFAULT 'PENDING'
        CONSTRAINT ck_food_orders_status CHECK (status IN ('PENDING', 'QUEUED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED')),
    subtotal       DECIMAL(10,2) NOT NULL DEFAULT 0,
    placed_at      DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    accepted_at    DATETIMEOFFSET NULL,
    ready_at       DATETIMEOFFSET NULL,
    delivered_at   DATETIMEOFFSET NULL,
    cancelled_at   DATETIMEOFFSET NULL,
    cancel_reason  NVARCHAR(200) NULL,
    created_by     BIGINT NULL REFERENCES dbo.users(id),
    CONSTRAINT uq_food_orders_number UNIQUE (lodge_id, order_date, order_number),
    -- A room order without a room, or a table order without a table, is a bug
    -- that would reach the kitchen as an unservable ticket. Caught here.
    CONSTRAINT ck_food_orders_target CHECK (
        (source = 'ROOM'  AND room_id IS NOT NULL AND table_id IS NULL) OR
        (source = 'TABLE' AND table_id IS NOT NULL AND room_id IS NULL) OR
        (source = 'COUNTER' AND room_id IS NULL AND table_id IS NULL)
    )
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_food_orders_queue' AND object_id = OBJECT_ID('dbo.food_orders'))
CREATE INDEX ix_food_orders_queue ON dbo.food_orders(lodge_id, status, placed_at);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_food_orders_date' AND object_id = OBJECT_ID('dbo.food_orders'))
CREATE INDEX ix_food_orders_date ON dbo.food_orders(lodge_id, order_date);

-- Name and price are snapshotted onto the line, not read back through
-- menu_item_id — the same "snapshot, never recompute" rule the nightly
-- breakdown follows. Re-pricing the menu at 6pm must not silently restate
-- what a guest was shown at noon. menu_item_id stays only as a soft link for
-- reporting, and goes NULL if the item is later deleted.
IF OBJECT_ID('dbo.food_order_items', 'U') IS NULL
CREATE TABLE dbo.food_order_items (
    id            BIGINT IDENTITY(1,1) PRIMARY KEY,
    order_id      BIGINT NOT NULL REFERENCES dbo.food_orders(id),
    menu_item_id  BIGINT NULL REFERENCES dbo.menu_items(id),
    item_name     NVARCHAR(150) NOT NULL,
    unit_price    DECIMAL(10,2) NOT NULL,
    quantity      INT NOT NULL
        CONSTRAINT ck_food_order_items_quantity CHECK (quantity > 0),
    line_total    DECIMAL(10,2) NOT NULL
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_food_order_items_order' AND object_id = OBJECT_ID('dbo.food_order_items'))
CREATE INDEX ix_food_order_items_order ON dbo.food_order_items(order_id);

-- food.manage (build the menu, tables and QR codes) and orders.manage (work
-- the live queue) are separate because they're separate jobs: the kitchen
-- needs the queue and the availability toggle, and nothing else. Applied to
-- the built-in rows only where they're still at their shipped defaults, so a
-- lodge that has already customised a built-in keeps its own set.
IF EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'OWNER'
           AND permissions = '["rooms.manage","bookings.manage","billing.manage","guests.view","reports.view","staff.manage"]')
UPDATE dbo.roles
SET permissions = '["rooms.manage","bookings.manage","billing.manage","guests.view","reports.view","staff.manage","food.manage","orders.manage"]'
WHERE lodge_id IS NULL AND role_key = 'OWNER';

IF EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'RECEPTION'
           AND permissions = '["bookings.manage","billing.manage","guests.view"]')
UPDATE dbo.roles
SET permissions = '["bookings.manage","billing.manage","guests.view","orders.manage"]'
WHERE lodge_id IS NULL AND role_key = 'RECEPTION';

IF EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'KITCHEN' AND permissions = '[]')
UPDATE dbo.roles
SET permissions = '["orders.manage"]'
WHERE lodge_id IS NULL AND role_key = 'KITCHEN';

-- users.email shipped as `NVARCHAR(255) NULL UNIQUE`, which does not mean what
-- it looks like on SQL Server: a UNIQUE *constraint* treats NULLs as equal, so
-- it permits exactly one row with no email in the entire table. Email is
-- optional for lodge staff (reception logs in by phone), so the second such
-- account ever created failed with a duplicate-key error.
--
-- The fix is a filtered unique index, the same pattern uq_invoices_booking_active
-- uses: emails stay unique among rows that have one, and any number of rows may
-- have none. The original constraint is auto-named, so it's looked up rather
-- than dropped by name.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_users_email' AND object_id = OBJECT_ID('dbo.users'))
BEGIN
    DECLARE @emailConstraint SYSNAME = (
        SELECT TOP 1 kc.name
        FROM sys.key_constraints kc
        JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
        JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
        WHERE kc.parent_object_id = OBJECT_ID('dbo.users') AND kc.type = 'UQ' AND c.name = 'email'
    );
    IF @emailConstraint IS NOT NULL
        EXEC('ALTER TABLE dbo.users DROP CONSTRAINT ' + @emailConstraint);

    EXEC('CREATE UNIQUE INDEX uq_users_email ON dbo.users(email) WHERE email IS NOT NULL');
END

-- ---------------------------------------------------------------------------
-- Single-link ordering: PIN brute-force defence
-- ---------------------------------------------------------------------------

-- In-room ordering moved from one QR per room to a single link for the whole
-- property, so the room is no longer proved by where the guest is standing —
-- the PIN is the only thing between a stranger and a charge on someone else's
-- folio. A 4-digit PIN is 10,000 values, which is trivial to sweep without a
-- lockout. With this table it takes ~20 days of sustained attack on one room.
--
-- Keyed on the room number *as typed*, not on rooms.id, and deliberately so: a
-- room number that doesn't exist has to accumulate failures and lock exactly
-- like a real one. Keying on an id would mean fake rooms can't be recorded, so
-- a 429 (real room) would read differently from a 401 (unknown room) and hand
-- an attacker a room-enumeration oracle — the very thing the uniform failure
-- response in public.service.js exists to close.
IF OBJECT_ID('dbo.food_pin_lockouts', 'U') IS NULL
CREATE TABLE dbo.food_pin_lockouts (
    lodge_id         BIGINT NOT NULL REFERENCES dbo.lodges(id),
    room_label       NVARCHAR(20) NOT NULL,
    failed_count     INT NOT NULL DEFAULT 0,
    first_failed_at  DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    last_failed_at   DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    locked_until     DATETIMEOFFSET NULL,
    CONSTRAINT pk_food_pin_lockouts PRIMARY KEY (lodge_id, room_label)
);

-- Durable record of failed staff sign-ins — the same backstop food_pin_lockouts
-- gives the guest PIN door, because the in-memory limiter's counters die with
-- the process and Passenger recycles processes on its own schedule. Keyed on
-- the identifier AS TYPED, not on a user id, so guessing against an address
-- that doesn't exist costs the same as guessing against a real account.
-- Mirrors migration 001.
IF OBJECT_ID('dbo.login_attempts', 'U') IS NULL
CREATE TABLE dbo.login_attempts (
    -- Lowercased by the application before it reaches here, so 'Owner@x.com'
    -- and 'owner@x.com' share one budget rather than two.
    identifier       NVARCHAR(255) NOT NULL,
    -- 'STAFF' or 'ADMIN'. The two doors have different budgets and must not
    -- share a counter — the admin door is the key to every property.
    door             NVARCHAR(10) NOT NULL
        CONSTRAINT ck_login_attempts_door CHECK (door IN ('STAFF', 'ADMIN')),
    failed_count     INT NOT NULL DEFAULT 0,
    first_failed_at  DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    last_failed_at   DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    locked_until     DATETIMEOFFSET NULL,
    CONSTRAINT pk_login_attempts PRIMARY KEY (identifier, door)
);

-- Finds rows worth clearing without scanning the whole table.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_login_attempts_last_failed')
    CREATE INDEX ix_login_attempts_last_failed ON dbo.login_attempts (last_failed_at);

-- One-time codes sent over WhatsApp, currently for confirming a password change.
-- Changing a password can lock the rightful owner out of a property, and a
-- stolen session was previously enough to do it. The code moves that check from
-- "something the browser has" to "something the person has".
--
-- The code is stored as a bcrypt hash, expires, and is burned on use. attempts
-- caps guessing: six digits is only strong while the guesser cannot spend a
-- million tries, and this one is already authenticated. user_id binds the code
-- to the account that asked for it, so it cannot be redeemed against another.
-- See migrations/035_otp_store.sql for the full reasoning.
IF OBJECT_ID('dbo.otp_store', 'U') IS NULL
CREATE TABLE dbo.otp_store (
    id           BIGINT IDENTITY(1,1) PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES dbo.users(id),
    -- Normalised to E.164 digits (919876543210). Kept alongside user_id so the
    -- trail still says where a code went after the user's phone is later edited.
    phone        NVARCHAR(20) NOT NULL,
    otp_hash     NVARCHAR(255) NOT NULL,
    purpose      NVARCHAR(30) NOT NULL
        CONSTRAINT ck_otp_store_purpose CHECK (purpose IN ('password_change')),
    attempts     INT NOT NULL DEFAULT 0,
    expires_at   DATETIMEOFFSET NOT NULL,
    used         BIT NOT NULL DEFAULT 0,
    created_at   DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

-- Every read is "the newest live code for this account and purpose".
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_otp_store_user_purpose')
    CREATE INDEX ix_otp_store_user_purpose ON dbo.otp_store (user_id, purpose, created_at DESC);

-- Supports the opportunistic sweep of spent and expired rows.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_otp_store_expires_at')
    CREATE INDEX ix_otp_store_expires_at ON dbo.otp_store (expires_at);

-- How a guest's own phone follows their order to the pass. Replaces looking a
-- status up by (room number, order number), which was itself a "is room 12
-- ordering food right now?" oracle on an unauthenticated endpoint. Random and
-- opaque, so holding one tells you nothing about any other order.
IF COL_LENGTH('dbo.food_orders', 'public_token') IS NULL
    EXEC('ALTER TABLE dbo.food_orders ADD public_token NVARCHAR(32) NULL');

-- EXEC, not a bare CREATE INDEX: schema.sql runs as one batch, so a statement
-- naming public_token directly is parsed before the ALTER above has added it
-- and fails with "Invalid column name". Deferring compilation is the same
-- trick the nightly_breakdown migration uses higher up this file.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_food_orders_public_token' AND object_id = OBJECT_ID('dbo.food_orders'))
    EXEC('CREATE UNIQUE INDEX ix_food_orders_public_token ON dbo.food_orders(public_token) WHERE public_token IS NOT NULL');

-- ---------------------------------------------------------------------------
-- Billing for food
-- ---------------------------------------------------------------------------

-- Tax rates now cover two supplies, not one. Accommodation (SAC 996311) is
-- banded by nightly rate; food (SAC 996331) is a flat rate decided by whether
-- the property is "specified premises" — 18% with ITC if it is, 5% without if
-- it isn't — so a FOOD row is selected by that flag rather than by amount.
--
-- applies_to_specified: 1 = only when the lodge is specified premises,
-- 0 = only when it isn't, NULL = regardless (how every ACCOMMODATION row sits).
IF COL_LENGTH('dbo.gst_slabs', 'supply_type') IS NULL
BEGIN
    EXEC('ALTER TABLE dbo.gst_slabs ADD supply_type NVARCHAR(20) NOT NULL CONSTRAINT df_gst_slabs_supply DEFAULT ''ACCOMMODATION''');
    EXEC('ALTER TABLE dbo.gst_slabs ADD CONSTRAINT ck_gst_slabs_supply CHECK (supply_type IN (''ACCOMMODATION'', ''FOOD''))');
END

IF COL_LENGTH('dbo.gst_slabs', 'applies_to_specified') IS NULL
    EXEC('ALTER TABLE dbo.gst_slabs ADD applies_to_specified BIT NULL');

IF COL_LENGTH('dbo.gst_slabs', 'sac_code') IS NULL
    EXEC('ALTER TABLE dbo.gst_slabs ADD sac_code NVARCHAR(10) NULL');

-- Accommodation slabs. These were seeded when gst_slabs was first created, but
-- an empty table silently taxes every bill at 0% rather than failing loudly, so
-- they're re-seeded here if they've gone missing.
-- The IF and the INSERT both sit inside EXEC: this batch adds supply_type a few
-- statements above, and anything naming it outside a deferred sub-batch is
-- parsed before the column exists ("Invalid column name"). Same reason the
-- nightly_breakdown and public_token migrations use EXEC.
EXEC('IF NOT EXISTS (SELECT 1 FROM dbo.gst_slabs WHERE supply_type = ''ACCOMMODATION'')
        INSERT INTO dbo.gst_slabs (supply_type, max_amount, rate_percent, applies_to_specified, sac_code) VALUES
            (''ACCOMMODATION'', 1000, 0, NULL, ''996311''),
            (''ACCOMMODATION'', 7500, 5, NULL, ''996311''),
            (''ACCOMMODATION'', NULL, 18, NULL, ''996311'')');

-- Food rates. max_amount is NULL on both: the rate does not depend on the value
-- of the meal, only on the premises.
EXEC('IF NOT EXISTS (SELECT 1 FROM dbo.gst_slabs WHERE supply_type = ''FOOD'')
        INSERT INTO dbo.gst_slabs (supply_type, max_amount, rate_percent, applies_to_specified, sac_code) VALUES
            (''FOOD'', NULL, 5, 0, ''996331''),
            (''FOOD'', NULL, 18, 1, ''996331'')');

-- A restaurant bill has no stay behind it, so booking_id has to be optional.
-- The filtered unique index on booking_id already ignores NULLs, so several
-- food-only invoices can coexist without colliding.
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.invoices') AND name = 'booking_id' AND is_nullable = 0
)
    ALTER TABLE dbo.invoices ALTER COLUMN booking_id BIGINT NULL;

-- Food is a separate supply on its own SAC and its own rate, so it cannot be
-- folded into room_subtotal — GSTR-1 needs the two reported apart. A bill can
-- carry either or both: a stay with room service has both, a closed table has
-- only the food side.
IF COL_LENGTH('dbo.invoices', 'food_subtotal') IS NULL
BEGIN
    EXEC('ALTER TABLE dbo.invoices ADD food_subtotal DECIMAL(10,2) NOT NULL CONSTRAINT df_invoices_food_subtotal DEFAULT 0');
    EXEC('ALTER TABLE dbo.invoices ADD food_cgst_amount DECIMAL(10,2) NOT NULL CONSTRAINT df_invoices_food_cgst DEFAULT 0');
    EXEC('ALTER TABLE dbo.invoices ADD food_sgst_amount DECIMAL(10,2) NOT NULL CONSTRAINT df_invoices_food_sgst DEFAULT 0');
END

-- What a food-only bill was raised against, for the header of a restaurant
-- document ("Table 4") and so the same table can be closed again later.
IF COL_LENGTH('dbo.invoices', 'table_id') IS NULL
    EXEC('ALTER TABLE dbo.invoices ADD table_id BIGINT NULL REFERENCES dbo.dining_tables(id)');

-- Marks an order as billed. This is what stops a second "close table" sweeping
-- the same orders onto a second document, and what a void puts back.
IF COL_LENGTH('dbo.food_orders', 'invoice_id') IS NULL
    EXEC('ALTER TABLE dbo.food_orders ADD invoice_id BIGINT NULL REFERENCES dbo.invoices(id)');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_food_orders_invoice' AND object_id = OBJECT_ID('dbo.food_orders'))
    EXEC('CREATE INDEX ix_food_orders_invoice ON dbo.food_orders(invoice_id) WHERE invoice_id IS NOT NULL');

-- ---------------------------------------------------------------------------
-- Portions (half plate / full plate)
-- ---------------------------------------------------------------------------
-- This replaces the v1 rule recorded above dbo.menu_items, that half and full
-- plates are two separate rows. They were, and a lodge with 40 curries ended up
-- with 80 dishes whose names all ended in "(Half)". What follows keeps the part
-- of that rule that mattered — an order line is still one row carrying one
-- price, resolved from one database row, with no arithmetic between the menu
-- and the kitchen ticket. Only *which* row the price comes from has changed.
--
-- Sizes are typed onto the dish. There is deliberately no shared "Half / Full"
-- definition to pick from first: a kitchen offers a half plate of some curries
-- and not others, at prices that have nothing to do with each other, so a
-- shared list would only have saved typing two short words while adding a step
-- before every dish could be priced.
IF OBJECT_ID('dbo.menu_item_portions', 'U') IS NULL
CREATE TABLE dbo.menu_item_portions (
    id            BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id      BIGINT NOT NULL REFERENCES dbo.lodges(id),
    item_id       BIGINT NOT NULL REFERENCES dbo.menu_items(id),
    label         NVARCHAR(60) NOT NULL,
    price         DECIMAL(10,2) NOT NULL
        CONSTRAINT ck_menu_item_portions_price CHECK (price >= 0),
    is_available  BIT NOT NULL DEFAULT 1,
    sort_order    INT NOT NULL DEFAULT 0,
    created_at    DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_menu_item_portions UNIQUE (item_id, label)
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_menu_item_portions_item' AND object_id = OBJECT_ID('dbo.menu_item_portions'))
CREATE INDEX ix_menu_item_portions_item ON dbo.menu_item_portions(item_id);

-- Snapshotted onto the order line beside the name, under the same rule as
-- item_name and unit_price: renaming a size tomorrow must not restate what a
-- guest was charged today. item_name is written as "Masala Dosa (Half plate)"
-- so the kitchen ticket, the bill and the reports all read correctly without
-- knowing this column exists; portion_label is the same fact kept separately
-- for anything that wants to group by size.
IF COL_LENGTH('dbo.food_order_items', 'portion_label') IS NULL
    EXEC('ALTER TABLE dbo.food_order_items ADD portion_label NVARCHAR(60) NULL');

IF COL_LENGTH('dbo.food_order_items', 'menu_item_portion_id') IS NULL
    EXEC('ALTER TABLE dbo.food_order_items ADD menu_item_portion_id BIGINT NULL REFERENCES dbo.menu_item_portions(id)');

-- A cook ticks each dish off as it leaves the pan, and the order can only be
-- called ready once every line is ticked. Kept on the row rather than in the
-- screen's own state because the queue is polled and a busy kitchen works one
-- order from two tablets: a tick held in React would be wiped by the next
-- poll and would never reach the second screen at all.
IF COL_LENGTH('dbo.food_order_items', 'ready_at') IS NULL
    EXEC('ALTER TABLE dbo.food_order_items ADD ready_at DATETIMEOFFSET NULL');

-- ---------------------------------------------------------------------------
-- Retiring the first cut of portions
-- ---------------------------------------------------------------------------
-- Portions first shipped routed through reusable "portion sets": a lodge
-- defined "Half / Full" once and each dish pointed at it. It was one step more
-- than the job needed. This unwinds that shape wherever it was applied.
--
-- Prices are carried across, not dropped. The label each price was recorded
-- against lives in portion_set_options, so it is copied onto the price row
-- before those tables go — a dish already priced at half and full keeps both.
IF COL_LENGTH('dbo.menu_item_portions', 'set_option_id') IS NOT NULL
BEGIN
    IF COL_LENGTH('dbo.menu_item_portions', 'label') IS NULL
        EXEC('ALTER TABLE dbo.menu_item_portions ADD label NVARCHAR(60) NULL');

    IF COL_LENGTH('dbo.menu_item_portions', 'sort_order') IS NULL
        EXEC('ALTER TABLE dbo.menu_item_portions ADD sort_order INT NOT NULL CONSTRAINT df_menu_item_portions_sort DEFAULT 0');

    EXEC('
        UPDATE p SET p.label = o.label, p.sort_order = o.sort_order
        FROM dbo.menu_item_portions p
        JOIN dbo.portion_set_options o ON o.id = p.set_option_id
        WHERE p.label IS NULL
    ');

    -- A price row whose set option had already been deleted has no label to
    -- carry across and nothing left to mean.
    EXEC('DELETE FROM dbo.menu_item_portions WHERE label IS NULL');
    EXEC('ALTER TABLE dbo.menu_item_portions ALTER COLUMN label NVARCHAR(60) NOT NULL');

    -- The old uniqueness was (item_id, set_option_id) and has to go before the
    -- column it names can be dropped.
    IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'uq_menu_item_portions' AND parent_object_id = OBJECT_ID('dbo.menu_item_portions'))
        EXEC('ALTER TABLE dbo.menu_item_portions DROP CONSTRAINT uq_menu_item_portions');

    DECLARE @portionFk NVARCHAR(200);
    SELECT @portionFk = name FROM sys.foreign_keys
    WHERE parent_object_id = OBJECT_ID('dbo.menu_item_portions')
      AND referenced_object_id = OBJECT_ID('dbo.portion_set_options');
    IF @portionFk IS NOT NULL
        EXEC('ALTER TABLE dbo.menu_item_portions DROP CONSTRAINT ' + @portionFk);

    EXEC('ALTER TABLE dbo.menu_item_portions DROP COLUMN set_option_id');
    EXEC('ALTER TABLE dbo.menu_item_portions ADD CONSTRAINT uq_menu_item_portions UNIQUE (item_id, label)');
END

IF COL_LENGTH('dbo.menu_items', 'portion_set_id') IS NOT NULL
BEGIN
    DECLARE @itemFk NVARCHAR(200);
    SELECT @itemFk = name FROM sys.foreign_keys
    WHERE parent_object_id = OBJECT_ID('dbo.menu_items')
      AND referenced_object_id = OBJECT_ID('dbo.portion_sets');
    IF @itemFk IS NOT NULL
        EXEC('ALTER TABLE dbo.menu_items DROP CONSTRAINT ' + @itemFk);

    EXEC('ALTER TABLE dbo.menu_items DROP COLUMN portion_set_id');
END

IF OBJECT_ID('dbo.portion_set_options', 'U') IS NOT NULL DROP TABLE dbo.portion_set_options;
IF OBJECT_ID('dbo.portion_sets', 'U') IS NOT NULL DROP TABLE dbo.portion_sets;

-- ---------------------------------------------------------------------------
-- Late checkout
-- ---------------------------------------------------------------------------
-- lodges.checkin_mode has been recorded since registration but never computed
-- with. These columns are what finally make it load-bearing: a NIGHT_BASED
-- property checks out at check_out_time on the departure date, and a HOUR_24
-- one checks out 24 hours per night after the guest actually walked in. Once
-- there is a deadline there can be a charge for missing it.
--
-- The policy is three numbers over a grace period, which is how a lodge
-- actually prices this out loud: nothing for the first hour, half a night if
-- they are out by the afternoon, a whole night if they are not. Percentages
-- rather than rupees so a suite and a single room scale on their own tariff.
IF COL_LENGTH('dbo.lodges', 'check_out_time') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD check_out_time TIME(0) NOT NULL CONSTRAINT df_lodges_check_out_time DEFAULT ''11:00:00''');

-- The CYCLE mode (migration 044): check in from check_in_time, out by
-- check_out_time, and every checkout-time boundary the stay crosses is a whole
-- night. check_in_time is what the desk quotes; the arithmetic only needs the
-- checkout time.
IF COL_LENGTH('dbo.lodges', 'check_in_time') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD check_in_time TIME(0) NOT NULL CONSTRAINT df_lodges_check_in_time DEFAULT ''11:00:00''');

IF COL_LENGTH('dbo.lodges', 'late_grace_minutes') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD late_grace_minutes INT NOT NULL CONSTRAINT df_lodges_late_grace DEFAULT 60');

IF COL_LENGTH('dbo.lodges', 'late_half_day_percent') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD late_half_day_percent DECIMAL(5,2) NOT NULL CONSTRAINT df_lodges_late_half DEFAULT 50');

IF COL_LENGTH('dbo.lodges', 'late_full_day_after_minutes') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD late_full_day_after_minutes INT NOT NULL CONSTRAINT df_lodges_late_full_after DEFAULT 360');

IF COL_LENGTH('dbo.lodges', 'late_full_day_percent') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD late_full_day_percent DECIMAL(5,2) NOT NULL CONSTRAINT df_lodges_late_full DEFAULT 100');

-- What reception actually decided, not what the policy suggested — the whole
-- point of the prompt is that a receptionist can waive it for a guest whose
-- taxi was late. Zero is a real answer and means "waived", which is why this
-- is NOT NULL DEFAULT 0 rather than nullable.
IF COL_LENGTH('dbo.bookings', 'late_checkout_charge') IS NULL
    EXEC('ALTER TABLE dbo.bookings ADD late_checkout_charge DECIMAL(10,2) NOT NULL CONSTRAINT df_bookings_late_charge DEFAULT 0');

-- How far past the deadline they actually were, frozen at checkout. Kept
-- because the charge alone doesn't say whether ₹0 was a waiver or an on-time
-- departure, and that is the first question anyone asks of a disputed bill.
IF COL_LENGTH('dbo.bookings', 'late_checkout_minutes') IS NULL
    EXEC('ALTER TABLE dbo.bookings ADD late_checkout_minutes INT NULL');

-- Snapshotted onto the invoice under the same rule as every other amount on
-- it: an issued bill is immutable, so it cannot be reprinted by reading the
-- booking back and hoping nobody edited it since.
IF COL_LENGTH('dbo.invoices', 'late_checkout_charge') IS NULL
    EXEC('ALTER TABLE dbo.invoices ADD late_checkout_charge DECIMAL(10,2) NOT NULL CONSTRAINT df_invoices_late_charge DEFAULT 0');

-- ---------------------------------------------------------------------------
-- Concessions and discounts
-- ---------------------------------------------------------------------------
-- Two different decisions, taken by two different people at two different
-- moments, so they are two columns and not one.
--
-- bookings.discount_amount is the concession reception agreed at the desk,
-- once, on the whole stay after every extra was on it. It replaces the old
-- base_price_override (still read, never written now, so stays booked at a
-- negotiated rate keep pricing at it): haggling happens over the total a guest
-- is quoted, not over the per-night rate that total was built from. It is
-- spread back across the nights in nightly_breakdown so billing keeps taxing
-- each night on what was actually charged for it.
IF COL_LENGTH('dbo.bookings', 'discount_amount') IS NULL
    EXEC('ALTER TABLE dbo.bookings ADD discount_amount DECIMAL(10,2) NOT NULL CONSTRAINT df_bookings_discount DEFAULT 0');

-- invoices.discount_amount is the billing desk's own reduction, decided when
-- the document is written and applied to everything on it — room, overstay and
-- food alike. Snapshotted here like every other amount on an issued bill.
-- The percentage is stored alongside rather than recomputed, because it is
-- what was agreed with the guest ("10% off") and the amount is what that came
-- to; round-off would otherwise make the printed percentage drift.
IF COL_LENGTH('dbo.invoices', 'discount_amount') IS NULL
    EXEC('ALTER TABLE dbo.invoices ADD discount_amount DECIMAL(10,2) NOT NULL CONSTRAINT df_invoices_discount DEFAULT 0');

IF COL_LENGTH('dbo.invoices', 'discount_percent') IS NULL
    EXEC('ALTER TABLE dbo.invoices ADD discount_percent DECIMAL(5,2) NOT NULL CONSTRAINT df_invoices_discount_pct DEFAULT 0');

-- Why the discount was given, printed beside it (migration 045). Nullable:
-- bills issued before it existed print as they always did.
IF COL_LENGTH('dbo.invoices', 'discount_reason') IS NULL
    EXEC('ALTER TABLE dbo.invoices ADD discount_reason NVARCHAR(100) NULL');

-- ---------------------------------------------------------------------------
-- Kitchen raw material inventory
-- ---------------------------------------------------------------------------
-- What the kitchen buys, what each dish eats, and a ledger tying the two
-- together. Stock falls when a cook ticks a dish off as it leaves the pan —
-- see applyOrderItemStock in inventory.service.js.
--
-- No unit conversion anywhere in this feature. A material is stocked, counted
-- and cooked in exactly one unit, chosen when it is created: a kitchen that
-- wants to think in grams stocks grams. Conversion would mean a factor table,
-- a rounding rule per material and a whole class of "why is my rice 0.4kg out"
-- questions, to save the owner picking G instead of KG once.
IF OBJECT_ID('dbo.raw_materials', 'U') IS NULL
CREATE TABLE dbo.raw_materials (
    id                   BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id             BIGINT NOT NULL REFERENCES dbo.lodges(id),
    name                 NVARCHAR(120) NOT NULL,
    unit                 NVARCHAR(4) NOT NULL
        CONSTRAINT ck_raw_materials_unit CHECK (unit IN ('KG', 'G', 'L', 'ML', 'PCS')),
    -- What the thing *is*, so a store cupboard of seventy-odd lines reads as
    -- half a dozen short lists instead of one long one. A fixed set rather
    -- than a per-lodge table: it is a shelf label, not a business decision,
    -- and every kitchen sorts its store room roughly this way.
    --
    -- OTHER is the fallback and is why this could be added to a table that
    -- already had rows — anything uncategorised lands there and sorts last.
    category             NVARCHAR(12) NOT NULL DEFAULT 'OTHER'
        CONSTRAINT ck_raw_materials_category CHECK (category IN
            ('GRAINS', 'BAKERY', 'PRODUCE', 'PROTEIN', 'STAPLES', 'SPICES', 'BOTTLED', 'OTHER')),
    -- Deliberately has no `>= 0` check. A cook ticking off a dish must never be
    -- blocked by a stale count — the food is already made by then — so stock is
    -- allowed to go negative, and a negative reading is the signal to the owner
    -- that the book count has drifted from the shelf. Clamping at zero would
    -- hide exactly the number they need to correct it by.
    quantity             DECIMAL(12,3) NOT NULL DEFAULT 0,
    low_stock_threshold  DECIMAL(12,3) NOT NULL DEFAULT 0
        CONSTRAINT ck_raw_materials_threshold CHECK (low_stock_threshold >= 0),
    is_active            BIT NOT NULL DEFAULT 1,
    created_at           DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_raw_materials_lodge_name UNIQUE (lodge_id, name)
);

-- The same column again for store cupboards that were created before it
-- existed. Their rows take the OTHER default and are re-categorised by the
-- seed script, or by hand on the Inventory tab.
IF COL_LENGTH('dbo.raw_materials', 'category') IS NULL
    EXEC('ALTER TABLE dbo.raw_materials ADD category NVARCHAR(12) NOT NULL
          CONSTRAINT df_raw_materials_category DEFAULT ''OTHER''
          CONSTRAINT ck_raw_materials_category CHECK (category IN
            (''GRAINS'', ''BAKERY'', ''PRODUCE'', ''PROTEIN'', ''STAPLES'', ''SPICES'', ''BOTTLED'', ''OTHER''))');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_raw_materials_lodge' AND object_id = OBJECT_ID('dbo.raw_materials'))
CREATE INDEX ix_raw_materials_lodge ON dbo.raw_materials(lodge_id, is_active);

-- One ingredient line of one dish: "a full plate of Masala Dosa eats 180 g of
-- rice". quantity is per single serving, in the material's own unit, and is
-- multiplied by the order line's quantity at cook time.
--
-- portion_id NULL means the line applies to the dish whatever size was ordered.
-- A dish may therefore be described either way: per size where a half plate
-- genuinely eats less, or once at dish level where it doesn't. Resolution is
-- "per-size rows if this size has any, otherwise the dish-level rows" — there
-- is no flag saying which mode a dish is in, for the same reason portions
-- themselves have none. Having the rows *is* the mode.
--
-- SQL Server treats NULLs as equal for uniqueness, which is what's wanted here:
-- it permits one dish-level row per material alongside one row per size.
IF OBJECT_ID('dbo.menu_item_recipes', 'U') IS NULL
CREATE TABLE dbo.menu_item_recipes (
    id           BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id     BIGINT NOT NULL REFERENCES dbo.lodges(id),
    item_id      BIGINT NOT NULL REFERENCES dbo.menu_items(id),
    portion_id   BIGINT NULL REFERENCES dbo.menu_item_portions(id),
    material_id  BIGINT NOT NULL REFERENCES dbo.raw_materials(id),
    quantity     DECIMAL(12,3) NOT NULL
        CONSTRAINT ck_menu_item_recipes_quantity CHECK (quantity > 0),
    created_at   DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_menu_item_recipes UNIQUE (item_id, portion_id, material_id)
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_menu_item_recipes_item' AND object_id = OBJECT_ID('dbo.menu_item_recipes'))
CREATE INDEX ix_menu_item_recipes_item ON dbo.menu_item_recipes(item_id, portion_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_menu_item_recipes_material' AND object_id = OBJECT_ID('dbo.menu_item_recipes'))
CREATE INDEX ix_menu_item_recipes_material ON dbo.menu_item_recipes(material_id);

-- Every change to a material's quantity, signed, with what caused it. The
-- running quantity on raw_materials is the fast path for screens; this is the
-- record that explains it, and it is the only way anyone can answer "we bought
-- 20 kg on Tuesday, where did it go".
--
-- balance_after is written from the same UPDATE that moved the stock, so the
-- ledger reads correctly even though two cooks tick dishes off at once and the
-- rows do not arrive in a tidy order.
--
-- REVERSAL is a cook un-ticking a dish they ticked by mistake. It is a new row
-- adding the material back rather than a delete of the CONSUMPTION row: the
-- mistake is part of what happened, and a shift that was ticked wrong twice is
-- worth being able to see.
IF OBJECT_ID('dbo.stock_movements', 'U') IS NULL
CREATE TABLE dbo.stock_movements (
    id             BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id       BIGINT NOT NULL REFERENCES dbo.lodges(id),
    material_id    BIGINT NOT NULL REFERENCES dbo.raw_materials(id),
    change_qty     DECIMAL(12,3) NOT NULL,
    balance_after  DECIMAL(12,3) NOT NULL,
    reason         NVARCHAR(12) NOT NULL 
        CONSTRAINT ck_stock_movements_reason CHECK (reason IN ('OPENING', 'PURCHASE', 'ADJUSTMENT', 'CONSUMPTION', 'REVERSAL')),
    order_id       BIGINT NULL REFERENCES dbo.food_orders(id),
    order_item_id  BIGINT NULL REFERENCES dbo.food_order_items(id),
    note           NVARCHAR(200) NULL,
    created_by     BIGINT NULL REFERENCES dbo.users(id),
    created_at     DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_stock_movements_material' AND object_id = OBJECT_ID('dbo.stock_movements'))
CREATE INDEX ix_stock_movements_material ON dbo.stock_movements(lodge_id, material_id, id DESC);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_stock_movements_order' AND object_id = OBJECT_ID('dbo.stock_movements'))
CREATE INDEX ix_stock_movements_order ON dbo.stock_movements(order_id) WHERE order_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Parked bookings
-- ---------------------------------------------------------------------------
-- A booking reception started and got interrupted out of. Its own table rather
-- than a bookings.status = 'DRAFT', because a draft is not a booking: it holds
-- no room, it is not billable, it has no guest register entry, and it is
-- allowed to be incomplete in ways every query against dbo.bookings assumes
-- nothing ever is. Sharing the table would mean auditing every status filter in
-- the codebase and getting one wrong would put an imaginary guest on a bill.
--
-- Crucially it does NOT block availability. Two people can draft the same room
-- for the same nights, and a real booking will take it from under both — which
-- is correct, because nothing has been agreed with anybody yet. The tape chart
-- shows drafts so the desk can see what is pending, not to reserve anything.
--
-- payload is the whole booking form as the screen holds it, so reopening a
-- draft restores every answer including the ones that have no column here.
-- room_id, the dates and the guest name are lifted out of it only so the chart
-- and the drafts list can render without parsing JSON per row.
IF OBJECT_ID('dbo.booking_drafts', 'U') IS NULL
CREATE TABLE dbo.booking_drafts (
    id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id        BIGINT NOT NULL REFERENCES dbo.lodges(id),
    -- NULL until reception has picked one; such a draft simply doesn't appear
    -- on the chart, since there is no row to draw it against.
    room_id         BIGINT NULL REFERENCES dbo.rooms(id),
    check_in_date   DATE NULL,
    check_out_date  DATE NULL,
    guest_name      NVARCHAR(200) NULL,
    payload         NVARCHAR(MAX) NOT NULL
        CONSTRAINT ck_booking_drafts_payload CHECK (ISJSON(payload) = 1),
    created_by      BIGINT NULL REFERENCES dbo.users(id),
    created_at      DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    updated_at      DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_booking_drafts_lodge' AND object_id = OBJECT_ID('dbo.booking_drafts'))
CREATE INDEX ix_booking_drafts_lodge ON dbo.booking_drafts(lodge_id, updated_at DESC);

-- The chart asks "which drafts touch these nights", the same overlap question
-- the tape chart asks of bookings.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_booking_drafts_dates' AND object_id = OBJECT_ID('dbo.booking_drafts'))
CREATE INDEX ix_booking_drafts_dates ON dbo.booking_drafts(lodge_id, check_in_date, check_out_date) WHERE room_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Transaction references for money that didn't arrive as cash
-- ---------------------------------------------------------------------------
-- A UPI or card payment leaves a number on both sides — the guest's app and
-- the property's settlement statement — and reconciling the two at month end
-- is impossible without it recorded against the stay. Cash leaves no such
-- trail and needs none, which is why these are nullable rather than required
-- columns: the requirement is on the payment method, and lives in the schemas.
--
-- NVARCHAR(64): a UPI transaction id is 12 digits, an RRN 12, a card auth code
-- 6, and gateway references run longer. Wide enough for all of them without
-- inviting a paragraph.
IF COL_LENGTH('dbo.bookings', 'advance_reference') IS NULL
    EXEC('ALTER TABLE dbo.bookings ADD advance_reference NVARCHAR(64) NULL');

IF COL_LENGTH('dbo.invoices', 'balance_reference') IS NULL
    EXEC('ALTER TABLE dbo.invoices ADD balance_reference NVARCHAR(64) NULL');

-- ---------------------------------------------------------------------------
-- The advance-receipt number series
-- ---------------------------------------------------------------------------
-- Advance receipts run on their own sequence so the tax-invoice numbering stays
-- gapless — an advance taken today and a bill cut next week must not interleave
-- in one series. Widening the CHECK is the whole change; the allocator in
-- billing.service.js already takes the series type as a parameter.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_invoice_series_type')
ALTER TABLE dbo.invoice_series DROP CONSTRAINT ck_invoice_series_type;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_invoice_series_type')
ALTER TABLE dbo.invoice_series ADD CONSTRAINT ck_invoice_series_type
    CHECK (series_type IN ('GST', 'NON_GST', 'ADVANCE'));

-- ---------------------------------------------------------------------------
-- Owner-chosen document serials, with no prefix
-- ---------------------------------------------------------------------------
-- Bills used to go out as "INV-1" / "RCT-1" / "ADV-1", a prefix the code chose.
-- Properties number their bills to match the books they already keep, so the
-- prefix is empty by default and the starting serial is the owner's to set
-- (see billing/series.service.js).
--
-- Numbers already issued are never rewritten: invoice_number and receipt_number
-- hold the string that was printed and handed to a guest.
UPDATE dbo.invoice_series SET prefix = N'' WHERE prefix <> N'';

IF NOT EXISTS (
    SELECT 1 FROM sys.default_constraints WHERE name = 'df_invoice_series_prefix'
)
BEGIN
    DECLARE @df_prefix SYSNAME;
    SELECT @df_prefix = name FROM sys.default_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.invoice_series')
      AND COL_NAME(parent_object_id, parent_column_id) = 'prefix';
    IF @df_prefix IS NOT NULL
        EXEC('ALTER TABLE dbo.invoice_series DROP CONSTRAINT ' + @df_prefix);
    ALTER TABLE dbo.invoice_series
        ADD CONSTRAINT df_invoice_series_prefix DEFAULT N'' FOR prefix;
END;

-- Nothing previously stopped two documents sharing a number — the only unique
-- index on dbo.invoices is uq_invoices_booking_active, which limits a booking
-- to one active invoice and says nothing about the number. Survivable while the
-- counter was untouchable; not once the serial can be set by hand.
--
-- Scoped per lodge, and covering VOID rows as well as ISSUED: a voided number
-- is spent, and GST expects the void to stay visible in the series rather than
-- the number being handed to a different guest.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_invoices_lodge_number' AND object_id = OBJECT_ID('dbo.invoices'))
    CREATE UNIQUE INDEX uq_invoices_lodge_number ON dbo.invoices(lodge_id, invoice_number);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_advance_receipts_lodge_number' AND object_id = OBJECT_ID('dbo.advance_receipts'))
    CREATE UNIQUE INDEX uq_advance_receipts_lodge_number ON dbo.advance_receipts(lodge_id, receipt_number);

-- ---------------------------------------------------------------------------
-- Several beds in one room
-- ---------------------------------------------------------------------------
-- bed_size holds one enum, so a family room with a double and two singles could
-- only record whichever the desk picked. The full list lives here as JSON;
-- bed_size stays, derived from the first entry, because the public room-type
-- page, the booking chip, the price simulator and the room card all read it.
IF COL_LENGTH('dbo.rooms', 'beds') IS NULL
    EXEC('ALTER TABLE dbo.rooms ADD beds NVARCHAR(MAX) NULL');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_rooms_beds_json')
    EXEC('ALTER TABLE dbo.rooms ADD CONSTRAINT ck_rooms_beds_json
          CHECK (beds IS NULL OR ISJSON(beds) = 1)');

UPDATE dbo.rooms
SET beds = '[{"size":"' + bed_size + '","count":1}]'
WHERE beds IS NULL AND bed_size IS NOT NULL;

-- ---------------------------------------------------------------------------
-- What an extra was agreed to cost on this booking, per night
-- ---------------------------------------------------------------------------
-- Extras were costed by joining live to switchable_charges.charge_per_night, so
-- reception could not negotiate one and — silently — raising a lodge price
-- repriced every booking ever taken, printed bills included.
--
-- The amount is for the whole line per night, not per unit: the desk agrees
-- "₹100 for the extra beds", and 100 split three ways is 33.33, which
-- multiplies back to 99.99 and leaves a stray paisa on the bill.
IF COL_LENGTH('dbo.booking_switchable_charges', 'agreed_amount') IS NULL
    EXEC('ALTER TABLE dbo.booking_switchable_charges ADD agreed_amount DECIMAL(10,2) NULL');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_booking_switchable_charges_agreed_amount')
    EXEC('ALTER TABLE dbo.booking_switchable_charges ADD CONSTRAINT ck_booking_switchable_charges_agreed_amount
          CHECK (agreed_amount IS NULL OR agreed_amount >= 0)');

-- ---------------------------------------------------------------------------
-- Event bookings (migration 046)
-- ---------------------------------------------------------------------------
-- A hall, lawn or terrace let out for a birthday, wedding, reception or
-- corporate function. See migrations/046_event_bookings.sql for the reasoning
-- behind each table; this is the same DDL folded in so a database built from
-- nothing matches one migrated forward.

-- Not every property has a hall to let: a fifth capability bit.
IF COL_LENGTH('dbo.lodges', 'has_events') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD has_events BIT NOT NULL CONSTRAINT df_lodges_has_events DEFAULT 0');

-- The spaces a property lets. The diary and the clash check are per venue.
IF OBJECT_ID('dbo.event_venues', 'U') IS NULL
CREATE TABLE dbo.event_venues (
    id            BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id      BIGINT NOT NULL REFERENCES dbo.lodges(id),
    name          NVARCHAR(100) NOT NULL,
    capacity_pax  INT NULL,
    -- Per slot, GST-inclusive.
    base_charge   DECIMAL(10,2) NOT NULL CONSTRAINT df_event_venues_base_charge DEFAULT 0,
    is_active     BIT NOT NULL CONSTRAINT df_event_venues_active DEFAULT 1,
    created_at    DATETIMEOFFSET NOT NULL CONSTRAINT df_event_venues_created DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_event_venues_lodge_name UNIQUE (lodge_id, name)
);

-- Photos of a venue, up to six, kept the way room_images are.
IF OBJECT_ID('dbo.event_venue_images', 'U') IS NULL
CREATE TABLE dbo.event_venue_images (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    venue_id    BIGINT NOT NULL REFERENCES dbo.event_venues(id),
    filename    NVARCHAR(255) NOT NULL,
    sort_order  INT NOT NULL CONSTRAINT df_event_venue_images_sort DEFAULT 0,
    created_at  DATETIMEOFFSET NOT NULL CONSTRAINT df_event_venue_images_created DEFAULT SYSDATETIMEOFFSET()
);

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'ix_event_venue_images_venue' AND object_id = OBJECT_ID('dbo.event_venue_images')
)
    CREATE INDEX ix_event_venue_images_venue ON dbo.event_venue_images(venue_id);

-- Decoration, DJ, mandap, extra chairs: the catalogue a function is sold from.
IF OBJECT_ID('dbo.event_addons', 'U') IS NULL
CREATE TABLE dbo.event_addons (
    id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id        BIGINT NOT NULL REFERENCES dbo.lodges(id),
    name            NVARCHAR(100) NOT NULL,
    default_amount  DECIMAL(10,2) NOT NULL CONSTRAINT df_event_addons_amount DEFAULT 0,
    is_per_unit     BIT NOT NULL CONSTRAINT df_event_addons_per_unit DEFAULT 0,
    is_active       BIT NOT NULL CONSTRAINT df_event_addons_active DEFAULT 1,
    created_at      DATETIMEOFFSET NOT NULL CONSTRAINT df_event_addons_created DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_event_addons_lodge_name UNIQUE (lodge_id, name)
);

-- One function, from the first call to the settled bill. Time is a real
-- range (a wedding runs 6 pm to 1 am). TENTATIVE and CONFIRMED block the venue.
IF OBJECT_ID('dbo.event_bookings', 'U') IS NULL
CREATE TABLE dbo.event_bookings (
    id                  BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id            BIGINT NOT NULL REFERENCES dbo.lodges(id),
    venue_id            BIGINT NOT NULL REFERENCES dbo.event_venues(id),
    event_type          NVARCHAR(20) NOT NULL
        CONSTRAINT ck_event_bookings_type
        CHECK (event_type IN ('BIRTHDAY', 'WEDDING', 'RECEPTION', 'ENGAGEMENT', 'CORPORATE', 'OTHER')),
    title               NVARCHAR(200) NOT NULL,
    organiser_name      NVARCHAR(200) NOT NULL,
    organiser_phone     NVARCHAR(20) NOT NULL,
    organiser_alt_phone NVARCHAR(20) NULL,
    start_at            DATETIMEOFFSET NOT NULL,
    end_at              DATETIMEOFFSET NOT NULL,
    slot                NVARCHAR(10) NOT NULL
        CONSTRAINT ck_event_bookings_slot CHECK (slot IN ('MORNING', 'EVENING', 'FULL_DAY', 'CUSTOM')),
    expected_pax        INT NOT NULL CONSTRAINT ck_event_bookings_expected CHECK (expected_pax >= 0),
    guaranteed_pax      INT NOT NULL CONSTRAINT df_event_bookings_guaranteed DEFAULT 0,
    final_pax           INT NULL,
    venue_charge        DECIMAL(10,2) NOT NULL CONSTRAINT df_event_bookings_venue_charge DEFAULT 0,
    per_plate_rate      DECIMAL(10,2) NOT NULL CONSTRAINT df_event_bookings_plate DEFAULT 0,
    catering_amount     DECIMAL(10,2) NOT NULL CONSTRAINT df_event_bookings_catering DEFAULT 0,
    addons_total        DECIMAL(10,2) NOT NULL CONSTRAINT df_event_bookings_addons DEFAULT 0,
    discount_amount     DECIMAL(10,2) NOT NULL CONSTRAINT df_event_bookings_discount DEFAULT 0,
    discount_reason     NVARCHAR(100) NULL,
    total_amount        DECIMAL(10,2) NOT NULL CONSTRAINT df_event_bookings_total DEFAULT 0,
    pricing_breakdown   NVARCHAR(MAX) NULL
        CONSTRAINT ck_event_bookings_breakdown_json CHECK (pricing_breakdown IS NULL OR ISJSON(pricing_breakdown) = 1),
    advance_amount      DECIMAL(10,2) NULL,
    advance_payment_method NVARCHAR(20) NULL
        CONSTRAINT ck_event_bookings_advance_method CHECK (advance_payment_method IN ('CASH', 'UPI', 'CARD')),
    menu_notes          NVARCHAR(MAX) NULL,
    setup_notes         NVARCHAR(MAX) NULL,
    schedule_notes      NVARCHAR(MAX) NULL,
    -- Rooms wanted alongside the function: how many, which nights (rooms_to
    -- is the leaving morning, exclusive, as a stay's check_out_date is), and
    -- a note. A need recorded, not a booking made — the stay is booked from
    -- the tape chart and billed as accommodation. Catering has no flag of its
    -- own: per_plate_rate = 0 is "no catering".
    rooms_required      BIT NOT NULL CONSTRAINT df_event_bookings_rooms_required DEFAULT 0,
    rooms_count         INT NULL,
    rooms_from          DATE NULL,
    rooms_to            DATE NULL,
    rooms_notes         NVARCHAR(500) NULL,
    status              NVARCHAR(10) NOT NULL CONSTRAINT df_event_bookings_status DEFAULT 'ENQUIRY'
        CONSTRAINT ck_event_bookings_status
        CHECK (status IN ('ENQUIRY', 'TENTATIVE', 'CONFIRMED', 'SETTLED', 'CANCELLED', 'EXPIRED')),
    hold_expires_at     DATETIMEOFFSET NULL,
    cancel_reason       NVARCHAR(200) NULL,
    refund_amount       DECIMAL(10,2) NULL,
    created_by          BIGINT NULL REFERENCES dbo.users(id),
    created_at          DATETIMEOFFSET NOT NULL CONSTRAINT df_event_bookings_created DEFAULT SYSDATETIMEOFFSET(),
    updated_at          DATETIMEOFFSET NOT NULL CONSTRAINT df_event_bookings_updated DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT ck_event_bookings_range CHECK (end_at > start_at)
);

IF COL_LENGTH('dbo.event_bookings', 'rooms_required') IS NULL
    EXEC('ALTER TABLE dbo.event_bookings ADD rooms_required BIT NOT NULL CONSTRAINT df_event_bookings_rooms_required DEFAULT 0');
IF COL_LENGTH('dbo.event_bookings', 'rooms_count') IS NULL
    EXEC('ALTER TABLE dbo.event_bookings ADD rooms_count INT NULL');
IF COL_LENGTH('dbo.event_bookings', 'rooms_from') IS NULL
    EXEC('ALTER TABLE dbo.event_bookings ADD rooms_from DATE NULL');
IF COL_LENGTH('dbo.event_bookings', 'rooms_to') IS NULL
    EXEC('ALTER TABLE dbo.event_bookings ADD rooms_to DATE NULL');
IF COL_LENGTH('dbo.event_bookings', 'rooms_notes') IS NULL
    EXEC('ALTER TABLE dbo.event_bookings ADD rooms_notes NVARCHAR(500) NULL');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_event_bookings_venue_time' AND object_id = OBJECT_ID('dbo.event_bookings'))
    CREATE INDEX ix_event_bookings_venue_time ON dbo.event_bookings(venue_id, start_at, end_at) INCLUDE (status);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_event_bookings_lodge_status' AND object_id = OBJECT_ID('dbo.event_bookings'))
    CREATE INDEX ix_event_bookings_lodge_status ON dbo.event_bookings(lodge_id, status, start_at);

-- What a function was sold with, at the price agreed. Snapshotted off the
-- catalogue; agreed_amount is the whole line.
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
        CONSTRAINT ck_event_booking_addons_agreed CHECK (agreed_amount >= 0),
    -- An extra asked for on the day — fifty more chairs, a second mic —
    -- noted from the function's page while it is live so it reaches the
    -- bill. needs_pricing is the reminder: the desk wrote it down before a
    -- price was agreed, and the bill will not issue until one is.
    is_extra          BIT NOT NULL CONSTRAINT df_event_booking_addons_extra DEFAULT 0,
    needs_pricing     BIT NOT NULL CONSTRAINT df_event_booking_addons_unpriced DEFAULT 0,
    noted_at          DATETIMEOFFSET NULL
);

IF COL_LENGTH('dbo.event_booking_addons', 'is_extra') IS NULL
    EXEC('ALTER TABLE dbo.event_booking_addons ADD is_extra BIT NOT NULL CONSTRAINT df_event_booking_addons_extra DEFAULT 0');
IF COL_LENGTH('dbo.event_booking_addons', 'needs_pricing') IS NULL
    EXEC('ALTER TABLE dbo.event_booking_addons ADD needs_pricing BIT NOT NULL CONSTRAINT df_event_booking_addons_unpriced DEFAULT 0');
IF COL_LENGTH('dbo.event_booking_addons', 'noted_at') IS NULL
    EXEC('ALTER TABLE dbo.event_booking_addons ADD noted_at DATETIMEOFFSET NULL');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_event_booking_addons_booking' AND object_id = OBJECT_ID('dbo.event_booking_addons'))
    CREATE INDEX ix_event_booking_addons_booking ON dbo.event_booking_addons(event_booking_id);

-- Hall hire is SAC 997212 at a flat 18%: a third supply_type. Catering with a
-- function is billed on the FOOD rate as its own line.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_gst_slabs_supply')
    ALTER TABLE dbo.gst_slabs DROP CONSTRAINT ck_gst_slabs_supply;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_gst_slabs_supply')
    EXEC('ALTER TABLE dbo.gst_slabs ADD CONSTRAINT ck_gst_slabs_supply
          CHECK (supply_type IN (''ACCOMMODATION'', ''FOOD'', ''VENUE''))');

EXEC('IF NOT EXISTS (SELECT 1 FROM dbo.gst_slabs WHERE supply_type = ''VENUE'')
        INSERT INTO dbo.gst_slabs (supply_type, max_amount, rate_percent, applies_to_specified, sac_code)
        VALUES (''VENUE'', NULL, 18, NULL, ''997212'')');

-- The final bill and the advance receipt hang off the same documents a stay
-- uses. On invoices, room_subtotal carries the venue side (hall plus add-ons)
-- and food_subtotal the catering; the document reads its labels from
-- event_booking_id being set.
IF COL_LENGTH('dbo.invoices', 'event_booking_id') IS NULL
    EXEC('ALTER TABLE dbo.invoices ADD event_booking_id BIGINT NULL REFERENCES dbo.event_bookings(id)');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_invoices_event_active' AND object_id = OBJECT_ID('dbo.invoices'))
    EXEC('CREATE UNIQUE INDEX uq_invoices_event_active ON dbo.invoices(event_booking_id)
          WHERE status = ''ISSUED'' AND event_booking_id IS NOT NULL');

-- A receipt is against a stay or a function, never both and never neither.
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.advance_receipts') AND name = 'booking_id' AND is_nullable = 0
)
    ALTER TABLE dbo.advance_receipts ALTER COLUMN booking_id BIGINT NULL;

IF COL_LENGTH('dbo.advance_receipts', 'event_booking_id') IS NULL
    EXEC('ALTER TABLE dbo.advance_receipts ADD event_booking_id BIGINT NULL REFERENCES dbo.event_bookings(id)');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_advance_receipts_parent')
    EXEC('ALTER TABLE dbo.advance_receipts ADD CONSTRAINT ck_advance_receipts_parent CHECK (
        (CASE WHEN booking_id IS NULL THEN 0 ELSE 1 END)
      + (CASE WHEN event_booking_id IS NULL THEN 0 ELSE 1 END) = 1)');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_advance_receipts_event' AND object_id = OBJECT_ID('dbo.advance_receipts'))
    EXEC('CREATE INDEX ix_advance_receipts_event ON dbo.advance_receipts(event_booking_id, status)
          WHERE event_booking_id IS NOT NULL');

-- events.manage on the built-in roles (migration 047). Only where they are
-- still at their shipped defaults; a customised built-in keeps its own set.
IF EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'OWNER'
           AND permissions = '["rooms.manage","bookings.manage","billing.manage","guests.view","reports.view","staff.manage","food.manage","orders.manage"]')
UPDATE dbo.roles
SET permissions = '["rooms.manage","bookings.manage","billing.manage","guests.view","reports.view","staff.manage","food.manage","orders.manage","events.manage"]'
WHERE lodge_id IS NULL AND role_key = 'OWNER';

IF EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'RECEPTION'
           AND permissions = '["bookings.manage","billing.manage","guests.view","orders.manage"]')
UPDATE dbo.roles
SET permissions = '["bookings.manage","billing.manage","guests.view","orders.manage","events.manage"]'
WHERE lodge_id IS NULL AND role_key = 'RECEPTION';

-- ---------------------------------------------------------------------------
-- Map coordinates (migration 050)
-- ---------------------------------------------------------------------------
-- Where the property is, as a pin. The address says what to print; this says
-- where to point a map. Both set or both null, in range.
IF COL_LENGTH('dbo.lodges', 'latitude') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD latitude DECIMAL(9,6) NULL');

IF COL_LENGTH('dbo.lodges', 'longitude') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD longitude DECIMAL(9,6) NULL');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_lodges_coordinates')
    EXEC('ALTER TABLE dbo.lodges WITH CHECK ADD CONSTRAINT ck_lodges_coordinates CHECK (
        (latitude IS NULL AND longitude IS NULL)
     OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))');
