-- Clears the transactional history of ONE lodge: bookings, bills, advance
-- receipts, food orders and the numbering counters behind them.
--
-- Keeps: the lodge itself, its staff, rooms, categories, menu, tables, stock.
--
-- Runs as a DRY RUN by default — it prints what it would delete and stops
-- Set @Apply = 1 to actually delete.
--
-- Files on disk are NOT touched: ID proofs under uploads/id-proofs are orphaned
-- by this, not removed. Delete them separately if you want the disk clean.

-- sqlcmd connects with QUOTED_IDENTIFIER OFF where SSMS has it ON. Any DELETE
-- against a table carrying a filtered index — uq_invoices_booking_active, the
-- food_orders public_token index — is refused under OFF, and refused at BATCH
-- COMPILE, so the whole script fails before a single statement runs. Set here
-- so the file behaves the same however it is launched.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;

DECLARE @LodgeName NVARCHAR(200) = N'Anand Executive Home Stay';
DECLARE @Apply     BIT           = 0;   -- <<< set to 1 to delete for real

DECLARE @LodgeId BIGINT;
SELECT @LodgeId = id FROM dbo.lodges WHERE name = @LodgeName;

IF @LodgeId IS NULL
BEGIN
    -- Naming the near-misses beats "not found" when the stored name has a
    -- trailing space or different capitalisation.
    PRINT 'No lodge named: ' + @LodgeName;
    SELECT id, name FROM dbo.lodges ORDER BY name;
    RETURN;
END

PRINT 'Lodge: ' + @LodgeName + '  (id ' + CAST(@LodgeId AS NVARCHAR(20)) + ')';

SELECT 'bookings' AS [table], COUNT(*) AS rows_to_delete FROM dbo.bookings WHERE lodge_id = @LodgeId
UNION ALL SELECT 'invoices',          COUNT(*) FROM dbo.invoices          WHERE lodge_id = @LodgeId
UNION ALL SELECT 'advance_receipts',  COUNT(*) FROM dbo.advance_receipts  WHERE lodge_id = @LodgeId
UNION ALL SELECT 'food_orders',       COUNT(*) FROM dbo.food_orders       WHERE lodge_id = @LodgeId
UNION ALL SELECT 'booking_drafts',    COUNT(*) FROM dbo.booking_drafts    WHERE lodge_id = @LodgeId;

IF @Apply = 0
BEGIN
    PRINT '';
    PRINT 'DRY RUN — nothing deleted, nothing locked. Set @Apply = 1 to apply.';
    RETURN;
END

BEGIN TRANSACTION;

-- Children first. food_orders carries both booking_id and invoice_id, so it
-- clears before either of them.
DELETE sm FROM dbo.stock_movements sm WHERE sm.lodge_id = @LodgeId;
DELETE foi FROM dbo.food_order_items foi
    JOIN dbo.food_orders fo ON fo.id = foi.order_id WHERE fo.lodge_id = @LodgeId;
DELETE FROM dbo.food_orders      WHERE lodge_id = @LodgeId;

DELETE FROM dbo.advance_receipts WHERE lodge_id = @LodgeId;
DELETE FROM dbo.invoices         WHERE lodge_id = @LodgeId;

DELETE bsc FROM dbo.booking_switchable_charges bsc
    JOIN dbo.bookings b ON b.id = bsc.booking_id WHERE b.lodge_id = @LodgeId;
DELETE bv FROM dbo.booking_vehicles bv
    JOIN dbo.bookings b ON b.id = bv.booking_id WHERE b.lodge_id = @LodgeId;
DELETE bg FROM dbo.booking_guests bg
    JOIN dbo.bookings b ON b.id = bg.booking_id WHERE b.lodge_id = @LodgeId;

DELETE FROM dbo.booking_drafts   WHERE lodge_id = @LodgeId;
DELETE FROM dbo.bookings         WHERE lodge_id = @LodgeId;

-- Counters. Dropping the series rows rather than zeroing them: they are
-- recreated on first use, and it leaves the Numbering screen free to set a
-- fresh starting serial.
DELETE FROM dbo.invoice_series      WHERE lodge_id = @LodgeId;
DELETE FROM dbo.food_order_counters WHERE lodge_id = @LodgeId;
DELETE FROM dbo.food_pin_lockouts   WHERE lodge_id = @LodgeId;

COMMIT;
PRINT '';
PRINT 'DELETED.';
