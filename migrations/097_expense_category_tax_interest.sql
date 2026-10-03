-- Interest / Income tax flags on expense categories
--
-- The multi-year P&L report needs Interest (loan EMI interest) and Tax
-- (income tax paid on profit) as their own rows — neither is derivable from
-- what's on file today. Rather than a keyword match against expense titles
-- (fragile — breaks the moment naming varies) an owner tags the category
-- once ("Bank Loan EMI" -> is_interest, "Income Tax" -> is_tax) and every
-- expense logged under it rolls into that row automatically, same pattern
-- as the WDV depreciation rate tagged onto asset categories (093).
--
-- Mutually exclusive by convention, not by constraint: a category is either
-- the interest row's source, the tax row's source, or neither (an ordinary
-- operating expense) — never both, since nothing is both at once. Left as
-- two nullable-default-0 bits rather than one enum column so a lodge that
-- never tags anything sees both flags simply absent, the same way
-- depreciation_rate_percent stays NULL until assigned.

IF COL_LENGTH('dbo.expense_categories', 'is_interest') IS NULL
ALTER TABLE dbo.expense_categories ADD is_interest BIT NOT NULL CONSTRAINT df_expense_categories_is_interest DEFAULT 0;
GO

IF COL_LENGTH('dbo.expense_categories', 'is_tax') IS NULL
ALTER TABLE dbo.expense_categories ADD is_tax BIT NOT NULL CONSTRAINT df_expense_categories_is_tax DEFAULT 0;
GO
