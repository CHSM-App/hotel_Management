-- Rooms wanted alongside a function.
--
-- A wedding party needs somewhere to sleep, and the desk hears that on the
-- same call as the hall. This records the need — how many, which nights, any
-- note — so it is not lost between the enquiry and the tape chart. It does
-- not book anything: a stay is priced by the night and taxed as
-- accommodation, and it keeps its own booking row, made from the tape chart
-- the usual way. A later change can link those bookings back here.
--
-- Catering needs no column of its own: a function without food simply has
-- per_plate_rate = 0, which is what the pricing already treats as "no
-- catering line".
--
-- Remember: the same change must also land in src/config/schema.sql.
IF COL_LENGTH('dbo.event_bookings', 'rooms_required') IS NULL
    EXEC('ALTER TABLE dbo.event_bookings ADD rooms_required BIT NOT NULL CONSTRAINT df_event_bookings_rooms_required DEFAULT 0');
GO

IF COL_LENGTH('dbo.event_bookings', 'rooms_count') IS NULL
    EXEC('ALTER TABLE dbo.event_bookings ADD rooms_count INT NULL');
GO

-- Nights, as a stay is: rooms_to is the morning they leave, exclusive.
IF COL_LENGTH('dbo.event_bookings', 'rooms_from') IS NULL
    EXEC('ALTER TABLE dbo.event_bookings ADD rooms_from DATE NULL');
GO

IF COL_LENGTH('dbo.event_bookings', 'rooms_to') IS NULL
    EXEC('ALTER TABLE dbo.event_bookings ADD rooms_to DATE NULL');
GO

IF COL_LENGTH('dbo.event_bookings', 'rooms_notes') IS NULL
    EXEC('ALTER TABLE dbo.event_bookings ADD rooms_notes NVARCHAR(500) NULL');
GO
