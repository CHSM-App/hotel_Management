-- Photos of a venue.
--
-- A hall is sold on how it looks set up, and the desk wants to show a family
-- the lawn without walking them out to it. Up to six photos per venue, the
-- same as a room, kept the way room_images are: one row per file, the file
-- itself under backend/uploads/venue-images, sort_order for the gallery
-- order. The row is the source of truth — a file with no row is an orphan,
-- and a row whose file is gone is shown as "no photo", not as broken.
--
-- Remember: the same change must also land in src/config/schema.sql.
IF OBJECT_ID('dbo.event_venue_images', 'U') IS NULL
CREATE TABLE dbo.event_venue_images (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    venue_id    BIGINT NOT NULL REFERENCES dbo.event_venues(id),
    filename    NVARCHAR(255) NOT NULL,
    sort_order  INT NOT NULL CONSTRAINT df_event_venue_images_sort DEFAULT 0,
    created_at  DATETIMEOFFSET NOT NULL CONSTRAINT df_event_venue_images_created DEFAULT SYSDATETIMEOFFSET()
);
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'ix_event_venue_images_venue' AND object_id = OBJECT_ID('dbo.event_venue_images')
)
    CREATE INDEX ix_event_venue_images_venue ON dbo.event_venue_images(venue_id);
GO
