-- otp_store: allow a 'forgot_password' purpose
--
-- The /auth/forgot-password door let anyone who knew a staff member's phone
-- or email take over that account outright — no proof the caller is the
-- account owner, just a rate limit. This adds the same WhatsApp code the
-- logged-in password-change flow already requires (see migrations/035),
-- reusing dbo.otp_store rather than a second table. The column's CHECK
-- constraint only allowed 'password_change', so it is dropped and widened
-- here to admit the new purpose too.
--
-- Guarded, so applying this to a database that already has the wider
-- constraint is a no-op rather than an error.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_otp_store_purpose')
    ALTER TABLE dbo.otp_store DROP CONSTRAINT ck_otp_store_purpose;
GO

ALTER TABLE dbo.otp_store ADD CONSTRAINT ck_otp_store_purpose
    CHECK (purpose IN ('password_change', 'forgot_password'));
GO
