-- cancellation_charge_collected
--
-- How a cancellation charge was collected when there was no advance to keep
-- it from.
--
-- This file is both halves at once: a guarded ADD, so it builds alongside
-- 004-056, and carries an existing database forward.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- ---------------------------------------------------------------------------
-- bookings.cancellation_charge_payment_method
-- ---------------------------------------------------------------------------

-- A charge kept from an advance has no tender of its own — the money arrived
-- when the advance did. A charge on a stay that held no advance is different:
-- it is money collected at the desk at the moment of cancelling, and this is
-- how it arrived. NULL on kept-from-advance charges and on cancellations that
-- collected nothing.
IF COL_LENGTH('dbo.bookings', 'cancellation_charge_payment_method') IS NULL
    ALTER TABLE dbo.bookings
        ADD cancellation_charge_payment_method NVARCHAR(20) NULL
            CONSTRAINT ck_bookings_charge_method
            CHECK (cancellation_charge_payment_method IN ('CASH', 'UPI', 'CARD'));
