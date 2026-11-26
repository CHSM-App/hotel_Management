-- feedback_requests
--
-- The guest side of "how was your stay" — a page this app hosts itself, not a
-- link the owner has to go find and paste in. One row is both the WhatsApp
-- message's credential (the token) and the answer to "has this booking
-- already been asked": the sweep that sends the message (see
-- stayReminders.service.js's sibling, feedbackRequests.service.js) only ever
-- considers a booking with no row here yet, and inserts the row *before*
-- attempting the send, so a retry of the sweep can never double-ask.
--
-- rating/comment/submitted_at stay NULL until the guest actually fills the
-- page in — a row existing is "asked", not "answered".
--
-- This file is both halves at once: a guarded CREATE, so it builds alongside
-- every earlier migration, and carries an existing database forward.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF OBJECT_ID('dbo.feedback_requests', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.feedback_requests (
        id             BIGINT IDENTITY(1,1) PRIMARY KEY,
        lodge_id       BIGINT NOT NULL REFERENCES dbo.lodges(id),
        booking_id     BIGINT NOT NULL REFERENCES dbo.bookings(id),
        -- The credential the guest's link carries — same shape as
        -- dbo.bill_shares.token: the whole of the authentication, so it is
        -- random and long and never derived from anything about the booking.
        token          NVARCHAR(32) NOT NULL,
        requested_at   DATETIMEOFFSET NOT NULL CONSTRAINT df_feedback_requests_requested DEFAULT SYSDATETIMEOFFSET(),
        rating         TINYINT NULL CONSTRAINT ck_feedback_requests_rating CHECK (rating BETWEEN 1 AND 5),
        comment        NVARCHAR(1000) NULL,
        submitted_at   DATETIMEOFFSET NULL,
        -- One ask per booking — this is the dedup the sweep's NOT EXISTS
        -- check relies on, not a separate "already sent" flag on bookings.
        CONSTRAINT uq_feedback_requests_booking UNIQUE (booking_id)
    );

    CREATE UNIQUE INDEX uq_feedback_requests_token ON dbo.feedback_requests(token);
END;
GO
