-- Booking numbers: B-<HOTEL>-<YYMMDD>-<SEQ>, e.g. B-SKR-261022-0007
--
--   B       what it is (B booking; the scheme is meant to be reused for events
--           and enquiries with their own letter)
--   SKR     the hotel's booking_code, unique across the whole platform, so the
--           full number is unique everywhere with no extra check
--   261022  the day the booking was CREATED, Indian time (not the check-in
--           date: creation never changes, so the number can't go stale if the
--           stay is moved)
--   0007    that hotel's 7th booking of that day, from dbo.booking_sequences,
--           allocated atomically inside the booking's own transaction
--
-- The number is written once and never recalculated, so later changes to a
-- hotel's code can't alter an issued number.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- 1. The hotel's code. Staff-set (Vengurla Tech admin), unique when present.
IF COL_LENGTH('dbo.lodges', 'booking_code') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD booking_code NVARCHAR(4) NULL');
GO

-- 2. A code for every existing hotel, from its name: initials of the words
-- (Sagar Kinara Residency -> SKR), padded from the name's letters when short
-- (Hotel -> HOT). A clash gets a digit as the last character (SKR2). Staff can
-- correct any of them in the admin panel before bookings start using it.
DECLARE @id BIGINT, @name NVARCHAR(200);
DECLARE @clean NVARCHAR(200), @i INT, @ch NCHAR(1), @initials NVARCHAR(10), @letters NVARCHAR(200), @newWord BIT;
DECLARE @base NVARCHAR(4), @candidate NVARCHAR(4), @n INT;

DECLARE lodge_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT id, name FROM dbo.lodges WHERE booking_code IS NULL ORDER BY id;
OPEN lodge_cursor;
FETCH NEXT FROM lodge_cursor INTO @id, @name;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @clean = UPPER(@name);
    SET @i = 1;
    SET @initials = N'';
    SET @letters = N'';
    SET @newWord = 1;
    WHILE @i <= LEN(@clean)
    BEGIN
        SET @ch = SUBSTRING(@clean, @i, 1);
        IF @ch LIKE '[A-Z0-9]'
        BEGIN
            SET @letters = @letters + @ch;
            IF @newWord = 1 AND LEN(@initials) < 4 SET @initials = @initials + @ch;
            SET @newWord = 0;
        END
        ELSE SET @newWord = 1;
        SET @i = @i + 1;
    END;

    IF LEN(@letters) = 0 SET @base = N'LDG';
    ELSE IF LEN(@initials) >= 3 SET @base = LEFT(@initials, 4);
    ELSE SET @base = LEFT(@initials + SUBSTRING(@letters, 2, 10), 3);

    SET @candidate = @base;
    SET @n = 2;
    WHILE EXISTS (SELECT 1 FROM dbo.lodges WHERE booking_code = @candidate) AND @n <= 9
    BEGIN
        SET @candidate = LEFT(@base, 3) + CAST(@n AS NVARCHAR(1));
        SET @n = @n + 1;
    END;
    IF EXISTS (SELECT 1 FROM dbo.lodges WHERE booking_code = @candidate)
        SET @candidate = N'Z' + RIGHT(N'000' + CAST(@id AS NVARCHAR(10)), 3);

    UPDATE dbo.lodges SET booking_code = @candidate WHERE id = @id;
    FETCH NEXT FROM lodge_cursor INTO @id, @name;
END;
CLOSE lodge_cursor;
DEALLOCATE lodge_cursor;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_lodges_booking_code' AND object_id = OBJECT_ID('dbo.lodges'))
    EXEC('CREATE UNIQUE INDEX uq_lodges_booking_code ON dbo.lodges(booking_code) WHERE booking_code IS NOT NULL');
GO

-- 3. One counter row per hotel per day. A day with no bookings has no row.
IF OBJECT_ID('dbo.booking_sequences', 'U') IS NULL
    CREATE TABLE dbo.booking_sequences (
        lodge_id    BIGINT NOT NULL REFERENCES dbo.lodges(id),
        seq_date    DATE NOT NULL,
        next_number INT NOT NULL,
        CONSTRAINT pk_booking_sequences PRIMARY KEY (lodge_id, seq_date)
    );
GO

-- 4. The number itself, on the booking.
IF COL_LENGTH('dbo.bookings', 'booking_number') IS NULL
    EXEC('ALTER TABLE dbo.bookings ADD booking_number NVARCHAR(32) NULL');
GO

-- 5. Existing bookings, in creation order, each against its own creation day.
;WITH numbered AS (
    SELECT b.id, l.booking_code,
           CONVERT(CHAR(6), CAST(SWITCHOFFSET(b.created_at, '+05:30') AS DATE), 12) AS ymd,
           ROW_NUMBER() OVER (
               PARTITION BY b.lodge_id, CAST(SWITCHOFFSET(b.created_at, '+05:30') AS DATE)
               ORDER BY b.id
           ) AS n
    FROM dbo.bookings b
    JOIN dbo.lodges l ON l.id = b.lodge_id
    WHERE b.booking_number IS NULL
)
UPDATE b
SET booking_number = N'B-' + n.booking_code + N'-' + n.ymd + N'-'
    + CASE WHEN n.n < 10000 THEN RIGHT(N'0000' + CAST(n.n AS NVARCHAR(10)), 4) ELSE CAST(n.n AS NVARCHAR(10)) END
FROM dbo.bookings b
JOIN numbered n ON n.id = b.id;
GO

-- 6. Seed the counters so the next new booking continues after the backfill.
INSERT INTO dbo.booking_sequences (lodge_id, seq_date, next_number)
SELECT b.lodge_id, CAST(SWITCHOFFSET(b.created_at, '+05:30') AS DATE), COUNT(*) + 1
FROM dbo.bookings b
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.booking_sequences s
    WHERE s.lodge_id = b.lodge_id AND s.seq_date = CAST(SWITCHOFFSET(b.created_at, '+05:30') AS DATE)
)
GROUP BY b.lodge_id, CAST(SWITCHOFFSET(b.created_at, '+05:30') AS DATE);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_bookings_booking_number' AND object_id = OBJECT_ID('dbo.bookings'))
    EXEC('CREATE UNIQUE INDEX uq_bookings_booking_number ON dbo.bookings(booking_number) WHERE booking_number IS NOT NULL');
GO
