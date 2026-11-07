-- Durable record of failed staff sign-ins.
--
-- The in-memory limiter in src/middleware/rateLimit.js is fast and costs
-- nothing, but its state dies with the process. That matters more here than it
-- looks: the app now exits on an uncaught exception (see src/server.js), and
-- Passenger also recycles idle processes on its own schedule. Either resets
-- every counter, so an attacker who can crash the app — or who is simply
-- patient enough to wait for a recycle — gets a fresh budget.
--
-- The guest PIN path already has a durable backstop in dbo.food_pin_lockouts;
-- the staff login path had none, which left the more valuable door with the
-- weaker lock. This table is that backstop, deliberately mirroring the
-- food_pin_lockouts shape so there is one pattern to understand rather than two.
--
-- Keyed on the identifier AS TYPED rather than on a user id: an attacker
-- guessing against an address that does not exist has to be counted the same as
-- one guessing against a real account, or the lockout itself becomes a way to
-- discover which accounts exist.

IF OBJECT_ID('dbo.login_attempts', 'U') IS NULL
CREATE TABLE dbo.login_attempts (
    -- Lowercased by the application before it reaches here, so 'Owner@x.com'
    -- and 'owner@x.com' share one budget rather than two.
    identifier       NVARCHAR(255) NOT NULL,
    -- 'STAFF' or 'ADMIN'. The two doors have different budgets and must not
    -- share a counter — the admin door is the key to every property.
    door             NVARCHAR(10) NOT NULL
        CONSTRAINT ck_login_attempts_door CHECK (door IN ('STAFF', 'ADMIN')),
    failed_count     INT NOT NULL DEFAULT 0,
    first_failed_at  DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    last_failed_at   DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    locked_until     DATETIMEOFFSET NULL,
    CONSTRAINT pk_login_attempts PRIMARY KEY (identifier, door)
);
GO

-- Finds rows worth clearing without scanning the whole table. Sign-in traffic
-- is small, but this table is written on every failure and never read in bulk,
-- so the sweep below should stay cheap.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_login_attempts_last_failed')
    CREATE INDEX ix_login_attempts_last_failed ON dbo.login_attempts (last_failed_at);
GO
