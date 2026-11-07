-- menu_item_portions
--
-- One table per migration, in foreign-key dependency order: this file is
-- 19 of 32 that together build the database from nothing. The number is
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

-- Half and full plates. This supersedes the v1 rule that they are two separate
-- rows — they were, and a lodge with 40 curries ended up with 80 dishes whose
-- names all ended in "(Half)". What survives of that rule is the part that
-- mattered: an order line is still one row carrying one price, resolved from one
-- database row, with no arithmetic between the menu and the kitchen ticket. Only
-- *which* row the price comes from has changed.
--
-- Sizes are typed onto the dish. There is deliberately no shared "Half / Full"
-- definition to pick from first: a kitchen offers a half plate of some curries
-- and not others, at prices unrelated to each other, so a shared list would only
-- have saved typing two short words while adding a step before every dish could
-- be priced. (An earlier cut did route through reusable "portion sets"; those
-- tables are dropped at the end of this file.)
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
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_menu_item_portions_item' AND object_id = OBJECT_ID('dbo.menu_item_portions'))
    CREATE INDEX ix_menu_item_portions_item ON dbo.menu_item_portions(item_id);
GO
