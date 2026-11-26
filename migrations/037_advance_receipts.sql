-- advance_receipts
--
-- The receipt handed to a guest who pays an advance when the booking is taken.
--
-- This file is both halves at once: guarded CREATEs, so it builds the table
-- from nothing alongside 004-035, and an ALTER that carries an existing
-- database forward. A separate per-table twin would only be a second guarded
-- copy of the same CREATE, and a second thing to keep in step.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- ---------------------------------------------------------------------------
-- Advance receipts
-- ---------------------------------------------------------------------------

-- The receipt for money taken before the stay. Under GST an advance against a
-- supply is a Receipt Voucher (Rule 50) — not an invoice: it acknowledges money
-- received against a stay that has not happened yet, and the tax invoice at
-- checkout is a separate document that reports the whole stay.
--
-- Its own table rather than a row in dbo.invoices, because the filtered unique
-- index there allows one ISSUED invoice per booking and an advance receipt is
-- not that invoice — a booking can have both, and (part payments) more than one
-- receipt. Sharing the table would mean widening that index and auditing every
-- query that assumes an invoices row is a bill.
--
-- Amounts are GST-inclusive, like every price in this system: amount_received
-- is what the guest actually handed over, and cgst/sgst are the tax already
-- inside it, extracted by billing.service.js's taxWithin. That is what keeps
-- the final bill's arithmetic untouched — it subtracts the same inclusive
-- advance from an inclusive total, and nobody is taxed twice.
IF OBJECT_ID('dbo.advance_receipts', 'U') IS NULL
CREATE TABLE dbo.advance_receipts (
    id                  BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id            BIGINT NOT NULL REFERENCES dbo.lodges(id),
    booking_id          BIGINT NOT NULL REFERENCES dbo.bookings(id),
    receipt_number      NVARCHAR(50) NOT NULL,
    -- RECEIPT_VOUCHER where the lodge is GST registered and the stay is taxable,
    -- ADVANCE_RECEIPT where there is no tax to state — a plain acknowledgement.
    -- The document prints its own title from this.
    document_type       NVARCHAR(20) NOT NULL
        CONSTRAINT ck_advance_receipts_document_type
        CHECK (document_type IN ('RECEIPT_VOUCHER', 'ADVANCE_RECEIPT')),
    billing_side        NVARCHAR(10) NOT NULL
        CONSTRAINT ck_advance_receipts_billing_side CHECK (billing_side IN ('GST', 'NON_GST')),
    -- What the guest handed over, tax inside.
    amount_received     DECIMAL(10,2) NOT NULL,
    -- The tax sitting inside amount_received, and the rate it was taken at.
    -- Zero on the non-GST side and on a stay below the nil threshold.
    cgst_amount         DECIMAL(10,2) NOT NULL CONSTRAINT df_advance_receipts_cgst DEFAULT 0,
    sgst_amount         DECIMAL(10,2) NOT NULL CONSTRAINT df_advance_receipts_sgst DEFAULT 0,
    -- Snapshotted rather than re-derived: the slab is read from the nightly
    -- tariff at the moment the receipt is written, and a later rate change must
    -- not move a figure on a document already in a guest's hand.
    rate_percent        DECIMAL(5,2) NOT NULL CONSTRAINT df_advance_receipts_rate DEFAULT 0,
    -- The stay this was taken against, frozen for the same reason: the receipt
    -- states the balance due, and an extended booking must not silently restate
    -- a receipt already issued.
    stay_total          DECIMAL(10,2) NOT NULL,
    payment_method      NVARCHAR(20) NOT NULL
        CONSTRAINT ck_advance_receipts_payment_method
        CHECK (payment_method IN ('CASH', 'UPI', 'CARD')),
    -- Same rule as the advance on the booking: money with a trail carries its
    -- number, cash carries none.
    payment_reference   NVARCHAR(64) NULL,
    status              NVARCHAR(10) NOT NULL CONSTRAINT df_advance_receipts_status DEFAULT 'ISSUED'
        CONSTRAINT ck_advance_receipts_status CHECK (status IN ('ISSUED', 'VOID')),
    void_reason         NVARCHAR(200) NULL,
    voided_at           DATETIMEOFFSET NULL,
    created_by          BIGINT NULL REFERENCES dbo.users(id),
    created_at          DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

-- A receipt number is a money document's identity: it must be unique per lodge
-- even across a void, so a voided receipt's number is never reissued.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_advance_receipts_number' AND object_id = OBJECT_ID('dbo.advance_receipts'))
    CREATE UNIQUE INDEX uq_advance_receipts_number ON dbo.advance_receipts(lodge_id, receipt_number);
GO

-- "What has this booking been given?" — asked by the booking detail screen on
-- every open, and by the issue path to stop a second receipt for the same money.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_advance_receipts_booking' AND object_id = OBJECT_ID('dbo.advance_receipts'))
    CREATE INDEX ix_advance_receipts_booking ON dbo.advance_receipts(booking_id, status);
GO

-- The receipt series runs apart from the invoice series so the tax-invoice
-- numbering stays gapless — an advance taken today and a bill cut next week
-- must not interleave in one sequence. Widening the CHECK is the whole change;
-- billing.service.js's allocator already takes the series type as a parameter.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_invoice_series_type')
    ALTER TABLE dbo.invoice_series DROP CONSTRAINT ck_invoice_series_type;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_invoice_series_type')
    ALTER TABLE dbo.invoice_series ADD CONSTRAINT ck_invoice_series_type
        CHECK (series_type IN ('GST', 'NON_GST', 'ADVANCE'));
GO
