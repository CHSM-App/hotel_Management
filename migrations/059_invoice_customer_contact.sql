-- invoice_customer_contact
--
-- Who a food-only bill was actually cut for.
--
-- This file is both halves at once: a guarded ADD, so it builds alongside
-- 004-058, and carries an existing database forward.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- ---------------------------------------------------------------------------
-- invoices.customer_name, invoices.customer_phone
-- ---------------------------------------------------------------------------

-- A stay bill and an event bill both have a name behind them already —
-- guest_name off the booking, organiser_name off the function — read through
-- COALESCE(b.guest_name, eb.organiser_name) in getInvoice/listInvoices. A food
-- bill raised against a table or a room has no such name: a table is a party,
-- not one payer, and a room's tab belongs to whoever is checked in there
-- already. But a counter takeaway is a single named customer, captured at
-- placement (food_orders.guest_name / guest_phone, required for a COUNTER
-- order — see orders.schema.js), and until now that name was asked for and
-- then thrown away: the ticket had it, the invoice never did.
--
-- These columns are where issueFoodInvoice copies it to when the tab being
-- closed is a counter order, so the "Food to bill" list, the bill preview and
-- the printed document can all show who the takeaway was for. Null on a table
-- or room tab, and null on every bill issued before this column existed —
-- both cases where there never was a single name to print, or none was kept.
IF COL_LENGTH('dbo.invoices', 'customer_name') IS NULL
    EXEC('ALTER TABLE dbo.invoices ADD customer_name NVARCHAR(200) NULL');

IF COL_LENGTH('dbo.invoices', 'customer_phone') IS NULL
    EXEC('ALTER TABLE dbo.invoices ADD customer_phone NVARCHAR(20) NULL');
