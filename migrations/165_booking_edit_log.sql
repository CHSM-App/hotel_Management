-- Booking edit log (165). One row per successful booking write, with who did it
-- and from which device. The what/before/after lives in dbo.audit_log; this adds
-- the who and where that audit_log cannot get from a shared DB login.
-- Remember: the same change must also land in src/config/schema.sql.

IF OBJECT_ID('dbo.booking_edit_log', 'U') IS NULL
CREATE TABLE dbo.booking_edit_log (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id    BIGINT NOT NULL,
    booking_id  BIGINT NULL,
    user_id     BIGINT NULL,
    user_role   NVARCHAR(20) NULL,
    device_id   NVARCHAR(64) NULL,
    client_ip   NVARCHAR(45) NULL,
    action      NVARCHAR(200) NOT NULL,   -- "PATCH /bookings/:id/check-out"
    fields      NVARCHAR(1000) NULL,      -- body field names only, never values
    created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_booking_edit_log_booking' AND object_id = OBJECT_ID('dbo.booking_edit_log'))
    EXEC('CREATE INDEX ix_booking_edit_log_booking ON dbo.booking_edit_log(booking_id, created_at DESC)');
