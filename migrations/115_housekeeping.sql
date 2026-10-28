-- Housekeeping: room cleaning status, hotel linen stock, and guest laundry.
--
-- Nothing here changes check-in or check-out. A room is DIRTY when its latest
-- check-out (booking_rooms.actual_check_out_at) is newer than last_cleaned_at,
-- so the status is derived from data the existing flow already writes.
--
-- housekeeping_rooms holds only what housekeeping itself decides: when the room
-- was last cleaned, a manual "needs cleaning" mark, who is cleaning it now, and
-- out-of-order. Rows are created lazily the first time the board is opened, with
-- last_cleaned_at = now, so enabling the section never floods it with rooms that
-- were checked out months ago.
--
-- linen_movements is an append-only ledger; stock is derived from it:
--   dirty      = CHANGED - SENT
--   in laundry = SENT - RECEIVED - (LOST/DAMAGED from the laundry)
--   owned      = total_owned - (all LOST/DAMAGED)
--
-- laundry_orders is a guest's personal laundry. When it is DELIVERED, one
-- completed service_usages row per garment line is written (laundry_order_id
-- links them), so it is billed through the existing Other services flow.

IF OBJECT_ID('dbo.housekeeping_rooms', 'U') IS NULL
CREATE TABLE dbo.housekeeping_rooms (
    room_id             BIGINT NOT NULL PRIMARY KEY REFERENCES dbo.rooms(id),
    lodge_id            BIGINT NOT NULL REFERENCES dbo.lodges(id),
    last_cleaned_at     DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    needs_cleaning      BIT NOT NULL DEFAULT 0,
    cleaning_started_at DATETIMEOFFSET NULL,
    cleaning_by         BIGINT NULL REFERENCES dbo.users(id),
    out_of_order        BIT NOT NULL DEFAULT 0,
    out_of_order_note   NVARCHAR(300) NULL
);
GO

IF OBJECT_ID('dbo.housekeeping_log', 'U') IS NULL
CREATE TABLE dbo.housekeeping_log (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id    BIGINT NOT NULL REFERENCES dbo.lodges(id),
    room_id     BIGINT NOT NULL REFERENCES dbo.rooms(id),
    cleaned_by  BIGINT NULL REFERENCES dbo.users(id),
    started_at  DATETIMEOFFSET NOT NULL,
    done_at     DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    issues      NVARCHAR(500) NULL,
    lost_found  NVARCHAR(500) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_housekeeping_log_lodge' AND object_id = OBJECT_ID('dbo.housekeeping_log'))
    CREATE INDEX ix_housekeeping_log_lodge ON dbo.housekeeping_log(lodge_id, done_at);
GO

IF OBJECT_ID('dbo.linen_items', 'U') IS NULL
CREATE TABLE dbo.linen_items (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id    BIGINT NOT NULL REFERENCES dbo.lodges(id),
    name        NVARCHAR(80) NOT NULL,
    total_owned INT NOT NULL DEFAULT 0 CONSTRAINT ck_linen_items_owned CHECK (total_owned >= 0),
    is_active   BIT NOT NULL DEFAULT 1
);
GO

IF OBJECT_ID('dbo.linen_movements', 'U') IS NULL
CREATE TABLE dbo.linen_movements (
    id             BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id       BIGINT NOT NULL REFERENCES dbo.lodges(id),
    linen_item_id  BIGINT NOT NULL REFERENCES dbo.linen_items(id),
    kind           NVARCHAR(10) NOT NULL
        CONSTRAINT ck_linen_movements_kind CHECK (kind IN ('CHANGED', 'SENT', 'RECEIVED', 'LOST', 'DAMAGED')),
    source         NVARCHAR(10) NULL
        CONSTRAINT ck_linen_movements_source CHECK (source IS NULL OR source IN ('LAUNDRY', 'STORE')),
    quantity       INT NOT NULL CONSTRAINT ck_linen_movements_qty CHECK (quantity > 0),
    room_id        BIGINT NULL REFERENCES dbo.rooms(id),
    note           NVARCHAR(300) NULL,
    created_by     BIGINT NULL REFERENCES dbo.users(id),
    created_at     DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_linen_movements_item' AND object_id = OBJECT_ID('dbo.linen_movements'))
    CREATE INDEX ix_linen_movements_item ON dbo.linen_movements(lodge_id, linen_item_id);
GO

IF OBJECT_ID('dbo.laundry_orders', 'U') IS NULL
CREATE TABLE dbo.laundry_orders (
    id            BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id      BIGINT NOT NULL REFERENCES dbo.lodges(id),
    tag_number    INT NOT NULL,
    room_id       BIGINT NULL REFERENCES dbo.rooms(id),
    booking_id    BIGINT NULL REFERENCES dbo.bookings(id),
    guest_name    NVARCHAR(200) NULL,
    guest_phone   NVARCHAR(20) NULL,
    note          NVARCHAR(300) NULL,
    status        NVARCHAR(12) NOT NULL DEFAULT 'RECEIVED'
        CONSTRAINT ck_laundry_orders_status CHECK (status IN ('RECEIVED', 'WASHING', 'READY', 'DELIVERED', 'CANCELLED')),
    received_at   DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    delivered_at  DATETIMEOFFSET NULL,
    created_by    BIGINT NULL REFERENCES dbo.users(id),
    CONSTRAINT uq_laundry_orders_tag UNIQUE (lodge_id, tag_number)
);
GO

IF OBJECT_ID('dbo.laundry_order_items', 'U') IS NULL
CREATE TABLE dbo.laundry_order_items (
    id                BIGINT IDENTITY(1,1) PRIMARY KEY,
    order_id          BIGINT NOT NULL REFERENCES dbo.laundry_orders(id),
    service_id        BIGINT NOT NULL REFERENCES dbo.lodge_services(id),
    item_name         NVARCHAR(100) NOT NULL,
    unit_label        NVARCHAR(30) NOT NULL,
    unit_price        DECIMAL(10,2) NOT NULL,
    gst_rate_percent  DECIMAL(5,2) NOT NULL,
    quantity          INT NOT NULL CONSTRAINT ck_laundry_order_items_qty CHECK (quantity > 0)
);
GO

-- A garment (shirt, saree ...) is a catalogue service flagged as laundry, so its
-- price and GST live where every other service's do.
IF COL_LENGTH('dbo.lodge_services', 'is_laundry') IS NULL
    EXEC('ALTER TABLE dbo.lodge_services ADD is_laundry BIT NOT NULL CONSTRAINT df_lodge_services_is_laundry DEFAULT 0');
GO

IF COL_LENGTH('dbo.service_usages', 'laundry_order_id') IS NULL
    EXEC('ALTER TABLE dbo.service_usages ADD laundry_order_id BIGINT NULL REFERENCES dbo.laundry_orders(id)');
GO
