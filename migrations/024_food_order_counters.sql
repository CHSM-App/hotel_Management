-- food_order_counters
--
-- One table per migration, in foreign-key dependency order: this file is
-- 21 of 32 that together build the database from nothing. The number is
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

-- Order numbers restart at 1 each day and are read aloud across a kitchen
-- ("order 14 is ready"), so they have to be short and per-day, not a global
-- identity. Allocated with an atomic MERGE in orders.service.js — never
-- SELECT MAX()+1, the same rule invoice_series follows.
IF OBJECT_ID('dbo.food_order_counters', 'U') IS NULL
CREATE TABLE dbo.food_order_counters (
    lodge_id     BIGINT NOT NULL REFERENCES dbo.lodges(id),
    order_date   DATE NOT NULL,
    next_number  INT NOT NULL DEFAULT 1,
    CONSTRAINT pk_food_order_counters PRIMARY KEY (lodge_id, order_date)
);
GO
