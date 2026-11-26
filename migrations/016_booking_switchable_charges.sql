-- booking_switchable_charges
--
-- One table per migration, in foreign-key dependency order: this file is
-- 13 of 32 that together build the database from nothing. The number is
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

-- Which switchable charges were switched on for this stay, applied flat per
-- night across the whole stay.
--
-- quantity: charge_per_night is the price of ONE of the thing (one extra bed),
-- and this is how many the guest took. Three beds at Rs 100 is Rs 300 a night,
-- one row with quantity 3 — not three rows, which the primary key forbids.
IF OBJECT_ID('dbo.booking_switchable_charges', 'U') IS NULL
CREATE TABLE dbo.booking_switchable_charges (
    booking_id  BIGINT NOT NULL REFERENCES dbo.bookings(id),
    charge_id   BIGINT NOT NULL REFERENCES dbo.switchable_charges(id),
    quantity    INT NOT NULL CONSTRAINT df_booking_switchable_charges_quantity DEFAULT 1,
    CONSTRAINT pk_booking_switchable_charges PRIMARY KEY (booking_id, charge_id),
    CONSTRAINT ck_booking_switchable_charges_quantity CHECK (quantity >= 1)
);
GO
