-- Dormitory AC / Non-AC, in place of a free extras checklist
--
-- 065 let a dormitory link into the general switchable_charges catalog as an
-- "included, not charged" list — but that catalog is built for a lodge's
-- whole menu of extras (late checkout, extra bed, ...), and all a dormitory
-- actually needed to say was whether it has AC. dormitory_is_ac replaces
-- that checklist with the one binary fact it was standing in for: a plain
-- tag, the same shape dormitory_gender already is — descriptive, not a
-- separate charge, already priced into dormitory_price.
--
-- room_switchable_charges rows a dormitory picked up under 065 are cleared
-- below rather than left dangling: nothing reads them for a dormitory room
-- once this ships, and a stale link would just be confusing to find later.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- NULL on every non-dormitory room, same as dormitory_gender — the question
-- doesn't apply there. Required in practice for a dormitory room by the
-- application layer once chosen, not by a NOT NULL here: a room mid-setup
-- (dormitory ticked, AC not chosen yet) still has to be able to save.
--
-- A string enum rather than a BIT: the app layer validates this against
-- z.coerce.boolean(), and that coercion reads the string 'false' as true —
-- any non-empty string is truthy in JS — which would have silently turned
-- every "Non-AC" pick into "AC" the first time a form posted it as text.
-- 'AC' / 'NON_AC' has no such trap.
IF COL_LENGTH('dbo.rooms', 'dormitory_is_ac') IS NULL
BEGIN
    EXEC('ALTER TABLE dbo.rooms ADD dormitory_is_ac NVARCHAR(10) NULL');
    EXEC('ALTER TABLE dbo.rooms ADD CONSTRAINT ck_rooms_dormitory_is_ac
          CHECK (dormitory_is_ac IS NULL OR dormitory_is_ac IN (''AC'', ''NON_AC''))');
END
GO

DELETE rsc
FROM dbo.room_switchable_charges rsc
JOIN dbo.rooms r ON r.id = rsc.room_id
WHERE r.is_dormitory = 1;
GO
