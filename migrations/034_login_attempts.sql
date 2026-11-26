-- login_attempts
--
-- One table per migration, in foreign-key dependency order: this file is
-- 31 of 32 that together build the database from nothing. The number is
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

-- The same backstop for the staff sign-in door. The in-memory limiter's counters
-- die with the process, and Passenger recycles processes on its own schedule, so
-- an attacker who can crash the app — or who is simply patient — gets a fresh
-- budget.
--
-- This table is also created by 001_login_attempts.sql, which is already applied
-- in production and stays for that reason. Both are guarded, so whichever runs
-- second is a no-op; this one exists so the set still builds a complete database
-- on its own. See 001 for the fuller reasoning.
IF OBJECT_ID('dbo.login_attempts', 'U') IS NULL
CREATE TABLE dbo.login_attempts (
    -- Lowercased by the application before it reaches here, so 'Owner@x.com' and
    -- 'owner@x.com' share one budget rather than two.
    identifier       NVARCHAR(255) NOT NULL,
    -- The two doors have different budgets and must not share a counter — the
    -- admin door is the key to every property.
    door             NVARCHAR(10) NOT NULL
        CONSTRAINT ck_login_attempts_door CHECK (door IN ('STAFF', 'ADMIN')),
    failed_count     INT NOT NULL DEFAULT 0,
    first_failed_at  DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    last_failed_at   DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    locked_until     DATETIMEOFFSET NULL,
    CONSTRAINT pk_login_attempts PRIMARY KEY (identifier, door)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_login_attempts_last_failed')
    CREATE INDEX ix_login_attempts_last_failed ON dbo.login_attempts (last_failed_at);
GO
