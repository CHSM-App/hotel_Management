-- Adding customers.manage to the PERMISSIONS catalog (migration 130) doesn't
-- retroactively grant it to anyone — a role's actual permissions are the JSON
-- array stored on its dbo.roles row, and that array was written before this
-- permission existed. Without this, the new Customer list section exists in
-- the sidebar's FEATURES list but no login can actually see it, because
-- hasPermission comes up empty for every role on file.
--
-- Granted to whichever role already holds guests.view — same reasoning
-- migration 119 used to hand laundry.manage to every role that already held
-- housekeeping.manage: the two are the closest sibling pair (one is the
-- stay-by-stay register, the other the person-by-person master it was built
-- from), so a login already trusted to browse the register is trusted to see
-- the list it feeds. This covers OWNER and RECEPTION's shared defaults, and
-- also any lodge that already saved its own customized RECEPTION permissions
-- (the shared-default UPDATE in migration 130/131 never touches those rows).
--
-- Remember: the same change must also land in src/config/schema.sql.

UPDATE dbo.roles
SET permissions = REPLACE(permissions, '"guests.view"', '"guests.view","customers.manage"')
WHERE permissions LIKE '%"guests.view"%' AND permissions NOT LIKE '%"customers.manage"%';
GO
