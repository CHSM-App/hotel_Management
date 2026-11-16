-- room_settlements: payment taken when one room of a multi-room booking leaves
-- while others stay. The room checks out only in the same transaction that
-- records this row. Not an invoice: the booking still gets ONE invoice when its
-- last room leaves, which deducts these payments (invoice_id is stamped then and
-- the payment lines are re-parented onto that invoice).
--
-- Remember: the same change must also land in src/config/schema.sql.

IF OBJECT_ID('dbo.room_settlements', 'U') IS NULL
CREATE TABLE dbo.room_settlements (
    id               BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id         BIGINT NOT NULL REFERENCES dbo.lodges(id),
    booking_id       BIGINT NOT NULL REFERENCES dbo.bookings(id),
    booking_room_id  BIGINT NOT NULL REFERENCES dbo.booking_rooms(id),
    room_total       DECIMAL(10,2) NOT NULL,
    advance_applied  DECIMAL(10,2) NOT NULL DEFAULT 0,
    collected        DECIMAL(10,2) NOT NULL DEFAULT 0,
    late_charge      DECIMAL(10,2) NOT NULL DEFAULT 0,
    invoice_id       BIGINT NULL REFERENCES dbo.invoices(id),
    created_by       BIGINT NULL REFERENCES dbo.users(id),
    created_at       DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_room_settlements_room UNIQUE (booking_room_id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_room_settlements_booking' AND object_id = OBJECT_ID('dbo.room_settlements'))
CREATE INDEX ix_room_settlements_booking ON dbo.room_settlements(booking_id);
GO

IF COL_LENGTH('dbo.payment_lines', 'room_settlement_id') IS NULL
ALTER TABLE dbo.payment_lines ADD room_settlement_id BIGINT NULL REFERENCES dbo.room_settlements(id);
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_payment_lines_parent')
ALTER TABLE dbo.payment_lines DROP CONSTRAINT ck_payment_lines_parent;
GO

ALTER TABLE dbo.payment_lines ADD CONSTRAINT ck_payment_lines_parent CHECK (
    (CASE WHEN invoice_id IS NULL THEN 0 ELSE 1 END)
  + (CASE WHEN advance_receipt_id IS NULL THEN 0 ELSE 1 END)
  + (CASE WHEN room_settlement_id IS NULL THEN 0 ELSE 1 END) = 1);
GO
