-- invoices
--
-- One table per migration, in foreign-key dependency order: this file is
-- 24 of 32 that together build the database from nothing. The number is
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

-- The issued bill. One ISSUED invoice per booking at a time — the filtered
-- unique index below allows a VOID followed by a fresh reissue, matching
-- "issued invoices are immutable, void in place, reissue".
--
-- booking_id is nullable: a restaurant bill has no stay behind it. The filtered
-- index ignores NULLs, so several food-only invoices coexist without colliding.
--
-- Food is a separate supply on its own SAC and rate, so it cannot be folded into
-- room_subtotal — GSTR-1 needs the two reported apart. A bill can carry either
-- or both: a stay with room service has both, a closed table only the food side.
IF OBJECT_ID('dbo.invoices', 'U') IS NULL
CREATE TABLE dbo.invoices (
    id                     BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id               BIGINT NOT NULL REFERENCES dbo.lodges(id),
    booking_id             BIGINT NULL REFERENCES dbo.bookings(id),
    -- What a food-only bill was raised against, for the header of a restaurant
    -- document ("Table 4") and so the same table can be closed again later.
    table_id               BIGINT NULL REFERENCES dbo.dining_tables(id),
    document_type          NVARCHAR(20) NOT NULL
        CONSTRAINT ck_invoices_document_type CHECK (document_type IN ('TAX_INVOICE', 'BILL_OF_SUPPLY', 'CASH_RECEIPT')),
    billing_side           NVARCHAR(10) NOT NULL
        CONSTRAINT ck_invoices_billing_side CHECK (billing_side IN ('GST', 'NON_GST')),
    invoice_number         NVARCHAR(50) NOT NULL,
    room_subtotal          DECIMAL(10,2) NOT NULL,
    cgst_amount            DECIMAL(10,2) NOT NULL DEFAULT 0,
    sgst_amount            DECIMAL(10,2) NOT NULL DEFAULT 0,
    food_subtotal          DECIMAL(10,2) NOT NULL CONSTRAINT df_invoices_food_subtotal DEFAULT 0,
    food_cgst_amount       DECIMAL(10,2) NOT NULL CONSTRAINT df_invoices_food_cgst DEFAULT 0,
    food_sgst_amount       DECIMAL(10,2) NOT NULL CONSTRAINT df_invoices_food_sgst DEFAULT 0,
    -- Snapshotted here under the same rule as every other amount on an issued
    -- bill: it cannot be reprinted by reading the booking back and hoping nobody
    -- edited it since.
    late_checkout_charge   DECIMAL(10,2) NOT NULL CONSTRAINT df_invoices_late_charge DEFAULT 0,
    -- The billing desk's own reduction, decided when the document is written and
    -- applied to everything on it — room, overstay and food alike. The
    -- percentage is stored alongside rather than recomputed, because it is what
    -- was agreed with the guest ("10% off") and the amount is what that came to;
    -- round-off would otherwise make the printed percentage drift.
    discount_amount        DECIMAL(10,2) NOT NULL CONSTRAINT df_invoices_discount DEFAULT 0,
    discount_percent       DECIMAL(5,2) NOT NULL CONSTRAINT df_invoices_discount_pct DEFAULT 0,
    round_off              DECIMAL(10,2) NOT NULL DEFAULT 0,
    total_amount           DECIMAL(10,2) NOT NULL,
    advance_paid           DECIMAL(10,2) NOT NULL DEFAULT 0,
    balance_collected      DECIMAL(10,2) NOT NULL DEFAULT 0,
    balance_payment_method NVARCHAR(20) NULL
        CONSTRAINT ck_invoices_payment_method CHECK (balance_payment_method IN ('CASH', 'UPI', 'CARD')),
    balance_reference      NVARCHAR(64) NULL,
    status                 NVARCHAR(10) NOT NULL DEFAULT 'ISSUED'
        CONSTRAINT ck_invoices_status CHECK (status IN ('ISSUED', 'VOID')),
    void_reason            NVARCHAR(200) NULL,
    voided_at              DATETIMEOFFSET NULL,
    created_by             BIGINT NULL REFERENCES dbo.users(id),
    created_at             DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_invoices_booking_active' AND object_id = OBJECT_ID('dbo.invoices'))
    CREATE UNIQUE INDEX uq_invoices_booking_active ON dbo.invoices(booking_id) WHERE status = 'ISSUED';
GO
