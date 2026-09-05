-- room_images
--
-- One table per migration, in foreign-key dependency order: this file is
-- 8 of 32 that together build the database from nothing. The number is
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

-- Room photos — a small ordered gallery per room. Filenames point into
-- uploads/room-images, served from a public static mount: unlike a guest ID
-- proof, a room photo isn't sensitive.
IF OBJECT_ID('dbo.room_images', 'U') IS NULL
CREATE TABLE dbo.room_images (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    room_id     BIGINT NOT NULL REFERENCES dbo.rooms(id),
    filename    NVARCHAR(255) NOT NULL,
    sort_order  INT NOT NULL DEFAULT 0,
    created_at  DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_room_images_room' AND object_id = OBJECT_ID('dbo.room_images'))
    CREATE INDEX ix_room_images_room ON dbo.room_images(room_id);
GO
