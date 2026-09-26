-- food_pin_lockouts
--
-- One table per migration, in foreign-key dependency order: this file is
-- 30 of 32 that together build the database from nothing. The number is
-- the order, so these must be applied in sequence — which the engine does.
--
-- Split out of the single baseline that preceded it; the SQL is unchanged and
-- was verified against SQL Server by building it into a scratch schema and
-- comparing the result to src/config/schema.sql.
--
-- Guarded, so applying this to a database that already has the table is a
-- no-op rather than an error.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- ---------------------------------------------------------------------------
-- Brute-force defence
-- ---------------------------------------------------------------------------

-- In-room ordering is a single link for the whole property, so the room is no
-- longer proved by where the guest is standing — the PIN is the only thing
-- between a stranger and a charge on someone else's folio. A 4-digit PIN is
-- 10,000 values, trivial to sweep without a lockout; with this table it takes
-- ~20 days of sustained attack on one room.
--
-- Keyed on the room number *as typed*, not on rooms.id, and deliberately so: a
-- room number that doesn't exist has to accumulate failures and lock exactly
-- like a real one. Keying on an id would mean fake rooms can't be recorded, so a
-- 429 (real room) would read differently from a 401 (unknown room) and hand an
-- attacker a room-enumeration oracle — the very thing the uniform failure
-- response in public.service.js exists to close.
IF OBJECT_ID('dbo.food_pin_lockouts', 'U') IS NULL
CREATE TABLE dbo.food_pin_lockouts (
    lodge_id         BIGINT NOT NULL REFERENCES dbo.lodges(id),
    room_label       NVARCHAR(20) NOT NULL,
    failed_count     INT NOT NULL DEFAULT 0,
    first_failed_at  DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    last_failed_at   DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    locked_until     DATETIMEOFFSET NULL,
    CONSTRAINT pk_food_pin_lockouts PRIMARY KEY (lodge_id, room_label)
);
GO
