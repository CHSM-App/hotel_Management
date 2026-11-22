-- Saved quotations (172). A quotation priced on the Room Chart can now be kept: the guest, the
-- rooms and nights, and the server's own price breakdown, frozen as `payload` so reopening it
-- shows what was quoted rather than today's rates. It stays active until its earliest check-in
-- date arrives; expiry is worked out when it is read, so nothing is ever rewritten at expiry.
-- Remember: the same change must also land in src/config/schema.sql.
IF OBJECT_ID('dbo.lodge_quotations', 'U') IS NULL
CREATE TABLE dbo.lodge_quotations (
    id                  BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id            BIGINT NOT NULL REFERENCES dbo.lodges(id),
    reference_code      NVARCHAR(16) NOT NULL,
    guest_name          NVARCHAR(120) NULL,
    guest_phone         NVARCHAR(20) NULL,
    check_in_date       DATE NOT NULL,
    last_check_out_date DATE NOT NULL,
    total               DECIMAL(12,2) NOT NULL,
    room_summary        NVARCHAR(300) NOT NULL,
    payload             NVARCHAR(MAX) NOT NULL,
    status              NVARCHAR(10) NOT NULL CONSTRAINT df_lodge_quotations_status DEFAULT 'ACTIVE'
                        CONSTRAINT ck_lodge_quotations_status CHECK (status IN ('ACTIVE', 'BOOKED')),
    booked_booking_id   BIGINT NULL,
    created_by          BIGINT NULL,
    created_at          DATETIMEOFFSET NOT NULL CONSTRAINT df_lodge_quotations_created DEFAULT SYSDATETIMEOFFSET(),
    deleted_at          DATETIMEOFFSET NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_lodge_quotations_ref' AND object_id = OBJECT_ID('dbo.lodge_quotations'))
CREATE UNIQUE INDEX uq_lodge_quotations_ref ON dbo.lodge_quotations(reference_code);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_lodge_quotations_lodge_status' AND object_id = OBJECT_ID('dbo.lodge_quotations'))
CREATE INDEX ix_lodge_quotations_lodge_status ON dbo.lodge_quotations(lodge_id, status, check_in_date);
GO
