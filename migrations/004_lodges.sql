-- lodges
--
-- One table per migration, in foreign-key dependency order: this file is
-- 1 of 32 that together build the database from nothing. The number is the
-- order, so these must be applied in sequence — which the engine does.
--
-- Guarded, so applying this to a database that already has the table is a
-- no-op rather than an error.
--
-- Additive, and deliberately so
-- -----------------------------
-- 000_prerequisite_tables.sql creates a bare dbo.lodges so that 002's ALTER has
-- a table to alter. That means the CREATE below finds one already there and
-- does nothing, so every column 000 left out has to be added separately
-- afterwards — otherwise a from-scratch build ends up with a lodges table
-- missing has_rooms and the late-checkout policy, and 012's Extra-bed seed
-- fails on the missing column.
--
-- Each ADD is wrapped in EXEC so it compiles in its own sub-batch: this file is
-- split on GO, and a statement naming a column added earlier in the same batch
-- would otherwise be parsed before that column exists. Same trick schema.sql
-- uses throughout.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF OBJECT_ID('dbo.lodges', 'U') IS NULL
CREATE TABLE dbo.lodges (
    id                     BIGINT IDENTITY(1,1) PRIMARY KEY,
    name                   NVARCHAR(200) NOT NULL,
    slug                   NVARCHAR(200) COLLATE Latin1_General_BIN2 NOT NULL UNIQUE,
    phone                  NVARCHAR(20) NULL,
    whatsapp_number        NVARCHAR(20) NULL,
    address                NVARCHAR(500) NULL,
    -- The masthead in Devanagari, as the property wrote it. The bill prints
    -- these when its language toggle is Marathi, falling back to the English
    -- fields when empty. Mirrors migration 002.
    name_mr                NVARCHAR(200) NULL,
    address_mr             NVARCHAR(500) NULL,
    city                   NVARCHAR(100) NULL,
    state                  NVARCHAR(100) NULL,
    checkin_mode           NVARCHAR(20) NOT NULL DEFAULT 'HOUR_24'
        CONSTRAINT ck_lodges_checkin_mode CHECK (checkin_mode IN ('HOUR_24', 'NIGHT_BASED')),
    is_gst_registered      BIT NOT NULL DEFAULT 0,
    gstin                  NVARCHAR(15) NULL,
    is_specified_premises  BIT NOT NULL DEFAULT 0,
    is_active              BIT NOT NULL DEFAULT 1,
    -- What this property actually is. Four independent bits rather than one
    -- property_type enum because the combinations are real: a restaurant with
    -- no rooms, a lodge that doesn't serve food, a lodge serving rooms only,
    -- and one doing both. has_rooms defaults to 1 — the product started as a
    -- rooms-only PMS.
    has_rooms              BIT NOT NULL CONSTRAINT df_lodges_has_rooms DEFAULT 1,
    serves_food            BIT NOT NULL CONSTRAINT df_lodges_serves_food DEFAULT 0,
    food_room_service      BIT NOT NULL CONSTRAINT df_lodges_food_room_service DEFAULT 0,
    food_table_service     BIT NOT NULL CONSTRAINT df_lodges_food_table_service DEFAULT 0,
    -- Late-checkout policy: three numbers over a grace period, which is how a
    -- lodge prices this out loud. Percentages rather than rupees so a suite and
    -- a single room scale on their own tariff.
    check_out_time              TIME(0) NOT NULL CONSTRAINT df_lodges_check_out_time DEFAULT '11:00:00',
    late_grace_minutes          INT NOT NULL CONSTRAINT df_lodges_late_grace DEFAULT 60,
    late_half_day_percent       DECIMAL(5,2) NOT NULL CONSTRAINT df_lodges_late_half DEFAULT 50,
    late_full_day_after_minutes INT NOT NULL CONSTRAINT df_lodges_late_full_after DEFAULT 360,
    late_full_day_percent       DECIMAL(5,2) NOT NULL CONSTRAINT df_lodges_late_full DEFAULT 100,
    created_at             DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

-- The Marathi masthead, for a database where 002 has not run (a from-scratch
-- build reaches 002 before this file, but an existing database may have had the
-- table created by an older schema.sql without these columns).
IF COL_LENGTH('dbo.lodges', 'name_mr') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD name_mr NVARCHAR(200) NULL');
GO

IF COL_LENGTH('dbo.lodges', 'address_mr') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD address_mr NVARCHAR(500) NULL');
GO

-- The four property-shape bits.
IF COL_LENGTH('dbo.lodges', 'has_rooms') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD has_rooms BIT NOT NULL CONSTRAINT df_lodges_has_rooms DEFAULT 1');
GO

IF COL_LENGTH('dbo.lodges', 'serves_food') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD serves_food BIT NOT NULL CONSTRAINT df_lodges_serves_food DEFAULT 0');
GO

-- Room service means the in-room ordering flow; table service means the
-- dining-table QR flow. Both hang off serves_food — neither is reachable
-- without it.
IF COL_LENGTH('dbo.lodges', 'food_room_service') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD food_room_service BIT NOT NULL CONSTRAINT df_lodges_food_room_service DEFAULT 0');
GO

IF COL_LENGTH('dbo.lodges', 'food_table_service') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD food_table_service BIT NOT NULL CONSTRAINT df_lodges_food_table_service DEFAULT 0');
GO

-- The late-checkout policy. lodges.checkin_mode has been recorded since
-- registration but never computed with; these columns are what finally make it
-- load-bearing. A NIGHT_BASED property checks out at check_out_time on the
-- departure date, and a HOUR_24 one checks out 24 hours per night after the
-- guest actually walked in. Once there is a deadline there can be a charge for
-- missing it.
IF COL_LENGTH('dbo.lodges', 'check_out_time') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD check_out_time TIME(0) NOT NULL CONSTRAINT df_lodges_check_out_time DEFAULT ''11:00:00''');
GO

IF COL_LENGTH('dbo.lodges', 'late_grace_minutes') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD late_grace_minutes INT NOT NULL CONSTRAINT df_lodges_late_grace DEFAULT 60');
GO

IF COL_LENGTH('dbo.lodges', 'late_half_day_percent') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD late_half_day_percent DECIMAL(5,2) NOT NULL CONSTRAINT df_lodges_late_half DEFAULT 50');
GO

IF COL_LENGTH('dbo.lodges', 'late_full_day_after_minutes') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD late_full_day_after_minutes INT NOT NULL CONSTRAINT df_lodges_late_full_after DEFAULT 360');
GO

IF COL_LENGTH('dbo.lodges', 'late_full_day_percent') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD late_full_day_percent DECIMAL(5,2) NOT NULL CONSTRAINT df_lodges_late_full DEFAULT 100');
GO
