-- menu_items
--
-- One table per migration, in foreign-key dependency order: this file is
-- 18 of 32 that together build the database from nothing. The number is
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

-- is_available is the kitchen's "we're out of this today" toggle, deliberately
-- separate from is_active, which is the owner retiring an item. An item that
-- runs out at 8pm can't wait for the owner to log in.
--
-- food_type is two values, not three. Egg was a third type sitting between veg
-- and non-veg, and it is gone: the mark a guest reads is the one answering "can
-- I eat this", and for everyone the veg mark is for, an omelette is on the far
-- side of the line with the chicken.
--
-- image_filename — a photo of the dish under uploads/menu-images, referenced by
-- filename exactly as room photos are. A guest ordering from a phone buys with
-- their eyes, and a menu that is a wall of names sells the cheap familiar things
-- and nothing else. NULL is the norm: a kitchen photographs its signature
-- dishes, not all forty.
IF OBJECT_ID('dbo.menu_items', 'U') IS NULL
CREATE TABLE dbo.menu_items (
    id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id        BIGINT NOT NULL REFERENCES dbo.lodges(id),
    category_id     BIGINT NOT NULL REFERENCES dbo.menu_categories(id),
    name            NVARCHAR(150) NOT NULL,
    description     NVARCHAR(300) NULL,
    price           DECIMAL(10,2) NOT NULL
        CONSTRAINT ck_menu_items_price CHECK (price >= 0),
    food_type       NVARCHAR(10) NOT NULL DEFAULT 'VEG'
        CONSTRAINT ck_menu_items_food_type CHECK (food_type IN ('VEG', 'NON_VEG')),
    image_filename  NVARCHAR(255) NULL,
    is_available    BIT NOT NULL DEFAULT 1,
    sort_order      INT NOT NULL DEFAULT 0,
    is_active       BIT NOT NULL DEFAULT 1,
    created_at      DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_menu_items_category_name UNIQUE (category_id, name)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_menu_items_lodge' AND object_id = OBJECT_ID('dbo.menu_items'))
    CREATE INDEX ix_menu_items_lodge ON dbo.menu_items(lodge_id, category_id);
GO
