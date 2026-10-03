-- event_bookings.refund_payment_method
--
-- How a cancelled function's refund went back to the organiser — the same
-- gap 056 closed for room bookings, still open here. NULL alongside a
-- refund means "not recorded", not "cash"; a cancellation with nothing to
-- refund has no tender either.
--
-- This file is both halves at once: a guarded ADD, so it builds alongside
-- 004-090, and carries an existing database forward.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.event_bookings', 'refund_payment_method') IS NULL
    ALTER TABLE dbo.event_bookings
        ADD refund_payment_method NVARCHAR(20) NULL
            CONSTRAINT ck_event_bookings_refund_method
            CHECK (refund_payment_method IN ('CASH', 'UPI', 'CARD'));
