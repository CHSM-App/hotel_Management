-- room_switchable_charges
--
-- One table per migration, in foreign-key dependency order: this file is
-- 10 of 32 that together build the database from nothing. The number is
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

-- Which rooms are capable of which charge (only a room with an AC unit can ever
-- have the AC charge switched on).
IF OBJECT_ID('dbo.room_switchable_charges', 'U') IS NULL
CREATE TABLE dbo.room_switchable_charges (
    room_id    BIGINT NOT NULL REFERENCES dbo.rooms(id),
    charge_id  BIGINT NOT NULL REFERENCES dbo.switchable_charges(id),
    CONSTRAINT pk_room_switchable_charges PRIMARY KEY (room_id, charge_id)
);
GO
