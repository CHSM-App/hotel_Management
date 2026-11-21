-- expense_recurring_templates.amount: no longer NOT NULL
--
-- A template is a repeat schedule (title, category, frequency, a reminder
-- due date), not a fixed cost — how much rent/electricity/salaries actually
-- runs is entered each cycle, when the desk logs that occurrence, not
-- guessed once at template-creation time. Nothing auto-generates from a
-- template any more (see logRecurringOccurrence in expenses.service.js
-- replacing generateDueExpenses), so amount here would only ever have been
-- a stale guess anyway.

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.expense_recurring_templates') AND name = 'amount' AND is_nullable = 0
)
ALTER TABLE dbo.expense_recurring_templates ALTER COLUMN amount DECIMAL(12,2) NULL;
GO
