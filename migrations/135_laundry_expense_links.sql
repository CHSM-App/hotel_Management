-- expenses.laundry_order_id / expenses.linen_movement_id
--
-- Same "origin marker" pattern as expenses.asset_id (078): a nullable FK back
-- to whichever laundry/linen row generated this expense automatically, versus
-- NULL/NULL for a manually-typed expense. Two columns, not one, because the
-- vendor charge for a guest's own order lives on dbo.laundry_orders while the
-- hotel's own linen's wash cost lives on dbo.linen_movements — never both for
-- the same expense row.
--
-- Also backfills: every laundry_orders/linen_movements row that already has a
-- wash_charge from an outside vendor (not the 'own laundry' sentinel) gets a
-- matching dbo.expenses row under a new 'Laundry' category, one-time, so
-- payments made before this feature existed show up too. Safe to re-run —
-- every insert is guarded by a NOT EXISTS on the same origin column.
--
-- Remember: the same column change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.expenses', 'laundry_order_id') IS NULL
    EXEC('ALTER TABLE dbo.expenses ADD laundry_order_id BIGINT NULL REFERENCES dbo.laundry_orders(id)');
GO

IF COL_LENGTH('dbo.expenses', 'linen_movement_id') IS NULL
    EXEC('ALTER TABLE dbo.expenses ADD linen_movement_id BIGINT NULL REFERENCES dbo.linen_movements(id)');
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_expenses_laundry_order' AND object_id = OBJECT_ID('dbo.expenses'))
CREATE INDEX ix_expenses_laundry_order ON dbo.expenses(laundry_order_id) WHERE laundry_order_id IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_expenses_linen_movement' AND object_id = OBJECT_ID('dbo.expenses'))
CREATE INDEX ix_expenses_linen_movement ON dbo.expenses(linen_movement_id) WHERE linen_movement_id IS NOT NULL;
GO

-- One 'Laundry' category per lodge that has at least one row to backfill —
-- same find-or-create shape expenses.service.js's resolveLaundryExpenseCategoryId
-- uses going forward, so a lodge landing here from either path ends up
-- sharing the same category rather than two differently-cased duplicates.
INSERT INTO dbo.expense_categories (lodge_id, name)
SELECT DISTINCT o.lodge_id, N'Laundry'
FROM dbo.laundry_orders o
WHERE o.status <> 'CANCELLED' AND o.wash_charge > 0
  AND LOWER(LTRIM(RTRIM(o.washed_by))) <> 'own laundry'
  AND NOT EXISTS (
    SELECT 1 FROM dbo.expense_categories c WHERE c.lodge_id = o.lodge_id AND c.name = N'Laundry'
  );
GO

INSERT INTO dbo.expense_categories (lodge_id, name)
SELECT DISTINCT m.lodge_id, N'Laundry'
FROM dbo.linen_movements m
WHERE m.wash_charge > 0 AND (m.kind IN ('SENT', 'RECEIVED') OR m.source = 'LAUNDRY')
  AND LOWER(LTRIM(RTRIM(ISNULL(m.washed_by, '')))) NOT IN ('', 'own laundry')
  AND NOT EXISTS (
    SELECT 1 FROM dbo.expense_categories c WHERE c.lodge_id = m.lodge_id AND c.name = N'Laundry'
  );
GO

-- Backfill: guest laundry orders' vendor charge. expense_date matches what a
-- live call to logLaundryExpense would use at the time (delivered_at when
-- known — the same moment the matching guest revenue was billed — falling
-- back to received_at for an order that reached READY but was never
-- delivered).
INSERT INTO dbo.expenses (lodge_id, category_id, laundry_order_id, title, amount, payment_method, payment_status, amount_paid, expense_date)
SELECT
  o.lodge_id,
  c.id,
  o.id,
  N'Laundry vendor: ' + o.washed_by + N' (Tag #' + CAST(o.tag_number AS NVARCHAR(20)) + N')',
  o.wash_charge,
  'CASH',
  'PAID',
  o.wash_charge,
  CAST(COALESCE(o.delivered_at, o.received_at) AS DATE)
FROM dbo.laundry_orders o
JOIN dbo.expense_categories c ON c.lodge_id = o.lodge_id AND c.name = N'Laundry'
WHERE o.status <> 'CANCELLED' AND o.wash_charge > 0
  AND LOWER(LTRIM(RTRIM(o.washed_by))) <> 'own laundry'
  AND NOT EXISTS (SELECT 1 FROM dbo.expenses e WHERE e.laundry_order_id = o.id);
GO

-- Backfill: the hotel's own linen sent out to be washed. Same kind/source
-- filter getLaundryReport's byWasher.charge aggregation already uses
-- (reports.service.js), so the backfilled total matches what the Laundry
-- report has always shown as "charge" for that washer.
INSERT INTO dbo.expenses (lodge_id, category_id, linen_movement_id, title, amount, payment_method, payment_status, amount_paid, expense_date)
SELECT
  m.lodge_id,
  c.id,
  m.id,
  N'Linen wash: ' + m.washed_by,
  m.wash_charge,
  'CASH',
  'PAID',
  m.wash_charge,
  CAST(m.created_at AS DATE)
FROM dbo.linen_movements m
JOIN dbo.expense_categories c ON c.lodge_id = m.lodge_id AND c.name = N'Laundry'
WHERE m.wash_charge > 0 AND (m.kind IN ('SENT', 'RECEIVED') OR m.source = 'LAUNDRY')
  AND LOWER(LTRIM(RTRIM(ISNULL(m.washed_by, '')))) NOT IN ('', 'own laundry')
  AND NOT EXISTS (SELECT 1 FROM dbo.expenses e WHERE e.linen_movement_id = m.id);
GO
