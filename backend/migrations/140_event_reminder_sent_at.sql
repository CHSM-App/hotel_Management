-- event_bookings.reminder_sent_at
--
-- When the "your event is coming up" WhatsApp reminder went out for this
-- function — NULL means "not sent yet". Set once, the first (and only) time
-- the daily sweep (sendDueEventReminders in eventReminders.service.js) fires
-- for this function, so an organiser is never sent the same reminder twice
-- even if the job runs more than once on the same day.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.event_bookings', 'reminder_sent_at') IS NULL
    EXEC('ALTER TABLE dbo.event_bookings ADD reminder_sent_at DATETIMEOFFSET NULL');
GO
