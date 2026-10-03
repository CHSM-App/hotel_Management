-- Dormitory room price and gender
--
-- Two corrections to how a dormitory room prices and is grouped, on top of
-- what 064 built:
--
-- Price moves from the bed to the room. 064 put price_override on
-- dbo.dormitory_beds — "a window bunk costs more than an aisle one" — but the
-- property actually wants one rate for the whole room, same as every other
-- room type: a category sets a base price, a room can override it, a bed
-- never had a price of its own. dormitory_price is that override, living on
-- dbo.rooms next to is_dormitory rather than on the bed rows, and
-- price_override on dormitory_beds is retired — nothing writes it from here
-- on, and every read this migration touches stops looking at it.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- The one nightly rate every bed in this room actually charges. NULL falls
-- back to the category's own base_price — same rule the room's beds used to
-- follow individually, just one level up now.
IF COL_LENGTH('dbo.rooms', 'dormitory_price') IS NULL
    EXEC('ALTER TABLE dbo.rooms ADD dormitory_price DECIMAL(10,2) NULL
          CONSTRAINT ck_rooms_dormitory_price CHECK (dormitory_price IS NULL OR dormitory_price > 0)');
GO

-- Which guests this dormitory room is for. NULL on every non-dormitory
-- room — the question doesn't apply there — and required in practice for a
-- dormitory room by the application layer, not by a NOT NULL here: a room
-- mid-setup (dormitory ticked, gender not chosen yet) still has to save.
IF COL_LENGTH('dbo.rooms', 'dormitory_gender') IS NULL
BEGIN
    EXEC('ALTER TABLE dbo.rooms ADD dormitory_gender NVARCHAR(10) NULL');
    EXEC('ALTER TABLE dbo.rooms ADD CONSTRAINT ck_rooms_dormitory_gender
          CHECK (dormitory_gender IS NULL OR dormitory_gender IN (''MALE'', ''FEMALE'', ''BOTH''))');
END
GO

-- Retired: no code past this migration reads or writes a bed's own price —
-- see pricing.service.js and rooms.service.js. Dropped rather than left
-- inert, so a bed can't quietly carry a stale price nothing prices against
-- and no future reader mistakes for live data. The CHECK constraint 064 put
-- on this column has to go first, or the column drop fails.
IF COL_LENGTH('dbo.dormitory_beds', 'price_override') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_dormitory_beds_price')
        EXEC('ALTER TABLE dbo.dormitory_beds DROP CONSTRAINT ck_dormitory_beds_price');
    EXEC('ALTER TABLE dbo.dormitory_beds DROP COLUMN price_override');
END
GO
