-- customers.date_of_birth / customers.last_birthday_wished_at
--
-- date_of_birth is optional, entered by hand on the customer's profile (the
-- system never infers it from anything) — NULL means "not on file", not
-- "no birthday".
--
-- last_birthday_wished_at is the dedup for the birthday-wishes sweep (see
-- birthdayWishes.service.js): the sweep only wishes a customer whose
-- date_of_birth matches today's month/day AND whose last_birthday_wished_at
-- is either NULL or not already this calendar year — so a customer gets
-- exactly one wish per birthday, even if the sweep runs more than once on
-- the same day.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.customers', 'date_of_birth') IS NULL
    EXEC('ALTER TABLE dbo.customers ADD date_of_birth DATE NULL');
GO

IF COL_LENGTH('dbo.customers', 'last_birthday_wished_at') IS NULL
    EXEC('ALTER TABLE dbo.customers ADD last_birthday_wished_at DATE NULL');
GO
