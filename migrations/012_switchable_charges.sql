-- switchable_charges
--
-- One table per migration, in foreign-key dependency order: this file is
-- 9 of 32 that together build the database from nothing. The number is
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

-- A switchable charge is a variable per-night charge (AC, extra bed). Unlike a
-- feature, which is constant and always priced in, a room only has the
-- *capability* here; whether it applies on a given night is a booking-time
-- decision.
--
-- is_counter: whether the extra is taken in counts or is simply on or off. An
-- extra bed is counted; AC is not. It tells the booking form which extras need
-- a count box, and is not something an owner configures.
IF OBJECT_ID('dbo.switchable_charges', 'U') IS NULL
CREATE TABLE dbo.switchable_charges (
    id                BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id          BIGINT NOT NULL REFERENCES dbo.lodges(id),
    name              NVARCHAR(100) NOT NULL,
    charge_per_night  DECIMAL(10,2) NOT NULL,
    is_counter        BIT NOT NULL CONSTRAINT df_switchable_charges_is_counter DEFAULT 0,
    is_active         BIT NOT NULL DEFAULT 1,
    created_at        DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_switchable_charges_lodge_name UNIQUE (lodge_id, name)
);
GO

-- Every lodge that lets rooms gets an Extra bed extra, because every one of them
-- has an extra bed to sell. Seeded at rate 0 for the owner to set: a made-up
-- price here would be billed to real guests at a number nobody chose.
INSERT INTO dbo.switchable_charges (lodge_id, name, charge_per_night, is_counter)
SELECT l.id, 'Extra bed', 0, 1
FROM dbo.lodges l
WHERE l.has_rooms = 1
  AND NOT EXISTS (
      SELECT 1 FROM dbo.switchable_charges sc
      WHERE sc.lodge_id = l.id AND sc.name = 'Extra bed'
  );
GO
