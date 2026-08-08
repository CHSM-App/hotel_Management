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
    city                   NVARCHAR(100) NULL,
    state                  NVARCHAR(100) NULL,
    checkin_mode           NVARCHAR(20) NOT NULL DEFAULT 'HOUR_24'
        CONSTRAINT ck_lodges_checkin_mode CHECK (checkin_mode IN ('HOUR_24', 'NIGHT_BASED')),
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

-- vehicle_number moved off dbo.bookings — a booking can now have zero or
-- more vehicles, so it lives in its own table. No DEFAULT/CHECK on
-- vehicle_number, so a plain DROP COLUMN is safe, same as fixed_price above.
IF OBJECT_ID('dbo.bookings', 'U') IS NOT NULL AND COL_LENGTH('dbo.bookings', 'vehicle_number') IS NOT NULL
    ALTER TABLE dbo.bookings DROP COLUMN vehicle_number;

IF OBJECT_ID('dbo.booking_vehicles', 'U') IS NULL
CREATE TABLE dbo.booking_vehicles (
    id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    booking_id      BIGINT NOT NULL REFERENCES dbo.bookings(id),
    vehicle_number  NVARCHAR(20) NOT NULL
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_booking_vehicles_booking' AND object_id = OBJECT_ID('dbo.booking_vehicles'))
CREATE INDEX ix_booking_vehicles_booking ON dbo.booking_vehicles(booking_id);

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
    created_at         DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_booking_guests_booking' AND object_id = OBJECT_ID('dbo.booking_guests'))
CREATE INDEX ix_booking_guests_booking ON dbo.booking_guests(booking_id);

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

-- id_proof_document — the guest's ID proof is now uploaded (image or PDF)
-- and stored on disk under uploads/id-proofs, referenced here by filename;
-- id_proof_number (a typed-in number) is retired. No DEFAULT/CHECK on
-- id_proof_number, so a plain DROP COLUMN is safe, same as fixed_price above.
IF OBJECT_ID('dbo.bookings', 'U') IS NOT NULL AND COL_LENGTH('dbo.bookings', 'id_proof_document') IS NULL
    ALTER TABLE dbo.bookings ADD id_proof_document NVARCHAR(255) NULL;

IF OBJECT_ID('dbo.bookings', 'U') IS NOT NULL AND COL_LENGTH('dbo.bookings', 'id_proof_number') IS NOT NULL
    ALTER TABLE dbo.bookings DROP COLUMN id_proof_number;

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
