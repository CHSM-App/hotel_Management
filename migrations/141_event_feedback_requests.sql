-- feedback_requests: let a row ask after an event, not only after a stay
--
-- Same shape the "stay or function, never both, never neither" split already
-- took on dbo.advance_receipts and dbo.invoices: booking_id goes nullable,
-- event_booking_id joins it, a CHECK pins exactly one of the two, and the
-- UNIQUE(booking_id) dedup becomes a filtered unique index on each column —
-- a plain UNIQUE constraint allows at most one NULL in SQL Server, which
-- would have let only the first event's row through once booking_id started
-- being left NULL for every one of them.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.feedback_requests') AND name = 'booking_id' AND is_nullable = 0
)
BEGIN
    IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'uq_feedback_requests_booking' AND parent_object_id = OBJECT_ID('dbo.feedback_requests'))
        ALTER TABLE dbo.feedback_requests DROP CONSTRAINT uq_feedback_requests_booking;

    ALTER TABLE dbo.feedback_requests ALTER COLUMN booking_id BIGINT NULL;

    CREATE UNIQUE INDEX uq_feedback_requests_booking_active ON dbo.feedback_requests(booking_id)
        WHERE booking_id IS NOT NULL;
END;
GO

IF COL_LENGTH('dbo.feedback_requests', 'event_booking_id') IS NULL
    EXEC('ALTER TABLE dbo.feedback_requests ADD event_booking_id BIGINT NULL REFERENCES dbo.event_bookings(id)');
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_feedback_requests_parent')
    EXEC('ALTER TABLE dbo.feedback_requests ADD CONSTRAINT ck_feedback_requests_parent CHECK (
        (CASE WHEN booking_id IS NULL THEN 0 ELSE 1 END)
      + (CASE WHEN event_booking_id IS NULL THEN 0 ELSE 1 END) = 1)');
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_feedback_requests_event_active' AND object_id = OBJECT_ID('dbo.feedback_requests'))
    EXEC('CREATE UNIQUE INDEX uq_feedback_requests_event_active ON dbo.feedback_requests(event_booking_id)
          WHERE event_booking_id IS NOT NULL');
GO
