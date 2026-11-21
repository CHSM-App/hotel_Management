-- Per-room share of a booking's concession
--
-- A concession is agreed once for the whole booking, then split across its
-- rooms in proportion to what each cost (see apportionDiscount). total_price on
-- booking_rooms is already net of this share; keeping the share itself lets an
-- edit after one room has checked out re-price only the rooms still open
-- without disturbing the ones already settled.
--
-- Remember: the same change must also land in src/config/schema.sql.
IF COL_LENGTH('dbo.booking_rooms', 'discount_amount') IS NULL
    EXEC('ALTER TABLE dbo.booking_rooms ADD discount_amount DECIMAL(10,2) NOT NULL
          CONSTRAINT df_booking_rooms_discount DEFAULT 0');
GO

-- Every booking so far has exactly one room, which carries the whole concession.
UPDATE br
SET br.discount_amount = ISNULL(b.discount_amount, 0)
FROM dbo.booking_rooms br
JOIN dbo.bookings b ON b.id = br.booking_id
WHERE br.discount_amount = 0 AND ISNULL(b.discount_amount, 0) <> 0;
GO
