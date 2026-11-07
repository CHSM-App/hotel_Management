-- lodge_enquiries
--
-- What the public page's Enquire modal writes. Previously the modal only built
-- a WhatsApp message and opened wa.me, so the lodge saw an enquiry only if the
-- guest actually pressed send in WhatsApp. Now the enquiry is stored first and
-- shows up in the dashboard's Enquiries inbox and alert bell.
--
-- reference_code is what the guest is shown (and can quote) after submitting.
-- Rows are purged after 30 days by the sweep in server.js.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF OBJECT_ID('dbo.lodge_enquiries', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.lodge_enquiries (
        id             BIGINT IDENTITY(1,1) PRIMARY KEY,
        lodge_id       BIGINT NOT NULL REFERENCES dbo.lodges(id),
        reference_code NVARCHAR(16) NOT NULL,
        kind           NVARCHAR(10) NOT NULL CONSTRAINT ck_lodge_enquiries_kind CHECK (kind IN ('ROOM', 'EVENT', 'GENERAL', 'SERVICE')),
        name           NVARCHAR(120) NOT NULL,
        phone          NVARCHAR(20) NOT NULL,
        check_in_date  DATE NULL,
        check_out_date DATE NULL,
        event_date     DATE NULL,
        event_type     NVARCHAR(60) NULL,
        room_type_id   BIGINT NULL,
        venue_id       BIGINT NULL,
        guests         INT NULL,
        addon_ids      NVARCHAR(500) NULL,
        summary        NVARCHAR(1000) NULL,
        notes          NVARCHAR(1000) NULL,
        status         NVARCHAR(12) NOT NULL CONSTRAINT df_lodge_enquiries_status DEFAULT 'NEW'
                       CONSTRAINT ck_lodge_enquiries_status CHECK (status IN ('NEW', 'CONTACTED', 'CONVERTED', 'CLOSED')),
        created_at     DATETIMEOFFSET NOT NULL CONSTRAINT df_lodge_enquiries_created DEFAULT SYSDATETIMEOFFSET(),
        handled_by     BIGINT NULL,
        handled_at     DATETIMEOFFSET NULL
    );

    CREATE UNIQUE INDEX uq_lodge_enquiries_ref ON dbo.lodge_enquiries(reference_code);
    CREATE INDEX ix_lodge_enquiries_lodge_status ON dbo.lodge_enquiries(lodge_id, status, created_at DESC);
END;
GO
