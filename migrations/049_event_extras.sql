-- Extras noted on the day of a function.
--
-- The hall is booked, the evening is on, and the organiser asks for fifty
-- more chairs. The desk writes it down on the function's page so it reaches
-- the bill rather than a scrap of paper. These are ordinary add-on lines with
-- three more columns: is_extra says the line was added on the day rather than
-- quoted; needs_pricing says a price was not agreed when it was written down,
-- and is what the bill refuses to issue over until it is; noted_at is when.
--
-- Remember: the same change must also land in src/config/schema.sql.
IF COL_LENGTH('dbo.event_booking_addons', 'is_extra') IS NULL
    EXEC('ALTER TABLE dbo.event_booking_addons ADD is_extra BIT NOT NULL CONSTRAINT df_event_booking_addons_extra DEFAULT 0');
GO

IF COL_LENGTH('dbo.event_booking_addons', 'needs_pricing') IS NULL
    EXEC('ALTER TABLE dbo.event_booking_addons ADD needs_pricing BIT NOT NULL CONSTRAINT df_event_booking_addons_unpriced DEFAULT 0');
GO

IF COL_LENGTH('dbo.event_booking_addons', 'noted_at') IS NULL
    EXEC('ALTER TABLE dbo.event_booking_addons ADD noted_at DATETIMEOFFSET NULL');
GO
