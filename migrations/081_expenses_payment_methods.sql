-- expenses.payment_method / expense_payments.payment_method: wider vocabulary
-- expense_payments.reference_number: cheque no. / UTR / txn ID, by type
--
-- CASH/UPI/CARD was too narrow for what actually shows up on a hotel's
-- vendor bills — a cheque, an NEFT/RTGS transfer, a wallet payment, or
-- something that doesn't fit any of those. reference_number is free text
-- whose meaning depends on payment_method (cheque number, UTR, transaction
-- ID, ...) — the frontend picks the label, this column just stores it.
-- Optional throughout: CASH has nothing to reference, and a reference isn't
-- always on hand even for a method that usually has one.
--
-- NVARCHAR(10) -> (20): 'BANK_TRANSFER' (13 chars) doesn't fit the old width.

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_expenses_payment_method')
    ALTER TABLE dbo.expenses DROP CONSTRAINT ck_expenses_payment_method;
GO
ALTER TABLE dbo.expenses ALTER COLUMN payment_method NVARCHAR(20) NOT NULL;
GO
ALTER TABLE dbo.expenses ADD CONSTRAINT ck_expenses_payment_method
    CHECK (payment_method IN ('CASH', 'UPI', 'CARD', 'CHEQUE', 'BANK_TRANSFER', 'WALLET', 'OTHER'));
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_expense_payments_method')
    ALTER TABLE dbo.expense_payments DROP CONSTRAINT ck_expense_payments_method;
GO
ALTER TABLE dbo.expense_payments ALTER COLUMN payment_method NVARCHAR(20) NOT NULL;
GO
ALTER TABLE dbo.expense_payments ADD CONSTRAINT ck_expense_payments_method
    CHECK (payment_method IN ('CASH', 'UPI', 'CARD', 'CHEQUE', 'BANK_TRANSFER', 'WALLET', 'OTHER'));
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.expense_payments') AND name = 'reference_number')
ALTER TABLE dbo.expense_payments ADD reference_number NVARCHAR(80) NULL;
GO
