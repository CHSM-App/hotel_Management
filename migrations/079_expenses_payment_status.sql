-- expenses.payment_status / amount_paid
--
-- Not every bill is settled the day it's logged — a vendor invoice can sit
-- partially paid or fully pending. amount stays "what this expense costs"
-- (summaries and totals keep summing it unchanged); amount_paid is only
-- meaningful when payment_status = 'PARTIAL', and defaults to the full
-- amount for 'PAID' rows already on file so existing data reads as settled.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.expenses') AND name = 'payment_status')
ALTER TABLE dbo.expenses ADD payment_status NVARCHAR(10) NOT NULL
    CONSTRAINT df_expenses_payment_status DEFAULT 'PAID'
    CONSTRAINT ck_expenses_payment_status CHECK (payment_status IN ('PAID', 'PARTIAL', 'PENDING'));
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.expenses') AND name = 'amount_paid')
ALTER TABLE dbo.expenses ADD amount_paid DECIMAL(12,2) NULL;
GO

-- Backfill: every row already on file predates this column and was, by the
-- old single-status model, fully paid.
UPDATE dbo.expenses SET amount_paid = amount WHERE amount_paid IS NULL;
GO
