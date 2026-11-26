-- What an outside laundry charged for a batch. Optional: entered when linen is
-- sent or when it comes back, only where the washing is done by a vendor.
--
-- A batch is several movement rows (one per linen item) and the charge is for
-- the batch, so it is written on the batch's first row and left NULL on the
-- rest. Summing the column gives the total; nothing should average it.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.linen_movements', 'wash_charge') IS NULL
    EXEC('ALTER TABLE dbo.linen_movements ADD wash_charge DECIMAL(10,2) NULL
            CONSTRAINT ck_linen_movements_wash_charge CHECK (wash_charge IS NULL OR wash_charge >= 0)');
GO
