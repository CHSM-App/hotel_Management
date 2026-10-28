-- Other services (laundry, private pool, gaming ...) sold per use from the
-- rooms side, billed like restaurant food: use -> completed (ready to bill) ->
-- added to a room bill or billed on its own invoice.
--
-- lodge_services is the catalogue. service_usages is one use, with name, price
-- and GST rate snapshotted so re-pricing the catalogue never restates a use.
-- Prices are GST-inclusive like every other price here.
--
-- invoice_id marks a use as billed; on_room_bill + booking_id mean it rides on
-- that stay's bill. voided_invoice_id mirrors food_orders (migration 060).

IF OBJECT_ID('dbo.lodge_services', 'U') IS NULL
CREATE TABLE dbo.lodge_services (
    id               BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id         BIGINT NOT NULL REFERENCES dbo.lodges(id),
    name             NVARCHAR(100) NOT NULL,
    unit_label       NVARCHAR(30) NOT NULL DEFAULT 'use',
    price            DECIMAL(10,2) NOT NULL CONSTRAINT ck_lodge_services_price CHECK (price >= 0),
    gst_rate_percent DECIMAL(5,2) NOT NULL DEFAULT 18,
    is_active        BIT NOT NULL DEFAULT 1,
    created_at       DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

IF OBJECT_ID('dbo.service_usages', 'U') IS NULL
CREATE TABLE dbo.service_usages (
    id                BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id          BIGINT NOT NULL REFERENCES dbo.lodges(id),
    service_id        BIGINT NULL REFERENCES dbo.lodge_services(id),
    service_name      NVARCHAR(100) NOT NULL,
    unit_label        NVARCHAR(30) NOT NULL,
    unit_price        DECIMAL(10,2) NOT NULL,
    gst_rate_percent  DECIMAL(5,2) NOT NULL,
    quantity          DECIMAL(8,2) NOT NULL CONSTRAINT ck_service_usages_qty CHECK (quantity > 0),
    line_total        DECIMAL(10,2) NOT NULL,
    room_id           BIGINT NULL REFERENCES dbo.rooms(id),
    booking_id        BIGINT NULL REFERENCES dbo.bookings(id),
    guest_name        NVARCHAR(200) NULL,
    guest_phone       NVARCHAR(20) NULL,
    note              NVARCHAR(300) NULL,
    status            NVARCHAR(12) NOT NULL DEFAULT 'IN_USE'
        CONSTRAINT ck_service_usages_status CHECK (status IN ('IN_USE', 'COMPLETED', 'CANCELLED')),
    on_room_bill      BIT NOT NULL CONSTRAINT df_service_usages_on_room_bill DEFAULT 0,
    invoice_id        BIGINT NULL REFERENCES dbo.invoices(id),
    voided_invoice_id BIGINT NULL REFERENCES dbo.invoices(id),
    started_at        DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    completed_at      DATETIMEOFFSET NULL,
    created_by        BIGINT NULL REFERENCES dbo.users(id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_service_usages_lodge' AND object_id = OBJECT_ID('dbo.service_usages'))
    CREATE INDEX ix_service_usages_lodge ON dbo.service_usages(lodge_id, status, started_at);
GO

-- The services side of an issued bill, kept apart from room and food because
-- it is its own supply (GSTR-1 reports them separately).
IF COL_LENGTH('dbo.invoices', 'service_subtotal') IS NULL
    EXEC('ALTER TABLE dbo.invoices ADD service_subtotal DECIMAL(10,2) NOT NULL CONSTRAINT df_invoices_service_subtotal DEFAULT 0');
GO
IF COL_LENGTH('dbo.invoices', 'service_cgst_amount') IS NULL
    EXEC('ALTER TABLE dbo.invoices ADD service_cgst_amount DECIMAL(10,2) NOT NULL CONSTRAINT df_invoices_service_cgst DEFAULT 0');
GO
IF COL_LENGTH('dbo.invoices', 'service_sgst_amount') IS NULL
    EXEC('ALTER TABLE dbo.invoices ADD service_sgst_amount DECIMAL(10,2) NOT NULL CONSTRAINT df_invoices_service_sgst DEFAULT 0');
GO
