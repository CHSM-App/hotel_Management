-- food_order_items
--
-- One table per migration, in foreign-key dependency order: this file is
-- 26 of 32 that together build the database from nothing. The number is
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

-- Name and price are snapshotted onto the line, not read back through
-- menu_item_id — the same "snapshot, never recompute" rule the nightly breakdown
-- follows. Re-pricing the menu at 6pm must not silently restate what a guest was
-- shown at noon. menu_item_id stays only as a soft link for reporting, and goes
-- NULL if the item is later deleted.
--
-- portion_label is snapshotted under the same rule. item_name is written as
-- "Masala Dosa (Half plate)" so the kitchen ticket, the bill and the reports all
-- read correctly without knowing the column exists; portion_label is the same
-- fact kept separately for anything that wants to group by size.
--
-- ready_at is a cook ticking each dish off as it leaves the pan; the order can
-- only be called ready once every line is ticked. Kept on the row rather than in
-- the screen's own state because the queue is polled and a busy kitchen works
-- one order from two tablets: a tick held in React would be wiped by the next
-- poll and would never reach the second screen at all.
IF OBJECT_ID('dbo.food_order_items', 'U') IS NULL
CREATE TABLE dbo.food_order_items (
    id                    BIGINT IDENTITY(1,1) PRIMARY KEY,
    order_id              BIGINT NOT NULL REFERENCES dbo.food_orders(id),
    menu_item_id          BIGINT NULL REFERENCES dbo.menu_items(id),
    menu_item_portion_id  BIGINT NULL REFERENCES dbo.menu_item_portions(id),
    item_name             NVARCHAR(150) NOT NULL,
    portion_label         NVARCHAR(60) NULL,
    unit_price            DECIMAL(10,2) NOT NULL,
    quantity              INT NOT NULL
        CONSTRAINT ck_food_order_items_quantity CHECK (quantity > 0),
    line_total            DECIMAL(10,2) NOT NULL,
    ready_at              DATETIMEOFFSET NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_food_order_items_order' AND object_id = OBJECT_ID('dbo.food_order_items'))
    CREATE INDEX ix_food_order_items_order ON dbo.food_order_items(order_id);
GO
