-- bill_shares
--
-- Every copy of a bill that has been handed to a guest over WhatsApp, and the
-- token that copy is reachable by.
--
-- This file is both halves at once: a guarded CREATE, so it builds alongside
-- 004-057, and carries an existing database forward.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- ---------------------------------------------------------------------------
-- dbo.bill_shares
-- ---------------------------------------------------------------------------

-- A bill sent on WhatsApp travels as a link, not as an attachment: the
-- provider's SendMessage takes an approved template and its text variables and
-- has no way to carry a file. So the PDF is stored and one of the template's
-- variables is the URL it is stored at.
--
-- That URL is opened by the guest, who has no login — the row is what stands in
-- for one. `token` is the whole of the credential, so it is generated with
-- crypto.randomUUID and is the only way in: no id is guessable into a
-- neighbouring bill, because the id is never in the URL.
--
-- The file lives on disk under uploads/bill-shares (see billShareUpload.js) and
-- `filename` names it there. The row is the index; the disk holds the bytes.
--
-- One row per send rather than one per invoice. A bill re-sent because the
-- first number was wrong is a second delivery to a second phone, and a desk
-- asking "did this reach the guest" needs both attempts, not the last one.
IF OBJECT_ID('dbo.bill_shares', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.bill_shares (
        id             BIGINT IDENTITY(1,1) PRIMARY KEY,
        lodge_id       BIGINT NOT NULL REFERENCES dbo.lodges(id),
        invoice_id     BIGINT NOT NULL REFERENCES dbo.invoices(id),
        -- The credential the guest's link carries. Unique because it is looked
        -- up on its own — a duplicate would serve one guest another's bill.
        token          NVARCHAR(64) NOT NULL,
        -- Where the bytes are on disk, relative to the bill-shares directory.
        filename       NVARCHAR(120) NOT NULL,
        -- What was actually dialled, normalised to the provider's shape, so a
        -- misdelivery can be traced to the number rather than to the guest the
        -- bill was for.
        phone          NVARCHAR(20) NULL,
        channel        NVARCHAR(20) NOT NULL
            CONSTRAINT ck_bill_shares_channel CHECK (channel IN ('WHATSAPP', 'EMAIL')),
        -- 'SENT' or 'FAILED'. The provider accepting the message is all this
        -- can honestly record: delivery to the handset is not reported back.
        status         NVARCHAR(20) NOT NULL
            CONSTRAINT ck_bill_shares_status CHECK (status IN ('SENT', 'FAILED')),
        -- The provider's own description when it said no, which is what
        -- separates "number not on WhatsApp" from "template not approved".
        error          NVARCHAR(400) NULL,
        -- The provider's campaign id for a send that went through, so a
        -- disputed delivery can be taken back to them with a reference.
        campaign_id    NVARCHAR(100) NULL,
        sent_by        BIGINT NULL REFERENCES dbo.users(id),
        created_at     DATETIME2(0) NOT NULL CONSTRAINT df_bill_shares_created DEFAULT SYSUTCDATETIME()
    );

    CREATE UNIQUE INDEX uq_bill_shares_token ON dbo.bill_shares(token);
    -- The detail screen lists what has been sent for one bill, newest first.
    CREATE INDEX ix_bill_shares_invoice ON dbo.bill_shares(invoice_id, id DESC);
END;
