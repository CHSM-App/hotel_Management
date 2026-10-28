-- A Housekeeping built-in role: room cleaning, linen and guest laundry, and
-- nothing else — no bills, payments or guest details. Same shape as the
-- CAPTAIN role (083). Owner and Reception need no change: the housekeeping
-- routes also accept bookings.manage and rooms.manage, which they already hold.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF NOT EXISTS (SELECT 1 FROM dbo.roles WHERE lodge_id IS NULL AND role_key = 'HOUSEKEEPING')
INSERT INTO dbo.roles (lodge_id, role_key, name, description, is_system, permissions) VALUES
    (NULL, 'HOUSEKEEPING', 'Housekeeping', 'Cleans rooms, tracks linen and takes guest laundry.', 1, '["housekeeping.manage"]');
GO
