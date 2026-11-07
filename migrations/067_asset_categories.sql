-- asset_categories
--
-- New table for the Assets & Maintenance module. Guarded, so applying this to
-- a database that already has the table is a no-op.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- A real table rather than a fixed enum, same reasoning as room_categories:
-- an owner adds hotel-specific categories without a migration.
IF OBJECT_ID('dbo.asset_categories', 'U') IS NULL
CREATE TABLE dbo.asset_categories (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id    BIGINT NOT NULL REFERENCES dbo.lodges(id),
    name        NVARCHAR(60) NOT NULL,
    is_active   BIT NOT NULL DEFAULT 1,
    created_at  DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_asset_categories_lodge_name UNIQUE (lodge_id, name)
);
GO
