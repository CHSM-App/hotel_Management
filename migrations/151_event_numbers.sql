-- Event numbers: E-<HOTEL><YY><MM><SEQ>, e.g. E-SKR2610001
--
-- The same shape as a stay's booking number (see 149/150) with two
-- differences: it carries an "E-" in front, and functions count on their own,
-- so a hotel's bookings and its events each run 001, 002, 003 without gaps
-- where the other took a number. The dash appears only in event numbers, so a
-- stay's number and an event's can never be the same string — even if one
-- hotel's code happens to start with E.
--
-- The number is written once when the event is created and never recalculated.
--
-- Depends on 149/150 for dbo.lodges.booking_code (letters only).
--
-- Remember: the same change must also land in src/config/schema.sql.

-- 1. One counter row per hotel per month; seq_date holds the month's first day.
IF OBJECT_ID('dbo.event_sequences', 'U') IS NULL
    CREATE TABLE dbo.event_sequences (
        lodge_id    BIGINT NOT NULL REFERENCES dbo.lodges(id),
        seq_date    DATE NOT NULL,
        next_number INT NOT NULL,
        CONSTRAINT pk_event_sequences PRIMARY KEY (lodge_id, seq_date)
    );
GO

-- 2. The number itself, on the event.
IF COL_LENGTH('dbo.event_bookings', 'event_number') IS NULL
    EXEC('ALTER TABLE dbo.event_bookings ADD event_number NVARCHAR(32) NULL');
GO

-- 3. Existing events, in creation order within their hotel and month.
;WITH dated AS (
    SELECT e.id, e.lodge_id, e.created_at, l.booking_code,
           CAST(SWITCHOFFSET(e.created_at, '+05:30') AS DATE) AS local_day
    FROM dbo.event_bookings e
    JOIN dbo.lodges l ON l.id = e.lodge_id
    WHERE e.event_number IS NULL AND l.booking_code IS NOT NULL
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
UPDATE e
SET event_number = N'E-' + n.booking_code + n.yymm
    + CASE WHEN n.n < 1000 THEN RIGHT(N'000' + CAST(n.n AS NVARCHAR(10)), 3) ELSE CAST(n.n AS NVARCHAR(10)) END
FROM dbo.event_bookings e
JOIN numbered n ON n.id = e.id;
GO

-- 4. Seed the counters so the next new event continues after the backfill.
INSERT INTO dbo.event_sequences (lodge_id, seq_date, next_number)
SELECT e.lodge_id,
       DATEFROMPARTS(YEAR(CAST(SWITCHOFFSET(e.created_at, '+05:30') AS DATE)), MONTH(CAST(SWITCHOFFSET(e.created_at, '+05:30') AS DATE)), 1),
       COUNT(*) + 1
FROM dbo.event_bookings e
WHERE e.event_number IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM dbo.event_sequences s
      WHERE s.lodge_id = e.lodge_id
        AND s.seq_date = DATEFROMPARTS(YEAR(CAST(SWITCHOFFSET(e.created_at, '+05:30') AS DATE)), MONTH(CAST(SWITCHOFFSET(e.created_at, '+05:30') AS DATE)), 1)
  )
GROUP BY e.lodge_id,
         YEAR(CAST(SWITCHOFFSET(e.created_at, '+05:30') AS DATE)),
         MONTH(CAST(SWITCHOFFSET(e.created_at, '+05:30') AS DATE));
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_event_bookings_event_number' AND object_id = OBJECT_ID('dbo.event_bookings'))
    EXEC('CREATE UNIQUE INDEX uq_event_bookings_event_number ON dbo.event_bookings(event_number) WHERE event_number IS NOT NULL');
GO
