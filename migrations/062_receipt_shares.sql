-- receipt_shares
--
-- Every copy of an advance receipt that has been handed to a guest over
-- WhatsApp, and the token that copy is reachable by. The receipt's own
-- equivalent of bill_shares (058) — a separate table rather than a nullable
-- second FK on bill_shares, because a receipt is not an invoice and the two
-- must never be confused at the database's own constraint level: a stray
-- receipt id landing in invoice_id would either fail loudly against the FK
-- (the safe outcome) or, worse, silently match an unrelated invoice with the
-- same id.
--
-- This file is both halves at once: a guarded CREATE, so it builds alongside
-- 004-061, and carries an existing database forward.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- ---------------------------------------------------------------------------
-- dbo.receipt_shares
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.receipt_shares', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.receipt_shares (
        id             BIGINT IDENTITY(1,1) PRIMARY KEY,
        lodge_id       BIGINT NOT NULL REFERENCES dbo.lodges(id),
        receipt_id     BIGINT NOT NULL REFERENCES dbo.advance_receipts(id),
        -- The credential the guest's link carries. Unique because it is
        -- looked up on its own — a duplicate would serve one guest another's
        -- receipt.
        token          NVARCHAR(64) NOT NULL,
        -- Where the bytes are on disk, relative to the receipt-shares
        -- directory (see receiptShareUpload.js).
        filename       NVARCHAR(120) NOT NULL,
        -- What was actually dialled, normalised to the provider's shape, so a
        -- misdelivery can be traced to the number rather than to the guest
        -- the receipt was for.
        phone          NVARCHAR(20) NULL,
        channel        NVARCHAR(20) NOT NULL
            CONSTRAINT ck_receipt_shares_channel CHECK (channel IN ('WHATSAPP', 'EMAIL')),
        -- 'SENT' or 'FAILED'. The provider accepting the message is all this
        -- can honestly record: delivery to the handset is not reported back.
        status         NVARCHAR(20) NOT NULL
            CONSTRAINT ck_receipt_shares_status CHECK (status IN ('SENT', 'FAILED')),
        -- The provider's own description when it said no, which is what
        -- separates "number not on WhatsApp" from "template not approved".
        error          NVARCHAR(400) NULL,
        -- The provider's campaign id for a send that went through, so a
        -- disputed delivery can be taken back to them with a reference.
        campaign_id    NVARCHAR(100) NULL,
        sent_by        BIGINT NULL REFERENCES dbo.users(id),
        created_at     DATETIME2(0) NOT NULL CONSTRAINT df_receipt_shares_created DEFAULT SYSUTCDATETIME()
    );

    CREATE UNIQUE INDEX uq_receipt_shares_token ON dbo.receipt_shares(token);
    -- The receipt's own screen lists what has been sent for it, newest first.
    CREATE INDEX ix_receipt_shares_receipt ON dbo.receipt_shares(receipt_id, id DESC);
END;
