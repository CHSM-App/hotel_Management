-- raw_materials
--
-- One table per migration, in foreign-key dependency order: this file is
-- 27 of 32 that together build the database from nothing. The number is
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
-- Kitchen raw material inventory
-- ---------------------------------------------------------------------------
-- What the kitchen buys, what each dish eats, and a ledger tying the two
-- together. Stock falls when a cook ticks a dish off as it leaves the pan — see
-- applyOrderItemStock in inventory.service.js.
--
-- No unit conversion anywhere in this feature. A material is stocked, counted and
-- cooked in exactly one unit, chosen when it is created: a kitchen that wants to
-- think in grams stocks grams. Conversion would mean a factor table, a rounding
-- rule per material and a whole class of "why is my rice 0.4kg out" questions,
-- to save the owner picking G instead of KG once.

IF OBJECT_ID('dbo.raw_materials', 'U') IS NULL
CREATE TABLE dbo.raw_materials (
    id                   BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id             BIGINT NOT NULL REFERENCES dbo.lodges(id),
    name                 NVARCHAR(120) NOT NULL,
    unit                 NVARCHAR(4) NOT NULL
        CONSTRAINT ck_raw_materials_unit CHECK (unit IN ('KG', 'G', 'L', 'ML', 'PCS')),
    -- What the thing *is*, so a store cupboard of seventy-odd lines reads as
    -- half a dozen short lists instead of one long one. A fixed set rather than
    -- a per-lodge table: it is a shelf label, not a business decision, and every
    -- kitchen sorts its store room roughly this way. OTHER is the fallback.
    category             NVARCHAR(12) NOT NULL CONSTRAINT df_raw_materials_category DEFAULT 'OTHER'
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
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_raw_materials_lodge' AND object_id = OBJECT_ID('dbo.raw_materials'))
    CREATE INDEX ix_raw_materials_lodge ON dbo.raw_materials(lodge_id, is_active);
GO
