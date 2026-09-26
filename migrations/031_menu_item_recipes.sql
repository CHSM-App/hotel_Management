-- menu_item_recipes
--
-- One table per migration, in foreign-key dependency order: this file is
-- 28 of 32 that together build the database from nothing. The number is
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

-- One ingredient line of one dish: "a full plate of Masala Dosa eats 180 g of
-- rice". quantity is per single serving, in the material's own unit, multiplied
-- by the order line's quantity at cook time.
--
-- portion_id NULL means the line applies to the dish whatever size was ordered.
-- A dish may be described either way: per size where a half plate genuinely eats
-- less, or once at dish level where it doesn't. Resolution is "per-size rows if
-- this size has any, otherwise the dish-level rows" — there is no flag saying
-- which mode a dish is in, for the same reason portions themselves have none.
-- Having the rows *is* the mode.
--
-- SQL Server treats NULLs as equal for uniqueness, which is what is wanted here:
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
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_menu_item_recipes_item' AND object_id = OBJECT_ID('dbo.menu_item_recipes'))
    CREATE INDEX ix_menu_item_recipes_item ON dbo.menu_item_recipes(item_id, portion_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_menu_item_recipes_material' AND object_id = OBJECT_ID('dbo.menu_item_recipes'))
    CREATE INDEX ix_menu_item_recipes_material ON dbo.menu_item_recipes(material_id);
GO
