-- seasons
--
-- One table per migration, in foreign-key dependency order: this file is
-- 11 of 32 that together build the database from nothing. The number is
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

-- A season is a calendar date range with a percentage adjustment applied on top
-- of a room's price for stays falling inside it.
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
GO
