-- lodge_enquiries.converted_booking_id / converted_event_booking_id
--
-- The one link the enquiries table never had: which booking, if any, an
-- enquiry actually turned into. Previously "Converted" was a bare status flip
-- (enquiries.service.js's updateStatus) with nothing behind it — a desk could
-- mark an enquiry Converted without any booking existing at all.
--
-- Two nullable columns, not one, same shape as dbo.advance_receipts'
-- booking_id/event_booking_id pair: an enquiry converts into either a room
-- stay or a function, never both, and the two live in different tables
-- (dbo.bookings vs dbo.event_bookings) with no shared id space to point a
-- single FK at.
--
-- Set only when createBooking / createEventBooking is given an enquiryId
-- (the desk used Enquiries.jsx's "Confirm booking" action, which pre-fills
-- the new-booking form from the enquiry rather than starting it blank) — see
-- bookings.service.js and events.service.js. The same request that creates
-- the booking also marks the enquiry CONVERTED and records which booking it
-- was, inside that one transaction, so the two can never disagree. Most
-- conversions still happen by hand (an enquiry booked some other way, or
-- just marked Converted without this flow) and leave both columns NULL.
--
-- On dbo.lodge_enquiries rather than a reverse column on dbo.bookings /
-- dbo.event_bookings: an enquiry becomes at most one booking, but nothing
-- about a booking needs to know it came from an enquiry at query time, and
-- keeping the pointer on the smaller, 30-day-purged table is two fewer
-- columns on the tables every booking/event query already has to carry.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.lodge_enquiries', 'converted_booking_id') IS NULL
ALTER TABLE dbo.lodge_enquiries ADD converted_booking_id BIGINT NULL REFERENCES dbo.bookings(id);
GO

IF COL_LENGTH('dbo.lodge_enquiries', 'converted_event_booking_id') IS NULL
ALTER TABLE dbo.lodge_enquiries ADD converted_event_booking_id BIGINT NULL REFERENCES dbo.event_bookings(id);
GO
