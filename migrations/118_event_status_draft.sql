-- Event statuses are now DRAFT, CONFIRMED, SETTLED and CANCELLED. DRAFT replaces
-- ENQUIRY, and the on-hold (TENTATIVE) and EXPIRED states are gone with the
-- hold timer. Anything that was one of the old open states becomes a draft: a
-- hold stops blocking the venue, which is the price of removing holds.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_event_bookings_status')
    ALTER TABLE dbo.event_bookings DROP CONSTRAINT ck_event_bookings_status;
GO

IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'df_event_bookings_status')
    ALTER TABLE dbo.event_bookings DROP CONSTRAINT df_event_bookings_status;
GO

UPDATE dbo.event_bookings SET status = 'DRAFT' WHERE status IN ('ENQUIRY', 'TENTATIVE', 'EXPIRED');
GO

ALTER TABLE dbo.event_bookings ADD CONSTRAINT df_event_bookings_status DEFAULT 'DRAFT' FOR status;
GO

ALTER TABLE dbo.event_bookings ADD CONSTRAINT ck_event_bookings_status
    CHECK (status IN ('DRAFT', 'CONFIRMED', 'SETTLED', 'CANCELLED'));
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.event_bookings') AND name = 'hold_expires_at')
    ALTER TABLE dbo.event_bookings DROP COLUMN hold_expires_at;
GO
