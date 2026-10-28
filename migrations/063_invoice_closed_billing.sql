-- Whether a voided invoice's booking is done being billed for good, rather
-- than going back into the "Ready to bill" queue to be reissued.
--
-- Voiding alone was never meant to mean "never bill this again" — the code
-- already sends a voided function back to CONFIRMED so it can be rebilled,
-- and a voided stay's booking reappears in the queue the same way, on
-- purpose (see billing.service.js#voidInvoice). But the desk also voids a
-- bill for a stay that will never be billed at all — a no-show refunded in
-- full, a duplicate entry — and wants that gone from the queue for good, not
-- sitting there indistinguishable from a stay nobody has billed yet.
--
-- closed_billing is that second, deliberate choice: set only when staff pick
-- "also remove from billing" at void time, never implied by VOID alone.
-- Lives on the invoice, not the booking, because the invoice is the record
-- that already carries why and when it was voided, and a booking can have
-- more than one invoice across its life.
--
-- Remember: the same change must also land in src/config/schema.sql.
IF COL_LENGTH('dbo.invoices', 'closed_billing') IS NULL
    EXEC('ALTER TABLE dbo.invoices ADD closed_billing BIT NOT NULL CONSTRAINT df_invoices_closed_billing DEFAULT 0');
GO
