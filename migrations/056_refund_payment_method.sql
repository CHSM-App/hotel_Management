-- refund_payment_method
--
-- How a cancellation's refund went back to the guest.
--
-- This file is both halves at once: a guarded ADD, so it builds alongside
-- 004-055, and carries an existing database forward.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- ---------------------------------------------------------------------------
-- bookings.refund_payment_method
-- ---------------------------------------------------------------------------

-- 055 recorded how much of the advance went back; this records how. The same
-- three tenders the advance itself uses, and nullable for the same reasons:
-- a cancellation with nothing to refund has no tender, and settlements made
-- before this column existed recorded none. NULL alongside a refund means
-- "not recorded", not "cash".
IF COL_LENGTH('dbo.bookings', 'refund_payment_method') IS NULL
    ALTER TABLE dbo.bookings
        ADD refund_payment_method NVARCHAR(20) NULL
            CONSTRAINT ck_bookings_refund_method
            CHECK (refund_payment_method IN ('CASH', 'UPI', 'CARD'));
