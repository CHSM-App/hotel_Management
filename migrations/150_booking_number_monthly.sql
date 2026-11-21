-- Booking numbers, shorter: <HOTEL><YY><MM><SEQ>, e.g. SKR2610001
--
-- Migration 149 introduced B-SKR-261022-0007 (17 characters, a sequence per
-- day). That was too long to read out, so the format is now the hotel's code,
-- the creation year and month, and a 3-digit running number that restarts at
-- 001 every month:
--
--   SKR   the hotel's booking_code (3-4 LETTERS now — see step 1)
--   2610  October 2026, the month the booking was created, Indian time
--   001   that hotel's 1st booking that month; grows to 4 digits past 999
--
-- Letters only for the code, so the digits that follow can always be told
-- apart from it and no two hotels can ever produce the same string.
--
-- This file re-derives every number from scratch, so it is correct whether or
-- not 149's numbers were ever used. Numbers from 149 are replaced. Nothing
-- outside the app has been given the old format (the WhatsApp confirmation
-- never carried it); anything printed or quoted in it will no longer match.
--
-- The counter table keeps its shape: seq_date now holds the FIRST DAY OF THE
-- MONTH instead of a calendar day.
--
-- Remember: the same change must also land in src/config/schema.sql (comments
-- only — the table shapes did not change).

-- 1. Codes were letters-or-digits in 149. Turn any digit into a letter
-- (0-9 -> A-J), then nudge the last letter if that clashes with another hotel.
DECLARE @id BIGINT, @new NVARCHAR(4), @i INT;
DECLARE @alphabet NVARCHAR(26) = N'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

DECLARE code_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT id, TRANSLATE(booking_code, N'0123456789', N'ABCDEFGHIJ')
    FROM dbo.lodges
    WHERE booking_code LIKE '%[0-9]%'
    ORDER BY id;
OPEN code_cursor;
FETCH NEXT FROM code_cursor INTO @id, @new;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @i = 1;
    WHILE EXISTS (SELECT 1 FROM dbo.lodges WHERE booking_code = @new AND id <> @id) AND @i <= 26
    BEGIN
        SET @new = LEFT(@new, 3) + SUBSTRING(@alphabet, @i, 1);
        SET @i = @i + 1;
    END;
    UPDATE dbo.lodges SET booking_code = @new WHERE id = @id;
    FETCH NEXT FROM code_cursor INTO @id, @new;
END;
CLOSE code_cursor;
DEALLOCATE code_cursor;
GO

-- 2. Every booking renumbered, in creation order within its hotel and month.
-- The old and new formats can't collide (the old one has dashes), so the
-- unique index holds throughout.
;WITH dated AS (
    SELECT b.id, b.lodge_id, b.created_at, l.booking_code,
           CAST(SWITCHOFFSET(b.created_at, '+05:30') AS DATE) AS local_day
    FROM dbo.bookings b
    JOIN dbo.lodges l ON l.id = b.lodge_id
    WHERE l.booking_code IS NOT NULL
),
numbered AS (
    SELECT id, booking_code,
           LEFT(CONVERT(CHAR(6), local_day, 12), 4) AS yymm,
           ROW_NUMBER() OVER (
               PARTITION BY lodge_id, YEAR(local_day), MONTH(local_day)
               ORDER BY created_at, id
           ) AS n
    FROM dated
)
UPDATE b
SET booking_number = n.booking_code + n.yymm
    + CASE WHEN n.n < 1000 THEN RIGHT(N'000' + CAST(n.n AS NVARCHAR(10)), 3) ELSE CAST(n.n AS NVARCHAR(10)) END
FROM dbo.bookings b
JOIN numbered n ON n.id = b.id;
GO

-- 3. Counters rebuilt as one row per hotel per month, so the next new booking
-- continues after the numbers just handed out.
DELETE FROM dbo.booking_sequences;
GO

INSERT INTO dbo.booking_sequences (lodge_id, seq_date, next_number)
SELECT b.lodge_id,
       DATEFROMPARTS(YEAR(CAST(SWITCHOFFSET(b.created_at, '+05:30') AS DATE)), MONTH(CAST(SWITCHOFFSET(b.created_at, '+05:30') AS DATE)), 1),
       COUNT(*) + 1
FROM dbo.bookings b
GROUP BY b.lodge_id,
         YEAR(CAST(SWITCHOFFSET(b.created_at, '+05:30') AS DATE)),
         MONTH(CAST(SWITCHOFFSET(b.created_at, '+05:30') AS DATE));
GO
