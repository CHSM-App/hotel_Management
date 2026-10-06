-- Who washes a guest's laundry order, and what an outside vendor charges the
-- lodge for it — the same two facts hotel linen records per batch (119, 122).
-- Both optional, set when the order goes to be washed.
--
-- wash_charge is the lodge's cost. It is not what the guest pays: that is the
-- order's garment lines, and nothing here changes a bill.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.laundry_orders', 'washed_by') IS NULL
    EXEC('ALTER TABLE dbo.laundry_orders ADD
            washed_by   NVARCHAR(100) NULL,
            wash_charge DECIMAL(10,2) NULL
              CONSTRAINT ck_laundry_orders_wash_charge CHECK (wash_charge IS NULL OR wash_charge >= 0)');
GO
