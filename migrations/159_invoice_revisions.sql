-- invoice_revisions: one row each time an issued invoice of a checked-out stay is
-- corrected in place (the stay dates moved). The invoice keeps its number and
-- date; this is the record of what it said before and after, and why.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF OBJECT_ID('dbo.invoice_revisions', 'U') IS NULL
CREATE TABLE dbo.invoice_revisions (
    id             BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id       BIGINT NOT NULL REFERENCES dbo.lodges(id),
    invoice_id     BIGINT NOT NULL REFERENCES dbo.invoices(id),
    reason         NVARCHAR(200) NOT NULL,
    before_json    NVARCHAR(MAX) NOT NULL,
    after_json     NVARCHAR(MAX) NOT NULL,
    extra_collected DECIMAL(10,2) NOT NULL DEFAULT 0,
    refund_due     DECIMAL(10,2) NOT NULL DEFAULT 0,
    revised_by     BIGINT NULL REFERENCES dbo.users(id),
    revised_at     DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_invoice_revisions_invoice' AND object_id = OBJECT_ID('dbo.invoice_revisions'))
CREATE INDEX ix_invoice_revisions_invoice ON dbo.invoice_revisions(invoice_id);
GO
