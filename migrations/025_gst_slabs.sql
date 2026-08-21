-- gst_slabs
--
-- One table per migration, in foreign-key dependency order: this file is
-- 22 of 32 that together build the database from nothing. The number is
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
-- Tax and billing
-- ---------------------------------------------------------------------------

-- GST slabs, covering two supplies. Accommodation (SAC 996311) is banded by
-- nightly rate: the first row ascending by max_amount (NULL last) whose
-- max_amount the rate falls at-or-under. Food (SAC 996331) is a flat rate
-- decided by whether the property is "specified premises" — 18% with ITC if it
-- is, 5% without if it isn't — so a FOOD row is selected by that flag rather
-- than by amount. A rate change is a row update, not a deploy.
--
-- applies_to_specified: 1 = only when the lodge is specified premises,
-- 0 = only when it isn't, NULL = regardless (how every ACCOMMODATION row sits).
IF OBJECT_ID('dbo.gst_slabs', 'U') IS NULL
CREATE TABLE dbo.gst_slabs (
    id                    BIGINT IDENTITY(1,1) PRIMARY KEY,
    max_amount            DECIMAL(10,2) NULL,
    rate_percent          DECIMAL(5,2) NOT NULL,
    supply_type           NVARCHAR(20) NOT NULL CONSTRAINT df_gst_slabs_supply DEFAULT 'ACCOMMODATION'
        CONSTRAINT ck_gst_slabs_supply CHECK (supply_type IN ('ACCOMMODATION', 'FOOD')),
    applies_to_specified  BIT NULL,
    sac_code              NVARCHAR(10) NULL,
    is_active             BIT NOT NULL DEFAULT 1,
    created_at            DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

-- An empty slab table silently taxes every bill at 0% rather than failing
-- loudly, so both sets are seeded if missing.
IF NOT EXISTS (SELECT 1 FROM dbo.gst_slabs WHERE supply_type = 'ACCOMMODATION')
INSERT INTO dbo.gst_slabs (supply_type, max_amount, rate_percent, applies_to_specified, sac_code) VALUES
    ('ACCOMMODATION', 1000, 0,  NULL, '996311'),
    ('ACCOMMODATION', 7500, 5,  NULL, '996311'),
    ('ACCOMMODATION', NULL, 18, NULL, '996311');

-- max_amount is NULL on both food rows: the rate does not depend on the value of
-- the meal, only on the premises.
IF NOT EXISTS (SELECT 1 FROM dbo.gst_slabs WHERE supply_type = 'FOOD')
INSERT INTO dbo.gst_slabs (supply_type, max_amount, rate_percent, applies_to_specified, sac_code) VALUES
    ('FOOD', NULL, 5,  0, '996331'),
    ('FOOD', NULL, 18, 1, '996331');
GO
