-- Bar module (163). Separate from the restaurant on purpose: own menu, orders,
-- bills and stock, so no restaurant report (food-orders, GST, collections,
-- P&L) ever sees a bar sale. Stock is kept only in ml; bottles are derived.
-- Remember: the same change must also land in src/config/schema.sql.

-- Owner roles get the bar permissions once, together with the column, so an
-- owner who later removes one is not overruled on a re-run.
IF COL_LENGTH('dbo.lodges', 'has_bar') IS NULL
BEGIN
    EXEC('ALTER TABLE dbo.lodges ADD has_bar BIT NOT NULL CONSTRAINT df_lodges_has_bar DEFAULT 0');
    UPDATE dbo.roles
    SET permissions = LEFT(permissions, LEN(permissions) - 1) + ',"bar.manage","bar.bill","bar.report"]'
    WHERE role_key = 'OWNER' AND permissions LIKE '%]' AND permissions NOT LIKE '%"bar.manage"%';
END

-- Bar tax % (alcohol is excise/VAT, not GST, so it is a plain per-lodge rate,
-- prices are tax-inclusive) and the low-stock limit used when a product has none.
IF COL_LENGTH('dbo.lodges', 'bar_tax_percent') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD bar_tax_percent DECIMAL(5,2) NOT NULL CONSTRAINT df_lodges_bar_tax DEFAULT 0');
IF COL_LENGTH('dbo.lodges', 'bar_default_low_stock_ml') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD bar_default_low_stock_ml INT NULL');

IF OBJECT_ID('dbo.bar_categories', 'U') IS NULL
CREATE TABLE dbo.bar_categories (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id    BIGINT NOT NULL REFERENCES dbo.lodges(id),
    name        NVARCHAR(100) NOT NULL,
    sort_order  INT NOT NULL DEFAULT 0,
    is_active   BIT NOT NULL DEFAULT 1,
    CONSTRAINT uq_bar_categories UNIQUE (lodge_id, name)
);

