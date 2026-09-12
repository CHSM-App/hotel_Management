-- Several beds in one room.
--
-- dbo.rooms.bed_size holds a single enum, so a family room with a double and
-- two singles could only be recorded as whichever one the desk picked. This
-- adds the full list as JSON: [{"size":"DOUBLE","count":1},{"size":"SINGLE","count":2}]
--
-- JSON rather than a dbo.room_beds table because nothing queries a bed. It is
-- descriptive text shown on the room card and the public page — the same reason
-- bookings.nightly_breakdown is stored this way, and the same ISJSON guard.
--
-- bed_size STAYS, and stays populated with the first bed's size. Four readers
-- depend on it (the public room-type page, the booking room chip, the price
-- simulator, the room card), and leaving it correct means none of them had to
-- change. It is derived on write from beds[0] and never edited on its own.

IF COL_LENGTH('dbo.rooms', 'beds') IS NULL
    EXEC('ALTER TABLE dbo.rooms ADD beds NVARCHAR(MAX) NULL');
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_rooms_beds_json')
    EXEC('ALTER TABLE dbo.rooms ADD CONSTRAINT ck_rooms_beds_json
          CHECK (beds IS NULL OR ISJSON(beds) = 1)');
GO

-- Existing rooms get their single bed as a one-entry list, so every room reads
-- through the same shape and the app needs no "old row" branch.
UPDATE dbo.rooms
SET beds = '[{"size":"' + bed_size + '","count":1}]'
WHERE beds IS NULL AND bed_size IS NOT NULL;
GO
