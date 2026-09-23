-- expenses
--
-- New Expense Management module. Guarded, so applying this to a database
-- that already has these tables is a no-op.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- dbo.vendors already exists (068_vendors.sql) and is generic enough — name,
-- contact, phone, email, specialty, notes — to serve as the shared payee
-- directory both Assets and Expenses use. No schema change needed here; this
-- migration just stops treating it as Assets-owned.

-- A real table rather than a fixed enum, same reasoning as asset_categories:
-- an owner adds hotel-specific categories without a migration. Left empty by
-- default — a category exists once it's typed or picked from a suggestion
-- list in the expense form and used to save an expense, same as Assets.
IF OBJECT_ID('dbo.expense_categories', 'U') IS NULL
CREATE TABLE dbo.expense_categories (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id    BIGINT NOT NULL REFERENCES dbo.lodges(id),
    name        NVARCHAR(80) NOT NULL,
    is_active   BIT NOT NULL DEFAULT 1,
    created_at  DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_expense_categories_lodge_name UNIQUE (lodge_id, name)
);
GO

-- A recurring cost the property pays on a schedule — rent, electricity, a
-- monthly AMC — modeled separately from the expense it produces so editing
-- "how much the electricity bill usually is" doesn't rewrite history for
-- every month already logged. generateDueExpenses() in expenses.service.js
-- turns a due template into one dbo.expenses row and advances next_due_date.
IF OBJECT_ID('dbo.expense_recurring_templates', 'U') IS NULL
CREATE TABLE dbo.expense_recurring_templates (
    id                  BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id            BIGINT NOT NULL REFERENCES dbo.lodges(id),
    category_id         BIGINT NOT NULL REFERENCES dbo.expense_categories(id),
    vendor_id           BIGINT NULL REFERENCES dbo.vendors(id),
    title               NVARCHAR(120) NOT NULL,
    amount              DECIMAL(12,2) NOT NULL,
    frequency           NVARCHAR(20) NOT NULL,
    next_due_date       DATE NOT NULL,
    is_active           BIT NOT NULL DEFAULT 1,
    created_at          DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT ck_expense_templates_frequency CHECK (frequency IN ('MONTHLY', 'QUARTERLY', 'YEARLY'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_expense_templates_lodge' AND object_id = OBJECT_ID('dbo.expense_recurring_templates'))
CREATE INDEX ix_expense_templates_lodge ON dbo.expense_recurring_templates(lodge_id, is_active, next_due_date);
GO

-- The actual ledger of what the property spent. payment_method reuses the
-- exact CASH/UPI/CARD vocabulary payment_lines already established (043) —
-- one enum for "how money moved" across the whole app, not a second one
-- Expenses invents on its own.
IF OBJECT_ID('dbo.expenses', 'U') IS NULL
CREATE TABLE dbo.expenses (
    id                      BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id                BIGINT NOT NULL REFERENCES dbo.lodges(id),
    category_id             BIGINT NOT NULL REFERENCES dbo.expense_categories(id),
    vendor_id               BIGINT NULL REFERENCES dbo.vendors(id),
    recurring_template_id   BIGINT NULL REFERENCES dbo.expense_recurring_templates(id),
    title                   NVARCHAR(120) NOT NULL,
    description             NVARCHAR(400) NULL,
    amount                  DECIMAL(12,2) NOT NULL,
    payment_method          NVARCHAR(10) NOT NULL,
    expense_date            DATE NOT NULL,
    -- Stores the uploaded receipt's filename (a UUID the upload middleware
    -- generated), never the original filename or a path — same reasoning as
    -- dbo.assets.bill_document. The file itself lives outside any
    -- statically-served directory; access goes through the authenticated
    -- GET /expenses/:id/bill route.
    bill_document           NVARCHAR(255) NULL,
    created_by              BIGINT NULL REFERENCES dbo.users(id),
    created_at              DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    updated_at              DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT ck_expenses_payment_method CHECK (payment_method IN ('CASH', 'UPI', 'CARD')),
    CONSTRAINT ck_expenses_amount CHECK (amount >= 0)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_expenses_lodge' AND object_id = OBJECT_ID('dbo.expenses'))
CREATE INDEX ix_expenses_lodge ON dbo.expenses(lodge_id, expense_date DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_expenses_category' AND object_id = OBJECT_ID('dbo.expenses'))
CREATE INDEX ix_expenses_category ON dbo.expenses(category_id);
GO
