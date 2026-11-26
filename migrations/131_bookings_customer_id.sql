-- Links bookings, their extra occupants, and event bookings back to the
-- customer record they belong to. Independent, nullable columns on each
-- table — not mutually exclusive on the customer side the way
-- invoices/advance_receipts' booking_id vs event_booking_id are, since here
-- it's the other direction: one customer can have many rows in both.
--
-- Nullable and kept that way: a customer-record write failing must never be
-- the reason a booking or a confirmed function can't be saved, so the column
-- is filled in by the application's upsert hook, not required here.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.bookings', 'customer_id') IS NULL
    EXEC('ALTER TABLE dbo.bookings ADD customer_id BIGINT NULL REFERENCES dbo.customers(id)');
GO

IF COL_LENGTH('dbo.booking_guests', 'customer_id') IS NULL
    EXEC('ALTER TABLE dbo.booking_guests ADD customer_id BIGINT NULL REFERENCES dbo.customers(id)');
GO

IF COL_LENGTH('dbo.event_bookings', 'customer_id') IS NULL
    EXEC('ALTER TABLE dbo.event_bookings ADD customer_id BIGINT NULL REFERENCES dbo.customers(id)');
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_bookings_customer' AND object_id = OBJECT_ID('dbo.bookings'))
    CREATE INDEX ix_bookings_customer ON dbo.bookings(customer_id) WHERE customer_id IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_booking_guests_customer' AND object_id = OBJECT_ID('dbo.booking_guests'))
    CREATE INDEX ix_booking_guests_customer ON dbo.booking_guests(customer_id) WHERE customer_id IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_event_bookings_customer' AND object_id = OBJECT_ID('dbo.event_bookings'))
    CREATE INDEX ix_event_bookings_customer ON dbo.event_bookings(customer_id) WHERE customer_id IS NOT NULL;
GO
