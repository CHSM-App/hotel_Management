-- advance_receipt_round_off
--
-- The rounding adjustment a receipt's stay total carries.
--
-- This file is both halves at once: a guarded ADD, so it builds alongside
-- 004-051, and carries an existing database forward.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- ---------------------------------------------------------------------------
-- advance_receipts.round_off
-- ---------------------------------------------------------------------------

-- A stay is billed to the whole rupee — buildBreakdown rounds the invoice total
-- and prints the adjustment as its own line, which is what a guest checking the
-- arithmetic expects to find. The advance receipt stated the stay total too,
-- but took it straight off bookings.total_price, unrounded. So the receipt named
-- one figure, the invoice for the same stay named another, and nothing on either
-- sheet explained the gap.
--
-- Stored rather than re-derived at print time, for the same reason stay_total is
-- frozen: a receipt is paper in a guest's hand, and re-pricing a booking later
-- must not restate a document already issued.
--
-- Existing rows default to 0, which is truthful for them: they were written
-- against an unrounded total, and that is the total they stated.
IF COL_LENGTH('dbo.advance_receipts', 'round_off') IS NULL
    ALTER TABLE dbo.advance_receipts
        ADD round_off DECIMAL(10,2) NOT NULL
            CONSTRAINT df_advance_receipts_round_off DEFAULT 0;
