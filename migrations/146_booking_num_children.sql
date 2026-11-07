-- How many of a booking's guests are children, kept as a count of its own.
--
-- num_guests has always been the whole party. The children among them were
-- only recoverable from booking_guests rows flagged is_child, and a child row
-- needs a name -- so a child the desk didn't take details for simply counted as
-- an adult. This column records the number outright, whether or not each child
-- has a row; adults are num_guests - num_children (always at least the primary
-- guest).
IF COL_LENGTH('dbo.bookings', 'num_children') IS NULL
    EXEC('ALTER TABLE dbo.bookings ADD num_children INT NOT NULL
          CONSTRAINT df_bookings_num_children DEFAULT 0
          CONSTRAINT ck_bookings_num_children CHECK (num_children >= 0)');
GO

-- Bookings taken before this existed: the children are the flagged rows.
-- Children who had no row were never recorded and can't be recovered, so those
-- bookings keep the 0 they default to (documents then print the plain head
-- count rather than a split).
UPDATE b
SET num_children = c.n
FROM dbo.bookings b
JOIN (
    SELECT booking_id, COUNT(*) AS n
    FROM dbo.booking_guests
    WHERE is_child = 1
    GROUP BY booking_id
) c ON c.booking_id = b.id
WHERE b.num_children = 0;
GO
