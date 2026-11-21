-- Laundry orders are priced at the desk, per entry: the garment and its price
-- are typed when the clothes are taken in, not picked from a price list. So an
-- order line no longer has to point at a catalogue service.
--
-- The name, unit and price are already snapshotted on the line (migration 115),
-- and the service_usages row written on delivery has a nullable service_id, so
-- nothing downstream needs the link.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.laundry_order_items')
           AND name = 'service_id' AND is_nullable = 0)
    EXEC('ALTER TABLE dbo.laundry_order_items ALTER COLUMN service_id BIGINT NULL');
GO