-- One row per physical stock item (a bottle brand/size). stock_ml may go negative.
IF OBJECT_ID('dbo.bar_products', 'U') IS NULL
CREATE TABLE dbo.bar_products (
    id           BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id     BIGINT NOT NULL REFERENCES dbo.lodges(id),
    category_id  BIGINT NULL REFERENCES dbo.bar_categories(id),
    name         NVARCHAR(150) NOT NULL,
    brand        NVARCHAR(100) NULL,
    bottle_ml    INT NOT NULL CHECK (bottle_ml > 0),
    stock_ml     INT NOT NULL DEFAULT 0,
    low_stock_ml INT NULL,
    is_active    BIT NOT NULL DEFAULT 1,
    created_at   DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

-- A selling size of a product: 30 ml, 60 ml, Half, Full ...
IF OBJECT_ID('dbo.bar_menu_items', 'U') IS NULL
CREATE TABLE dbo.bar_menu_items (
    id            BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id      BIGINT NOT NULL REFERENCES dbo.lodges(id),
    product_id    BIGINT NOT NULL REFERENCES dbo.bar_products(id),
    size_label    NVARCHAR(50) NOT NULL,
    ml_per_unit   INT NOT NULL CHECK (ml_per_unit > 0),
    price         DECIMAL(10,2) NOT NULL CHECK (price >= 0),
    is_available  BIT NOT NULL DEFAULT 1,
    is_active     BIT NOT NULL DEFAULT 1
);

IF OBJECT_ID('dbo.bar_stock_movements', 'U') IS NULL
CREATE TABLE dbo.bar_stock_movements (
    id             BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id       BIGINT NOT NULL REFERENCES dbo.lodges(id),
    product_id     BIGINT NOT NULL REFERENCES dbo.bar_products(id),
    change_ml      INT NOT NULL,
    balance_after  INT NOT NULL,
    reason         NVARCHAR(20) NOT NULL
                   CHECK (reason IN ('OPENING','PURCHASE','SALE','ADJUSTMENT','WASTAGE','REVERSAL')),
    ref_order_id   BIGINT NULL,
    note           NVARCHAR(200) NULL,
    created_by     BIGINT NULL,
    created_at     DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

IF OBJECT_ID('dbo.bar_orders', 'U') IS NULL
CREATE TABLE dbo.bar_orders (
    id                   BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id             BIGINT NOT NULL REFERENCES dbo.lodges(id),
    order_date           DATE NOT NULL,
    order_number         INT NOT NULL,
    source               NVARCHAR(10) NOT NULL CHECK (source IN ('COUNTER','TABLE','ROOM')),
    table_id             BIGINT NULL,
    room_id              BIGINT NULL,
    booking_id           BIGINT NULL,
    restaurant_order_id  BIGINT NULL,
    guest_name           NVARCHAR(100) NULL,
    guest_phone          NVARCHAR(20) NULL,
    status               NVARCHAR(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','BILLED','CANCELLED')),
    subtotal             DECIMAL(10,2) NOT NULL DEFAULT 0,
    bill_id              BIGINT NULL,
    created_by           BIGINT NULL,
    created_at           DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

IF OBJECT_ID('dbo.bar_order_items', 'U') IS NULL
CREATE TABLE dbo.bar_order_items (
    id             BIGINT IDENTITY(1,1) PRIMARY KEY,
    order_id       BIGINT NOT NULL REFERENCES dbo.bar_orders(id),
    menu_item_id   BIGINT NOT NULL REFERENCES dbo.bar_menu_items(id),
    product_id     BIGINT NOT NULL REFERENCES dbo.bar_products(id),
    item_name      NVARCHAR(200) NOT NULL,
    size_label     NVARCHAR(50) NOT NULL,
    ml_per_unit    INT NOT NULL,
    unit_price     DECIMAL(10,2) NOT NULL,
    quantity       INT NOT NULL CHECK (quantity > 0),
    line_total     DECIMAL(10,2) NOT NULL,
    is_cancelled   BIT NOT NULL DEFAULT 0
);

IF OBJECT_ID('dbo.bar_bills', 'U') IS NULL
CREATE TABLE dbo.bar_bills (
    id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    lodge_id        BIGINT NOT NULL REFERENCES dbo.lodges(id),
    bill_seq        INT NOT NULL,
    bill_date       DATE NOT NULL,
    subtotal        DECIMAL(10,2) NOT NULL,
    tax_percent     DECIMAL(5,2) NOT NULL,
    tax_amount      DECIMAL(10,2) NOT NULL,
    total           DECIMAL(10,2) NOT NULL,
    customer_name   NVARCHAR(100) NULL,
    customer_phone  NVARCHAR(20) NULL,
    created_by      BIGINT NULL,
    created_at      DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_bar_bills_seq UNIQUE (lodge_id, bill_seq)
);

IF OBJECT_ID('dbo.bar_bill_payments', 'U') IS NULL
CREATE TABLE dbo.bar_bill_payments (
    id         BIGINT IDENTITY(1,1) PRIMARY KEY,
    bill_id    BIGINT NOT NULL REFERENCES dbo.bar_bills(id),
    method     NVARCHAR(10) NOT NULL CHECK (method IN ('CASH','UPI','CARD')),
    amount     DECIMAL(10,2) NOT NULL CHECK (amount > 0),
    reference  NVARCHAR(100) NULL
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_bar_orders_lodge' AND object_id = OBJECT_ID('dbo.bar_orders'))
CREATE INDEX ix_bar_orders_lodge ON dbo.bar_orders(lodge_id, status, order_date);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_bar_moves_product' AND object_id = OBJECT_ID('dbo.bar_stock_movements'))
CREATE INDEX ix_bar_moves_product ON dbo.bar_stock_movements(product_id, id DESC);
