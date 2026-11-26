-- A guest laundry order now comes back before it is handed over: sent to wash,
-- received from the wash, then handed to the guest. Receiving is where an
-- outside vendor's name and price are confirmed, so the vendor's phone is kept
-- with them, and the moment the clothes came back is recorded.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.laundry_orders', 'vendor_phone') IS NULL
    EXEC('ALTER TABLE dbo.laundry_orders ADD
            vendor_phone    NVARCHAR(20) NULL,
            washed_back_at  DATETIMEOFFSET NULL');
GO
