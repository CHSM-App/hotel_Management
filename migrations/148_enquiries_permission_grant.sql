-- enquiries.manage is a new entry in the PERMISSIONS catalog; like
-- customers.manage (migration 132) it does not reach any role's stored
-- permissions array by itself. Granted to whichever role already holds
-- bookings.manage — the people who would act on an enquiry (call the guest,
-- turn it into a booking) are the ones already taking bookings.
--
-- Remember: the same change must also land in src/config/schema.sql.

UPDATE dbo.roles
SET permissions = REPLACE(permissions, '"bookings.manage"', '"bookings.manage","enquiries.manage"')
WHERE permissions LIKE '%"bookings.manage"%' AND permissions NOT LIKE '%"enquiries.manage"%';
GO
