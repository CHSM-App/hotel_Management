-- booking_drafts
--
-- One table per migration, in foreign-key dependency order: this file is
-- 16 of 32 that together build the database from nothing. The number is
-- the order, so these must be applied in sequence — which the engine does.
--
-- Split out of the single baseline that preceded it; the SQL is unchanged and
-- was verified against SQL Server by building it into a scratch schema and
-- comparing the result to src/config/schema.sql.
--
-- Guarded, so applying this to a database that already has the table is a
-- no-op rather than an error.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- A booking reception started and got interrupted out of. Its own table rather
-- than a bookings.status = 'DRAFT', because a draft is not a booking: it holds
-- no room, it is not billable, it has no guest register entry, and it is allowed
-- to be incomplete in ways every query against dbo.bookings assumes nothing ever
-- is. Sharing the table would mean auditing every status filter in the codebase,
-- and getting one wrong would put an imaginary guest on a bill.
--
-- Crucially it does NOT block availability. Two people can draft the same room
-- for the same nights, and a real booking will take it from under both — correct,
-- because nothing has been agreed with anybody yet.
--
-- payload is the whole booking form as the screen holds it, so reopening a draft
-- restores every answer including the ones with no column here. room_id, the
-- dates and the guest name are lifted out only so the chart and the drafts list
-- can render without parsing JSON per row.
IF OBJECT_ID('dbo.booking_drafts', 'U') IS NULL
CREATE TABLE dbo.booking_drafts (
    id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id        BIGINT NOT NULL REFERENCES dbo.lodges(id),
    -- NULL until reception has picked one; such a draft simply doesn't appear on
    -- the chart, since there is no row to draw it against.
    room_id         BIGINT NULL REFERENCES dbo.rooms(id),
    check_in_date   DATE NULL,
    check_out_date  DATE NULL,
    guest_name      NVARCHAR(200) NULL,
    payload         NVARCHAR(MAX) NOT NULL
        CONSTRAINT ck_booking_drafts_payload CHECK (ISJSON(payload) = 1),
    created_by      BIGINT NULL REFERENCES dbo.users(id),
    created_at      DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    updated_at      DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_booking_drafts_lodge' AND object_id = OBJECT_ID('dbo.booking_drafts'))
    CREATE INDEX ix_booking_drafts_lodge ON dbo.booking_drafts(lodge_id, updated_at DESC);
GO

-- The chart asks "which drafts touch these nights", the same overlap question it
-- asks of bookings.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_booking_drafts_dates' AND object_id = OBJECT_ID('dbo.booking_drafts'))
    CREATE INDEX ix_booking_drafts_dates ON dbo.booking_drafts(lodge_id, check_in_date, check_out_date) WHERE room_id IS NOT NULL;
GO
