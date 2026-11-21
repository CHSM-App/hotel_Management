-- Bar orders can be posted to a guest's room (stay) bill (168). Remember: the same
-- change must also land in src/config/schema.sql.
--
-- A bar order on the room bill is carried by the stay invoice like a service use:
-- on_room_bill marks it parked, invoice_id says which bill billed it, voided_invoice_id
-- keeps the link after a void. The stay invoice gets its own Bar line: drinks at the
-- bar's plain tax %, restaurant dishes at food GST. Neither lands in the food or service
-- columns, so restaurant revenue and the GST register are not changed by bar sales.
IF COL_LENGTH('dbo.bar_orders', 'on_room_bill') IS NULL
    EXEC('ALTER TABLE dbo.bar_orders ADD on_room_bill BIT NOT NULL CONSTRAINT df_bar_orders_on_room_bill DEFAULT 0');
GO

IF COL_LENGTH('dbo.bar_orders', 'invoice_id') IS NULL
    EXEC('ALTER TABLE dbo.bar_orders ADD invoice_id BIGINT NULL CONSTRAINT fk_bar_orders_invoice REFERENCES dbo.invoices(id)');
GO

IF COL_LENGTH('dbo.bar_orders', 'voided_invoice_id') IS NULL
    EXEC('ALTER TABLE dbo.bar_orders ADD voided_invoice_id BIGINT NULL CONSTRAINT fk_bar_orders_voided_invoice REFERENCES dbo.invoices(id)');
GO

IF COL_LENGTH('dbo.invoices', 'bar_subtotal') IS NULL
BEGIN
    EXEC('ALTER TABLE dbo.invoices ADD bar_subtotal DECIMAL(10,2) NOT NULL CONSTRAINT df_invoices_bar_subtotal DEFAULT 0');
    EXEC('ALTER TABLE dbo.invoices ADD bar_food_subtotal DECIMAL(10,2) NOT NULL CONSTRAINT df_invoices_bar_food_subtotal DEFAULT 0');
    EXEC('ALTER TABLE dbo.invoices ADD bar_tax_amount DECIMAL(10,2) NOT NULL CONSTRAINT df_invoices_bar_tax_amount DEFAULT 0');
    EXEC('ALTER TABLE dbo.invoices ADD bar_food_tax_amount DECIMAL(10,2) NOT NULL CONSTRAINT df_invoices_bar_food_tax_amount DEFAULT 0');
END
GO
