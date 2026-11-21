-- cancellation_settlement
--
-- What happened to the money when a booking or a function was cancelled.
--
-- This file is both halves at once: guarded ADDs, so it builds alongside
-- 004-054, and carries an existing database forward.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- ---------------------------------------------------------------------------
-- bookings: the settlement a cancellation now records
-- ---------------------------------------------------------------------------

-- A cancelled stay used to be a status flip and nothing more. If an advance
-- had been taken, whether it went back to the guest or stayed in the drawer
-- was recorded nowhere — which is why the reports had to leave every
-- cancelled advance out of the takings. These three figures close that gap:
-- what the desk gave back, what it kept as the cancellation charge, and why
-- the stay was cancelled at all. refund + charge always equals the advance
-- held at the moment of cancellation; both stay NULL on a cancellation made
-- before this existed, or by a client that never asked the question — NULL
-- means "not settled", not "kept nothing".
IF COL_LENGTH('dbo.bookings', 'cancel_reason') IS NULL
    ALTER TABLE dbo.bookings ADD cancel_reason NVARCHAR(200) NULL;
IF COL_LENGTH('dbo.bookings', 'refund_amount') IS NULL
    ALTER TABLE dbo.bookings ADD refund_amount DECIMAL(10,2) NULL;
IF COL_LENGTH('dbo.bookings', 'cancellation_charge') IS NULL
    ALTER TABLE dbo.bookings ADD cancellation_charge DECIMAL(10,2) NULL;
-- When the cancellation happened. The charge kept is income of this day, not
-- of the day the stay was booked for — the cash-basis report dates it here.
IF COL_LENGTH('dbo.bookings', 'cancelled_at') IS NULL
    ALTER TABLE dbo.bookings ADD cancelled_at DATETIMEOFFSET NULL;

-- ---------------------------------------------------------------------------
-- event_bookings: the half a function's cancellation already had, completed
-- ---------------------------------------------------------------------------

-- Functions have carried cancel_reason and refund_amount since 046. What they
-- never named was the other side of the same settlement: the slice of the
-- advance the house kept. Same NULL semantics as on bookings.
IF COL_LENGTH('dbo.event_bookings', 'cancellation_charge') IS NULL
    ALTER TABLE dbo.event_bookings ADD cancellation_charge DECIMAL(10,2) NULL;
IF COL_LENGTH('dbo.event_bookings', 'cancelled_at') IS NULL
    ALTER TABLE dbo.event_bookings ADD cancelled_at DATETIMEOFFSET NULL;
