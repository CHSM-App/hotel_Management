-- invoices_food_bill_uniqueness
--
-- Let a property issue more than one food bill.
--
-- This file is both halves at once: a guarded rebuild, so it builds alongside
-- 004-045, and carries an existing database forward.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- ---------------------------------------------------------------------------
-- uq_invoices_booking_active
-- ---------------------------------------------------------------------------

-- The index means "one active invoice per booking", and for stays it does
-- exactly that. But a food bill has no booking, so it inserts booking_id NULL —
-- and SQL Server treats every NULL in a unique index as the SAME value. So the
-- index also silently meant "one food bill per property, ever": the first
-- table, room or counter bill went through, and every one after it failed with
--
--   Cannot insert duplicate key row ... The duplicate key value is (<NULL>).
--
-- which reached the counter as a 500 and no bill.
--
-- Adding `booking_id IS NOT NULL` to the filter keeps the rule the index was
-- written for — a booking still gets one active invoice — and takes food bills
-- out of its scope, where they never belonged.
--
-- Rebuilt rather than altered: a filtered index's WHERE clause cannot be
-- changed in place. Dropping it briefly is safe, because the filter is only
-- being narrowed — every pair of rows the new index rejects, the old one
-- rejected too, so no existing row can violate it.
IF EXISTS (SELECT 1 FROM sys.indexes
           WHERE name = 'uq_invoices_booking_active'
             AND object_id = OBJECT_ID('dbo.invoices')
             AND filter_definition <> '([status]=''ISSUED'' AND [booking_id] IS NOT NULL)')
BEGIN
    DROP INDEX uq_invoices_booking_active ON dbo.invoices;

    CREATE UNIQUE INDEX uq_invoices_booking_active ON dbo.invoices(booking_id)
        WHERE status = 'ISSUED' AND booking_id IS NOT NULL;
END
