-- lodges.can_add_past_bookings: set by internal staff (super admin) to let a
-- property record a stay it missed, after the fact, already checked out and
-- billed. Off by default; see createPastBooking in bookings.service.js.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.lodges', 'can_add_past_bookings') IS NULL
ALTER TABLE dbo.lodges ADD can_add_past_bookings BIT NOT NULL CONSTRAINT df_lodges_can_add_past_bookings DEFAULT 0;
GO
