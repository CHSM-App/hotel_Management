-- payment_lines
--
-- How a settlement was actually tendered, one row per method.
--
-- This file is both halves at once: a guarded CREATE, so it builds the table
-- from nothing alongside 004-042, and carries an existing database forward.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- ---------------------------------------------------------------------------
-- Payment lines
-- ---------------------------------------------------------------------------

-- A guest settling a bill often hands over money in two ways — some cash, the
-- rest by UPI or card. Every money document here records exactly one method
-- (invoices.balance_payment_method, advance_receipts.payment_method), so the
-- desk had to pick one and the other half was filed under a method it never
-- used. That misstates the day's takings by mode and prints something untrue
-- on the guest's own bill.
--
-- One table serves both documents rather than a column-pair on each: a payment
-- is the same fact whichever document acknowledges it, and a second table would
-- be a second set of constraints to keep in step.
--
-- IMPORTANT: these lines only ever *split* a total. They are never the source
-- of truth for one. bookings.advance_amount in particular is written by five
-- different paths — booking create, check-in, an edit that can set any value or
-- clear it, receipt issue, and a void that floors it to NULL — so a report that
-- summed these lines instead of reading that column would invent or lose money
-- the first time someone corrected a booking. See getCollectionsInPeriod, which
-- reads the total as it always has and uses these lines only to apportion it.
--
-- Nothing historical is backfilled. A document with no lines is read as a
-- single line built from its own scalar columns, which is exactly what every
-- bill and receipt issued before today is.
IF OBJECT_ID('dbo.payment_lines', 'U') IS NULL
CREATE TABLE dbo.payment_lines (
    id                  BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id            BIGINT NOT NULL REFERENCES dbo.lodges(id),
    -- Exactly one parent, enforced below. No booking_id: it is reachable
    -- through either parent, and a denormalised copy is a third thing to keep
    -- in step when a receipt is voided.
    invoice_id          BIGINT NULL REFERENCES dbo.invoices(id),
    advance_receipt_id  BIGINT NULL REFERENCES dbo.advance_receipts(id),
    method              NVARCHAR(20) NOT NULL
        CONSTRAINT ck_payment_lines_method CHECK (method IN ('CASH', 'UPI', 'CARD')),
    -- Strictly positive. A zero line is not a payment, and a negative one is a
    -- refund — which is a void against the document, not a line on it.
    amount              DECIMAL(10,2) NOT NULL
        CONSTRAINT ck_payment_lines_amount CHECK (amount > 0),
    -- Same rule as everywhere else money changes hands here: UPI and card leave
    -- a number on both sides and it is recorded, cash leaves none.
    reference           NVARCHAR(64) NULL,
    -- Insertion order is entry order is print order, so there is no sort column.
    -- Deliberately NOT a payment date: the collections report dates money by
    -- booking/invoice creation (see reports.service.js), and introducing a real
    -- payment date here would invite changing that proxy — which moves figures
    -- in periods already reconciled. That is its own decision, not this one's.
    created_at          DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

-- A line belongs to a bill or to an advance receipt, never to both and never to
-- neither. Written as a sum rather than an OR pair because that states "exactly
-- one" once, instead of two clauses that can drift apart.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_payment_lines_parent')
    ALTER TABLE dbo.payment_lines ADD CONSTRAINT ck_payment_lines_parent CHECK (
        (CASE WHEN invoice_id IS NULL THEN 0 ELSE 1 END)
      + (CASE WHEN advance_receipt_id IS NULL THEN 0 ELSE 1 END) = 1);
GO

-- Both reads are "the lines of this one document", one per parent.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_payment_lines_invoice' AND object_id = OBJECT_ID('dbo.payment_lines'))
    CREATE INDEX ix_payment_lines_invoice ON dbo.payment_lines(invoice_id) WHERE invoice_id IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_payment_lines_receipt' AND object_id = OBJECT_ID('dbo.payment_lines'))
    CREATE INDEX ix_payment_lines_receipt ON dbo.payment_lines(advance_receipt_id) WHERE advance_receipt_id IS NOT NULL;
GO
