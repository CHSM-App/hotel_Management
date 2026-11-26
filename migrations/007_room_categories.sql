-- room_categories
--
-- One table per migration, in foreign-key dependency order: this file is
-- 4 of 32 that together build the database from nothing. The number is
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
-- Rooms and pricing inputs
-- ---------------------------------------------------------------------------

-- A category is the room "shape" (Standard, Deluxe). base_price is the price of
-- the cheapest version of that room; the price chart adds feature amounts on
-- top to compute each room's price live.
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
GO
