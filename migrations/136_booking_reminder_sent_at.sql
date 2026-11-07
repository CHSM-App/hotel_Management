-- bookings.reminder_sent_at
--
-- When the "your stay is coming up" WhatsApp reminder went out for this
-- booking — NULL means "not sent yet". Set once, the first (and only) time
-- the daily sweep (sendDueStayReminders in stayReminders.service.js) fires
-- for this booking, so a guest is never sent the same reminder twice even
-- if the job runs more than once on the same day.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.bookings', 'reminder_sent_at') IS NULL
    EXEC('ALTER TABLE dbo.bookings ADD reminder_sent_at DATETIMEOFFSET NULL');
GO
