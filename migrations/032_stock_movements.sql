-- stock_movements
--
-- One table per migration, in foreign-key dependency order: this file is
-- 29 of 32 that together build the database from nothing. The number is
-- the order, so these must be applied in sequence — which the engine does.
--
-- Split out of the single baseline that preceded it; the SQL is unchanged and
-- was verified against SQL Server by building it into a scratch schema and
-- comparing the result to src/config/schema.sql.
--
-- Guarded, so applying this to a database that already has the table is a
-- no-op rather than an error.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- Every change to a material's quantity, signed, with what caused it. The
-- running quantity on raw_materials is the fast path for screens; this is the
-- record that explains it, and the only way anyone can answer "we bought 20 kg
-- on Tuesday, where did it go".
--
-- balance_after is written from the same UPDATE that moved the stock, so the
-- ledger reads correctly even though two cooks tick dishes off at once and the
-- rows do not arrive in a tidy order.
--
-- REVERSAL is a cook un-ticking a dish they ticked by mistake. It is a new row
-- adding the material back rather than a delete of the CONSUMPTION row: the
-- mistake is part of what happened, and a shift ticked wrong twice is worth
-- being able to see.
IF OBJECT_ID('dbo.stock_movements', 'U') IS NULL
CREATE TABLE dbo.stock_movements (
    id             BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id       BIGINT NOT NULL REFERENCES dbo.lodges(id),
    material_id    BIGINT NOT NULL REFERENCES dbo.raw_materials(id),
    change_qty     DECIMAL(12,3) NOT NULL,
    balance_after  DECIMAL(12,3) NOT NULL,
    reason         NVARCHAR(12) NOT NULL
        CONSTRAINT ck_stock_movements_reason CHECK (reason IN ('OPENING', 'PURCHASE', 'ADJUSTMENT', 'CONSUMPTION', 'REVERSAL')),
    order_id       BIGINT NULL REFERENCES dbo.food_orders(id),
    order_item_id  BIGINT NULL REFERENCES dbo.food_order_items(id),
    note           NVARCHAR(200) NULL,
    created_by     BIGINT NULL REFERENCES dbo.users(id),
    created_at     DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_stock_movements_material' AND object_id = OBJECT_ID('dbo.stock_movements'))
    CREATE INDEX ix_stock_movements_material ON dbo.stock_movements(lodge_id, material_id, id DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_stock_movements_order' AND object_id = OBJECT_ID('dbo.stock_movements'))
    CREATE INDEX ix_stock_movements_order ON dbo.stock_movements(order_id) WHERE order_id IS NOT NULL;
GO
