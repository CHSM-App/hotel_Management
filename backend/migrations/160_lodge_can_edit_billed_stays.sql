-- lodges.can_edit_billed_stays: set by internal staff (super admin) to let a
-- property correct the dates of a stay that is already checked out and billed.
-- Off by default; see updateBooking and getEditWindow in bookings.service.js.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.lodges', 'can_edit_billed_stays') IS NULL
ALTER TABLE dbo.lodges ADD can_edit_billed_stays BIT NOT NULL CONSTRAINT df_lodges_can_edit_billed_stays DEFAULT 0;
GO
