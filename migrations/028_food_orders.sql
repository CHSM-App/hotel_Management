-- food_orders
--
-- One table per migration, in foreign-key dependency order: this file is
-- 25 of 32 that together build the database from nothing. The number is
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

-- ---------------------------------------------------------------------------
-- Food orders (after invoices — food_orders.invoice_id references them)
-- ---------------------------------------------------------------------------

-- One order, from the room food link, a table QR, or typed in at the counter.
--
-- PENDING exists only for table orders: a table QR has no booking behind it, so
-- anyone who has ever scanned it could order from anywhere. Rather than gate
-- that with a login the guest doesn't have, a table order waits for the kitchen
-- to accept it before it becomes a ticket. Room orders clear the booking PIN
-- before they are written at all, so they start at QUEUED.
--
-- booking_id is captured at placement so a later check-out can't orphan the
-- charge — folio posting needs to know which stay owes for it.
--
-- public_token is how a guest's own phone follows their order to the pass. It
-- replaces looking a status up by (room number, order number), which was itself
-- an "is room 12 ordering food right now?" oracle on an unauthenticated
-- endpoint. Random and opaque, so holding one tells you nothing about any other.
--
-- invoice_id marks an order as billed. It is what stops a second "close table"
-- sweeping the same orders onto a second document, and what a void puts back.
IF OBJECT_ID('dbo.food_orders', 'U') IS NULL
CREATE TABLE dbo.food_orders (
    id             BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id       BIGINT NOT NULL REFERENCES dbo.lodges(id),
    order_date     DATE NOT NULL,
    order_number   INT NOT NULL,
    source         NVARCHAR(10) NOT NULL
        CONSTRAINT ck_food_orders_source CHECK (source IN ('ROOM', 'TABLE', 'COUNTER')),
    room_id        BIGINT NULL REFERENCES dbo.rooms(id),
    booking_id     BIGINT NULL REFERENCES dbo.bookings(id),
    table_id       BIGINT NULL REFERENCES dbo.dining_tables(id),
    invoice_id     BIGINT NULL REFERENCES dbo.invoices(id),
    public_token   NVARCHAR(32) NULL,
    guest_name     NVARCHAR(200) NULL,
    guest_phone    NVARCHAR(20) NULL,
    note           NVARCHAR(300) NULL,
    status         NVARCHAR(12) NOT NULL DEFAULT 'PENDING'
        CONSTRAINT ck_food_orders_status CHECK (status IN ('PENDING', 'QUEUED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED')),
    subtotal       DECIMAL(10,2) NOT NULL DEFAULT 0,
    placed_at      DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    accepted_at    DATETIMEOFFSET NULL,
    ready_at       DATETIMEOFFSET NULL,
    delivered_at   DATETIMEOFFSET NULL,
    cancelled_at   DATETIMEOFFSET NULL,
    cancel_reason  NVARCHAR(200) NULL,
    created_by     BIGINT NULL REFERENCES dbo.users(id),
    CONSTRAINT uq_food_orders_number UNIQUE (lodge_id, order_date, order_number),
    -- A room order without a room, or a table order without a table, is a bug
    -- that would reach the kitchen as an unservable ticket. Caught here.
    CONSTRAINT ck_food_orders_target CHECK (
        (source = 'ROOM'  AND room_id IS NOT NULL AND table_id IS NULL) OR
        (source = 'TABLE' AND table_id IS NOT NULL AND room_id IS NULL) OR
        (source = 'COUNTER' AND room_id IS NULL AND table_id IS NULL)
    )
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_food_orders_queue' AND object_id = OBJECT_ID('dbo.food_orders'))
    CREATE INDEX ix_food_orders_queue ON dbo.food_orders(lodge_id, status, placed_at);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_food_orders_date' AND object_id = OBJECT_ID('dbo.food_orders'))
    CREATE INDEX ix_food_orders_date ON dbo.food_orders(lodge_id, order_date);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_food_orders_public_token' AND object_id = OBJECT_ID('dbo.food_orders'))
    CREATE UNIQUE INDEX ix_food_orders_public_token ON dbo.food_orders(public_token) WHERE public_token IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_food_orders_invoice' AND object_id = OBJECT_ID('dbo.food_orders'))
    CREATE INDEX ix_food_orders_invoice ON dbo.food_orders(invoice_id) WHERE invoice_id IS NOT NULL;
GO
