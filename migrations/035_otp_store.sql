-- otp_store
--
-- One table per migration, in foreign-key dependency order: this file is
-- 32 of 32 that together build the database from nothing. The number is
-- the order, so these must be applied in sequence — which the engine does.
--
-- Split out of the single baseline that preceded it; the SQL is unchanged and
-- was verified against SQL Server by building it into a scratch schema and
-- comparing the result to src/config/schema.sql.
--
-- Guarded, so applying this to a database that already has the table is a
-- no-op rather than an error.
--
-- Remember: the same change must also land in src/config/schema.sql.
--
-- ---------------------------------------------------------------------------
--
-- Changing a password is the one self-service action that can lock the rightful
-- owner out of a property, and until this existed a stolen session was enough to
-- do it: the current password was the only check, and anyone who walked up to an
-- unlocked reception terminal already had one. Requiring a code delivered to the
-- account's own phone moves that from "something the browser has" to "something
-- the person has".
--
-- Modelled on the college-admission backend's otp_store, with the same
-- essentials: the code is stored as a bcrypt hash rather than in clear, it
-- expires, and it is burned on use. Two things are deliberately different.
--
-- First, `attempts`. A six-digit code is a million guesses, which sounds like a
-- lot until you notice the guesser is already authenticated and can spend them
-- as fast as the API answers. Without a ceiling the code's real strength is
-- whatever the rate limiter happens to allow. The college table has no such
-- column; this one does, and the check that reads it burns the code on the last
-- allowed miss.
--
-- Second, `user_id`. The college flow identifies people by the phone they type
-- in, because it has to work for someone who cannot log in. This flow always
-- runs inside a session, so the code is bound to the account that asked for it
-- and cannot be redeemed against another — even if two accounts somehow shared
-- a number.

-- One-time codes sent over WhatsApp, currently for confirming a password change.
-- Changing a password can lock the rightful owner out of a property, and a
-- stolen session was previously enough to do it. The code moves that check from
-- "something the browser has" to "something the person has".
--
-- Stored as a bcrypt hash, expires, and burned on use. attempts caps guessing:
-- six digits is only strong while the guesser cannot spend a million tries, and
-- this one is already authenticated. user_id binds the code to the account that
-- asked for it. Mirrors migration 003.
IF OBJECT_ID('dbo.otp_store', 'U') IS NULL
CREATE TABLE dbo.otp_store (
    id           BIGINT IDENTITY(1,1) PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES dbo.users(id),
    -- Normalised to E.164 digits (919876543210). Kept alongside user_id so the
    -- trail still says where a code went after the user's phone is later edited.
    phone        NVARCHAR(20) NOT NULL,
    otp_hash     NVARCHAR(255) NOT NULL,
    purpose      NVARCHAR(30) NOT NULL
        CONSTRAINT ck_otp_store_purpose CHECK (purpose IN ('password_change')),
    attempts     INT NOT NULL DEFAULT 0,
    expires_at   DATETIMEOFFSET NOT NULL,
    used         BIT NOT NULL DEFAULT 0,
    created_at   DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

-- Every read is "the newest live code for this account and purpose".
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_otp_store_user_purpose')
    CREATE INDEX ix_otp_store_user_purpose ON dbo.otp_store (user_id, purpose, created_at DESC);
GO

-- Supports the opportunistic sweep of spent and expired rows.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_otp_store_expires_at')
    CREATE INDEX ix_otp_store_expires_at ON dbo.otp_store (expires_at);
GO
