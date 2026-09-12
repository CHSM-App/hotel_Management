-- Replaces booking_switchable_charges.unit_price with agreed_amount.
--
-- 041 added unit_price: what one of an extra costs on this booking. That model
-- is wrong, and wrong in a way that shows up on the printed bill. The desk
-- agrees "₹100 for the extra beds", not "₹33.33 each" — and with three beds no
-- two-decimal per-unit figure multiplies back to 100. A stay agreed at ₹1,400
-- printed as ₹1,399.99.
--
-- agreed_amount is the whole line per night, so the count never enters the
-- arithmetic and the printed total equals the number reception said out loud.
--
-- Written as a new migration rather than by editing 041, which has already run:
-- the runner records what it applied by checksum, and rewriting history under
-- it is how a database and its repository start disagreeing.

-- Guarded so this works on a database that has 041 and on a fresh one built
-- from schema.sql, which creates agreed_amount directly and never had
-- unit_price at all.
IF COL_LENGTH('dbo.booking_switchable_charges', 'agreed_amount') IS NULL
    EXEC('ALTER TABLE dbo.booking_switchable_charges ADD agreed_amount DECIMAL(10,2) NULL');
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_booking_switchable_charges_agreed_amount')
    EXEC('ALTER TABLE dbo.booking_switchable_charges ADD CONSTRAINT ck_booking_switchable_charges_agreed_amount
          CHECK (agreed_amount IS NULL OR agreed_amount >= 0)');
GO

-- Carry across anything 041 recorded, converting the units: a per-unit price
-- becomes a line amount by multiplying by the count it was charged for.
IF COL_LENGTH('dbo.booking_switchable_charges', 'unit_price') IS NOT NULL
    EXEC('UPDATE dbo.booking_switchable_charges
          SET agreed_amount = unit_price * quantity
          WHERE unit_price IS NOT NULL AND agreed_amount IS NULL');
GO

-- Then drop it, so there is one answer to "what was agreed" rather than two
-- columns that can disagree.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_booking_switchable_charges_unit_price')
    EXEC('ALTER TABLE dbo.booking_switchable_charges DROP CONSTRAINT ck_booking_switchable_charges_unit_price');
GO

IF COL_LENGTH('dbo.booking_switchable_charges', 'unit_price') IS NOT NULL
    EXEC('ALTER TABLE dbo.booking_switchable_charges DROP COLUMN unit_price');
GO
