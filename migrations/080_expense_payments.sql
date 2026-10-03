-- expense_payments
--
-- A bill isn't always settled in one transaction — part cash today, the rest
-- by UPI next week. Each row here is one such payment against one expense;
-- dbo.expenses.amount_paid (added in 079) becomes a running total kept in
-- sync by the service layer rather than a value typed directly, and
-- payment_status is derived from it (>=amount -> PAID, >0 -> PARTIAL, else
-- PENDING) instead of being its own form field.

IF OBJECT_ID('dbo.expense_payments', 'U') IS NULL
CREATE TABLE dbo.expense_payments (
    id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    expense_id      BIGINT NOT NULL REFERENCES dbo.expenses(id) ON DELETE CASCADE,
    amount          DECIMAL(12,2) NOT NULL
        CONSTRAINT ck_expense_payments_amount CHECK (amount > 0),
    payment_method  NVARCHAR(10) NOT NULL
        CONSTRAINT ck_expense_payments_method CHECK (payment_method IN ('CASH', 'UPI', 'CARD')),
    paid_date       DATE NOT NULL,
    created_at      DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_expense_payments_expense' AND object_id = OBJECT_ID('dbo.expense_payments'))
CREATE INDEX ix_expense_payments_expense ON dbo.expense_payments(expense_id);
GO

-- Backfill: every expense already on file recorded its old single
-- payment_method/amount_paid as one implicit payment, dated to the expense
-- itself, so history reads the same under the new model. PENDING rows
-- (amount_paid = 0) get no row, same as a fresh PENDING expense would.
INSERT INTO dbo.expense_payments (expense_id, amount, payment_method, paid_date, created_at)
SELECT id, amount_paid, payment_method, expense_date, created_at
FROM dbo.expenses
WHERE amount_paid > 0
  AND NOT EXISTS (SELECT 1 FROM dbo.expense_payments WHERE expense_id = dbo.expenses.id);
GO
