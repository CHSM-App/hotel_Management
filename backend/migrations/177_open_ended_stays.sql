-- Open-ended stays (177). A booking may be made without a check-out date: the
-- guest is in the room until they are checked out, and the room stays blocked
-- (every overlap test reads a NULL check-out as "far in the future"). Checking
-- the guest out writes the real departure date and prices the nights used, so a
-- closed stay is never NULL again. The two CHECK (check_out_date > check_in_date)
-- constraints already pass a NULL.
-- Remember: the same change must also land in src/config/schema.sql.
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.bookings') AND name = 'check_out_date' AND is_nullable = 0)
    ALTER TABLE dbo.bookings ALTER COLUMN check_out_date DATE NULL;
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.booking_rooms') AND name = 'check_out_date' AND is_nullable = 0)
    ALTER TABLE dbo.booking_rooms ALTER COLUMN check_out_date DATE NULL;
GO
