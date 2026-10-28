-- Other Income module
--
-- Full mirror of Expenses (076/079/080/081), the same shape reversed: money
-- coming in that isn't room/food/function billing — interest, scrap sale,
-- rent from a shop on the property, a refund received, etc. Feeds the P/L
-- report as its own revenue line, separate from the invoice-driven room/
-- food/function figures.

IF OBJECT_ID('dbo.income_categories', 'U') IS NULL
CREATE TABLE dbo.income_categories (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id    BIGINT NOT NULL REFERENCES dbo.lodges(id),
    name        NVARCHAR(80) NOT NULL,
    is_active   BIT NOT NULL DEFAULT 1,
    created_at  DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_income_categories_lodge_name UNIQUE (lodge_id, name)
);
GO

-- A repeat receipt the property expects on a schedule — a shop's monthly
-- rent, a recurring service fee. Same "schedule, not a commitment to an
-- amount" split as expense_recurring_templates: the actual amount received
-- is entered each time it's logged.
IF OBJECT_ID('dbo.income_recurring_templates', 'U') IS NULL
CREATE TABLE dbo.income_recurring_templates (
    id                  BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id            BIGINT NOT NULL REFERENCES dbo.lodges(id),
    category_id         BIGINT NOT NULL REFERENCES dbo.income_categories(id),
    payer_id            BIGINT NULL REFERENCES dbo.vendors(id),
    title               NVARCHAR(120) NOT NULL,
    frequency           NVARCHAR(20) NOT NULL,
    next_due_date       DATE NOT NULL,
    is_active           BIT NOT NULL DEFAULT 1,
    created_at          DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT ck_income_templates_frequency CHECK (frequency IN ('MONTHLY', 'QUARTERLY', 'YEARLY'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_income_templates_lodge' AND object_id = OBJECT_ID('dbo.income_recurring_templates'))
CREATE INDEX ix_income_templates_lodge ON dbo.income_recurring_templates(lodge_id, is_active, next_due_date);
GO

-- payer_id reuses dbo.vendors as a generic payee/payer directory — same
-- reuse Assets and Expenses already make of it (see 068_vendors.sql), so a
-- "vendor" who is really someone paying the hotel doesn't need a second,
-- parallel contacts table.
IF OBJECT_ID('dbo.income_entries', 'U') IS NULL
CREATE TABLE dbo.income_entries (
    id                      BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id                BIGINT NOT NULL REFERENCES dbo.lodges(id),
    category_id             BIGINT NOT NULL REFERENCES dbo.income_categories(id),
    payer_id                BIGINT NULL REFERENCES dbo.vendors(id),
    recurring_template_id   BIGINT NULL REFERENCES dbo.income_recurring_templates(id),
    title                   NVARCHAR(120) NOT NULL,
    description             NVARCHAR(400) NULL,
    amount                  DECIMAL(12,2) NOT NULL,
    payment_method          NVARCHAR(20) NOT NULL,
    payment_status          NVARCHAR(10) NOT NULL
        CONSTRAINT df_income_entries_payment_status DEFAULT 'PAID'
        CONSTRAINT ck_income_entries_payment_status CHECK (payment_status IN ('PAID', 'PARTIAL', 'PENDING')),
    amount_received         DECIMAL(12,2) NULL,
    income_date             DATE NOT NULL,
    -- The uploaded receipt/proof's generated filename — same shape as
    -- dbo.expenses.bill_document. Served through GET /income/:id/receipt.
    receipt_document        NVARCHAR(255) NULL,
    created_by              BIGINT NULL REFERENCES dbo.users(id),
    created_at              DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    updated_at              DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT ck_income_entries_payment_method CHECK (payment_method IN ('CASH', 'UPI', 'CARD', 'CHEQUE', 'BANK_TRANSFER', 'WALLET', 'OTHER')),
    CONSTRAINT ck_income_entries_amount CHECK (amount >= 0)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_income_entries_lodge' AND object_id = OBJECT_ID('dbo.income_entries'))
CREATE INDEX ix_income_entries_lodge ON dbo.income_entries(lodge_id, income_date DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_income_entries_category' AND object_id = OBJECT_ID('dbo.income_entries'))
CREATE INDEX ix_income_entries_category ON dbo.income_entries(category_id);
GO

-- One receipt can be settled in more than one instalment — same reasoning
-- as dbo.expense_payments. amount_received on income_entries is a running
-- total kept in sync by the service layer.
IF OBJECT_ID('dbo.income_receipts', 'U') IS NULL
CREATE TABLE dbo.income_receipts (
    id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    income_id       BIGINT NOT NULL REFERENCES dbo.income_entries(id) ON DELETE CASCADE,
    amount          DECIMAL(12,2) NOT NULL
        CONSTRAINT ck_income_receipts_amount CHECK (amount > 0),
    payment_method  NVARCHAR(20) NOT NULL
        CONSTRAINT ck_income_receipts_method CHECK (payment_method IN ('CASH', 'UPI', 'CARD', 'CHEQUE', 'BANK_TRANSFER', 'WALLET', 'OTHER')),
    reference_number NVARCHAR(80) NULL,
    received_date   DATE NOT NULL,
    created_at      DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_income_receipts_income' AND object_id = OBJECT_ID('dbo.income_receipts'))
CREATE INDEX ix_income_receipts_income ON dbo.income_receipts(income_id);
GO
