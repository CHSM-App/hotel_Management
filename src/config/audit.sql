-- ===========================================================================
-- Audit trail — who changed what, and when
-- ===========================================================================
--
-- Run this against the lodge database AFTER schema.sql. It is idempotent: every
-- object is guarded, so re-running it is safe and is how you pick up changes.
--
--   sqlcmd -S <server> -d <database> -U <user> -P <password> -i src/config/audit.sql
--
-- Or paste it into SSMS against the right database. It creates one table, one
-- view and seven triggers, and modifies no existing table.
--
-- ---------------------------------------------------------------------------
-- What this answers
-- ---------------------------------------------------------------------------
--
-- "Who voided invoice INV-0042?" — "Who changed that room rate?" — "Who
-- deleted the booking that was on room 12 last Tuesday?" Questions that come up
-- when money or a guest record is disputed, and that today's schema cannot
-- answer: it records created_by on five tables and nothing at all about who
-- *changed* or *removed* a row afterwards.
--
-- ---------------------------------------------------------------------------
-- The identity problem, and how it is solved
-- ---------------------------------------------------------------------------
--
-- The application connects to SQL Server as ONE login for every user. To the
-- database, a receptionist voiding an invoice and the owner doing it are the
-- same connection — SUSER_SNAME() returns the same value for both, so a trigger
-- on its own cannot name a person.
--
-- The fix is SESSION_CONTEXT: before running a statement, the app stamps the
-- acting user onto the connection, and the trigger reads that stamp back. It
-- needs SQL Server 2016 or newer (you are on 2019).
--
--   EXEC sys.sp_set_session_context @key = N'app_user_id', @value = 42;
--
-- >> THE TRIGGERS BELOW WORK WITHOUT THIS. <<
--
-- Until the app is wired up, every audit row records the change, the before and
-- after values, and the time — with actor_user_id NULL, meaning "we know what
-- happened, not who". That is already far more than exists today, and it means
-- you can install this now and add identity later without redoing anything.
--
-- Wiring the app is a separate change with a real hazard attached: pooled
-- connections are reused between requests, so a stamp that is not cleared makes
-- the NEXT request's changes look like they came from the PREVIOUS user. An
-- audit log that confidently names the wrong member of staff is worse than no
-- audit log, because people believe it. Do that part deliberately, not as an
-- afterthought to this file.
--
-- ---------------------------------------------------------------------------
-- What is audited
-- ---------------------------------------------------------------------------
--
--   dbo.bookings         the stay itself, and its money
--   dbo.invoices         issued and voided documents
--   dbo.food_orders      restaurant orders and their status
--   dbo.users            staff accounts, roles, activation
--   dbo.roles            permission sets
--   dbo.rooms            inventory
--   dbo.room_categories  the rates rooms are sold at
--
-- Not audited: menu items, inventory movements, dining tables. They change
-- constantly, and nobody disputes them. Adding one later is a copy of any
-- trigger below with the table name changed — the body is table-agnostic.
--
-- ---------------------------------------------------------------------------
-- Design notes
-- ---------------------------------------------------------------------------
--
-- Rows are captured WHOLE, as JSON, rather than column-by-column. Your schema
-- grows by ALTER TABLE ADD — bookings alone has gained nine columns that way —
-- and a trigger naming its columns explicitly would silently stop recording
-- each new one. FOR JSON picks up whatever the table has today.
--
-- Both old and new values are kept on an update. Storing only the new value
-- makes "the rate was changed" answerable but not "changed from what", which is
-- the half that settles an argument.
--
-- Triggers are AFTER, not INSTEAD OF: they observe, and never alter what the
-- application asked for. A bug here can therefore cost you an audit row, but it
-- cannot corrupt a booking.
--
-- ===========================================================================

SET NOCOUNT ON;
GO

-- ---------------------------------------------------------------------------
-- The log table
-- ---------------------------------------------------------------------------

IF OBJECT_ID('dbo.audit_log', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.audit_log (
        id              BIGINT IDENTITY(1,1) NOT NULL,

        -- WHAT changed.
        table_name      SYSNAME        NOT NULL,
        record_id       BIGINT         NULL,
        action          NVARCHAR(6)    NOT NULL
            CONSTRAINT ck_audit_log_action CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),

        -- WHICH PROPERTY it belongs to. Denormalised on purpose: an auditor
        -- filtering one lodge's history should not have to join back to a row
        -- that may since have been deleted. NULL for rows that are not
        -- lodge-scoped, such as a SUPERADMIN user.
        lodge_id        BIGINT         NULL,

        -- WHO did it, from SESSION_CONTEXT. NULL until the app is wired up, or
        -- for a change made directly in SSMS — and a NULL here on a row that
        -- came through the app is itself worth investigating.
        actor_user_id   BIGINT         NULL,
        actor_role      NVARCHAR(20)   NULL,

        -- WHERE FROM. Fallbacks that always work, and that catch the case
        -- SESSION_CONTEXT cannot: someone bypassing the application entirely.
        -- A row with a NULL actor and host_name 'SSMS' is a direct edit.
        db_login        SYSNAME        NOT NULL CONSTRAINT df_audit_log_login   DEFAULT SUSER_SNAME(),
        host_name       NVARCHAR(128)  NULL     CONSTRAINT df_audit_log_host    DEFAULT HOST_NAME(),
        app_name        NVARCHAR(128)  NULL     CONSTRAINT df_audit_log_app     DEFAULT APP_NAME(),
        client_ip       NVARCHAR(45)   NULL,

        -- WHEN.
        changed_at      DATETIMEOFFSET NOT NULL CONSTRAINT df_audit_log_at      DEFAULT SYSDATETIMEOFFSET(),

        -- THE ROW ITSELF, before and after. NULL old on an insert, NULL new on
        -- a delete.
        old_values      NVARCHAR(MAX)  NULL,
        new_values      NVARCHAR(MAX)  NULL,

        -- Which columns actually differ, as a JSON array. The full rows above
        -- answer "what was it", this answers "what moved" without a reader
        -- diffing two documents by eye.
        changed_columns NVARCHAR(MAX)  NULL,

        CONSTRAINT pk_audit_log PRIMARY KEY CLUSTERED (id)
    );
END;
GO

-- The three questions actually asked of an audit log: what happened to this
-- record, what did this person do, what happened at this property lately.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_audit_log_record')
    CREATE INDEX ix_audit_log_record ON dbo.audit_log (table_name, record_id, changed_at DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_audit_log_actor')
    CREATE INDEX ix_audit_log_actor ON dbo.audit_log (actor_user_id, changed_at DESC)
        WHERE actor_user_id IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_audit_log_lodge')
    CREATE INDEX ix_audit_log_lodge ON dbo.audit_log (lodge_id, changed_at DESC);
GO

-- ---------------------------------------------------------------------------
-- Append-only enforcement
-- ---------------------------------------------------------------------------
--
-- An audit trail that can be edited proves nothing: anyone who can rewrite the
-- record can rewrite it to say they did nothing. This trigger makes UPDATE and
-- DELETE on dbo.audit_log fail outright, for every login including sysadmin.
--
-- INSTEAD OF is what gives that its teeth — the statement is replaced by this
-- body, so the write never reaches the table rather than being rolled back
-- after the fact.
--
-- It is not absolute, and should not be sold as such: anyone with rights to
-- DROP the trigger can remove it and then edit freely. What it stops is casual
-- and accidental tampering — an UPDATE with a careless WHERE, a cleanup script,
-- someone tidying a row they regret. Defeating it takes a deliberate act that
-- itself shows up in the SQL Server error log.
--
-- Retention: there is deliberately no purge job here. Deleting history is the
-- one operation this table exists to prevent, so trimming it is a decision to
-- make consciously — disable the trigger, delete the range, re-enable it.

IF OBJECT_ID('dbo.trg_audit_log_append_only', 'TR') IS NOT NULL
    DROP TRIGGER dbo.trg_audit_log_append_only;
GO

CREATE TRIGGER dbo.trg_audit_log_append_only
ON dbo.audit_log
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 50001, 'dbo.audit_log is append-only: rows cannot be modified or deleted.', 1;
END;
GO

-- ---------------------------------------------------------------------------
-- A readable view
-- ---------------------------------------------------------------------------
--
-- The raw table is JSON and ids. This joins the actor's name back on and puts
-- the newest first, so "what happened here" is one SELECT rather than a query
-- someone has to compose under pressure.
--
-- LEFT JOIN throughout: the point of an audit row is to outlive the thing it
-- describes, including the staff account that made the change.

IF OBJECT_ID('dbo.vw_audit_log', 'V') IS NOT NULL
    DROP VIEW dbo.vw_audit_log;
GO

CREATE VIEW dbo.vw_audit_log
AS
SELECT
    a.id,
    a.changed_at,
    a.table_name,
    a.record_id,
    a.action,
    a.lodge_id,
    l.name        AS lodge_name,
    a.actor_user_id,
    -- Names the gap explicitly rather than leaving a blank the reader has to
    -- interpret. These two cases mean different things and a blank hides that:
    -- one is a change made outside the app, the other is a deleted account.
    COALESCE(u.name, CASE WHEN a.actor_user_id IS NULL
                          THEN '(not recorded)'
                          ELSE '(deleted user #' + CAST(a.actor_user_id AS NVARCHAR(20)) + ')'
                     END) AS actor_name,
    a.actor_role,
    a.client_ip,
    a.host_name,
    a.db_login,
    a.changed_columns,
    a.old_values,
    a.new_values
FROM dbo.audit_log a
LEFT JOIN dbo.users  u ON u.id = a.actor_user_id
LEFT JOIN dbo.lodges l ON l.id = a.lodge_id;
GO

-- ===========================================================================
-- Table triggers
-- ===========================================================================
--
-- Every one below is the same body with the table name changed. The shape:
--
--   * ONE audit row per affected record, per statement. An UPDATE touching
--     twelve bookings writes twelve rows, because "who changed booking 7" has
--     to be answerable without unpacking a batch.
--
--   * inserted / deleted are the trigger pseudo-tables: on an update both are
--     populated and joined on id, which is what gives before-and-after.
--
--   * Rows are serialised with FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, applied to
--     a single correlated row of the pseudo-table. The new value can be read
--     back from the base table by id; the OLD value cannot — the row may no
--     longer be there — so it is serialised from `deleted` itself.
--
--   * changed_columns is computed by comparing the two JSON documents with
--     OPENJSON, so it needs no column list either and cannot drift from the
--     table as columns are added.
--
-- Cost is one extra insert per changed row, on tables written a few hundred
-- times a day. At this scale that is not measurable.

-- --- dbo.bookings ----------------------------------------------------------

IF OBJECT_ID('dbo.trg_audit_bookings', 'TR') IS NOT NULL
    DROP TRIGGER dbo.trg_audit_bookings;
GO

CREATE TRIGGER dbo.trg_audit_bookings
ON dbo.bookings
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    -- An UPDATE whose WHERE matched nothing still fires the trigger. Leaving
    -- early keeps the log free of rows recording that nothing happened.
    IF NOT EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        RETURN;

    DECLARE @actor_id   BIGINT       = TRY_CAST(SESSION_CONTEXT(N'app_user_id') AS BIGINT);
    DECLARE @actor_role NVARCHAR(20) = CAST(SESSION_CONTEXT(N'app_user_role') AS NVARCHAR(20));
    DECLARE @client_ip  NVARCHAR(45) = CAST(SESSION_CONTEXT(N'app_client_ip') AS NVARCHAR(45));

    -- Serialise each side once, keyed by id, then join. Doing it in CTEs keeps
    -- the FOR JSON correlated to exactly one row, which is what makes
    -- WITHOUT_ARRAY_WRAPPER produce an object rather than a one-element array.
    WITH new_rows AS (
        SELECT i.id,
               i.lodge_id,
               (SELECT x.* FROM inserted x WHERE x.id = i.id
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS doc
        FROM inserted i
    ),
    old_rows AS (
        SELECT d.id,
               d.lodge_id,
               (SELECT y.* FROM deleted y WHERE y.id = d.id
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS doc
        FROM deleted d
    )
    INSERT INTO dbo.audit_log
        (table_name, record_id, action, lodge_id, actor_user_id, actor_role, client_ip,
         old_values, new_values, changed_columns)
    SELECT
        'bookings',
        COALESCE(n.id, o.id),
        CASE WHEN n.id IS NOT NULL AND o.id IS NOT NULL THEN 'UPDATE'
             WHEN n.id IS NOT NULL                      THEN 'INSERT'
             ELSE                                            'DELETE' END,
        COALESCE(n.lodge_id, o.lodge_id),
        @actor_id, @actor_role, @client_ip,
        o.doc,
        n.doc,
        -- Only meaningful on an update: on an insert every column is "changed"
        -- and on a delete none is, and in both cases the full document says it.
        CASE WHEN n.id IS NOT NULL AND o.id IS NOT NULL THEN
            (SELECT nv.[key]
             FROM OPENJSON(n.doc) nv
             JOIN OPENJSON(o.doc) ov ON ov.[key] = nv.[key]
             -- NULL-safe: a column going to or from NULL is a change, and a
             -- plain <> would silently miss both directions.
             WHERE EXISTS (SELECT nv.value EXCEPT SELECT ov.value)
             FOR JSON PATH)
        END
    FROM new_rows n
    FULL OUTER JOIN old_rows o ON o.id = n.id;
END;
GO

-- --- dbo.invoices --------------------------------------------------
--
-- The money documents. A void is an UPDATE of status to 'VOID', so voiding is
-- captured here with both the before and after — which is the specific event
-- most likely to be questioned later.

IF OBJECT_ID('dbo.trg_audit_invoices', 'TR') IS NOT NULL
    DROP TRIGGER dbo.trg_audit_invoices;
GO

CREATE TRIGGER dbo.trg_audit_invoices
ON dbo.invoices
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        RETURN;

    DECLARE @actor_id   BIGINT       = TRY_CAST(SESSION_CONTEXT(N'app_user_id') AS BIGINT);
    DECLARE @actor_role NVARCHAR(20) = CAST(SESSION_CONTEXT(N'app_user_role') AS NVARCHAR(20));
    DECLARE @client_ip  NVARCHAR(45) = CAST(SESSION_CONTEXT(N'app_client_ip') AS NVARCHAR(45));

    WITH new_rows AS (
        SELECT i.id, i.lodge_id,
               (SELECT x.* FROM inserted x WHERE x.id = i.id
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS doc
        FROM inserted i
    ),
    old_rows AS (
        SELECT d.id, d.lodge_id,
               (SELECT y.* FROM deleted y WHERE y.id = d.id
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS doc
        FROM deleted d
    )
    INSERT INTO dbo.audit_log
        (table_name, record_id, action, lodge_id, actor_user_id, actor_role, client_ip,
         old_values, new_values, changed_columns)
    SELECT
        'invoices',
        COALESCE(n.id, o.id),
        CASE WHEN n.id IS NOT NULL AND o.id IS NOT NULL THEN 'UPDATE'
             WHEN n.id IS NOT NULL                      THEN 'INSERT'
             ELSE                                            'DELETE' END,
        COALESCE(n.lodge_id, o.lodge_id),
        @actor_id, @actor_role, @client_ip,
        o.doc,
        n.doc,
        CASE WHEN n.id IS NOT NULL AND o.id IS NOT NULL THEN
            (SELECT nv.[key]
             FROM OPENJSON(n.doc) nv
             JOIN OPENJSON(o.doc) ov ON ov.[key] = nv.[key]
             WHERE EXISTS (SELECT nv.value EXCEPT SELECT ov.value)
             FOR JSON PATH)
        END
    FROM new_rows n
    FULL OUTER JOIN old_rows o ON o.id = n.id;
END;
GO


-- --- dbo.food_orders -----------------------------------------------
--
-- Restaurant orders. Status changes and cancellations are the interesting
-- part: a cancelled order is revenue that did not happen, and who cancelled it
-- is exactly what nobody can currently answer.

IF OBJECT_ID('dbo.trg_audit_food_orders', 'TR') IS NOT NULL
    DROP TRIGGER dbo.trg_audit_food_orders;
GO

CREATE TRIGGER dbo.trg_audit_food_orders
ON dbo.food_orders
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        RETURN;

    DECLARE @actor_id   BIGINT       = TRY_CAST(SESSION_CONTEXT(N'app_user_id') AS BIGINT);
    DECLARE @actor_role NVARCHAR(20) = CAST(SESSION_CONTEXT(N'app_user_role') AS NVARCHAR(20));
    DECLARE @client_ip  NVARCHAR(45) = CAST(SESSION_CONTEXT(N'app_client_ip') AS NVARCHAR(45));

    WITH new_rows AS (
        SELECT i.id, i.lodge_id,
               (SELECT x.* FROM inserted x WHERE x.id = i.id
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS doc
        FROM inserted i
    ),
    old_rows AS (
        SELECT d.id, d.lodge_id,
               (SELECT y.* FROM deleted y WHERE y.id = d.id
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS doc
        FROM deleted d
    )
    INSERT INTO dbo.audit_log
        (table_name, record_id, action, lodge_id, actor_user_id, actor_role, client_ip,
         old_values, new_values, changed_columns)
    SELECT
        'food_orders',
        COALESCE(n.id, o.id),
        CASE WHEN n.id IS NOT NULL AND o.id IS NOT NULL THEN 'UPDATE'
             WHEN n.id IS NOT NULL                      THEN 'INSERT'
             ELSE                                            'DELETE' END,
        COALESCE(n.lodge_id, o.lodge_id),
        @actor_id, @actor_role, @client_ip,
        o.doc,
        n.doc,
        CASE WHEN n.id IS NOT NULL AND o.id IS NOT NULL THEN
            (SELECT nv.[key]
             FROM OPENJSON(n.doc) nv
             JOIN OPENJSON(o.doc) ov ON ov.[key] = nv.[key]
             WHERE EXISTS (SELECT nv.value EXCEPT SELECT ov.value)
             FOR JSON PATH)
        END
    FROM new_rows n
    FULL OUTER JOIN old_rows o ON o.id = n.id;
END;
GO


-- --- dbo.users -----------------------------------------------------
--
-- Staff accounts: creation, deactivation, role changes, password resets.
--
-- password_hash is REDACTED rather than logged. An audit trail is read by more
-- people than the users table is, and copying every historical hash into it
-- widens the blast radius of a leak for no investigative gain — that a password
-- changed is the fact worth keeping, not what it changed to.
--
-- Because both hashes become the same literal, a password change would vanish
-- from changed_columns. It is detected before redaction and added back below,
-- so "who reset whose password" stays answerable.

IF OBJECT_ID('dbo.trg_audit_users', 'TR') IS NOT NULL
    DROP TRIGGER dbo.trg_audit_users;
GO

CREATE TRIGGER dbo.trg_audit_users
ON dbo.users
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        RETURN;

    DECLARE @actor_id   BIGINT       = TRY_CAST(SESSION_CONTEXT(N'app_user_id') AS BIGINT);
    DECLARE @actor_role NVARCHAR(20) = CAST(SESSION_CONTEXT(N'app_user_role') AS NVARCHAR(20));
    DECLARE @client_ip  NVARCHAR(45) = CAST(SESSION_CONTEXT(N'app_client_ip') AS NVARCHAR(45));

    WITH new_rows AS (
        SELECT i.id, i.lodge_id,
               JSON_MODIFY(
                   (SELECT x.* FROM inserted x WHERE x.id = i.id
                    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                   '$.password_hash', '(redacted)') AS doc
        FROM inserted i
    ),
    old_rows AS (
        SELECT d.id, d.lodge_id,
               JSON_MODIFY(
                   (SELECT y.* FROM deleted y WHERE y.id = d.id
                    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                   '$.password_hash', '(redacted)') AS doc
        FROM deleted d
    )
    INSERT INTO dbo.audit_log
        (table_name, record_id, action, lodge_id, actor_user_id, actor_role, client_ip,
         old_values, new_values, changed_columns)
    SELECT
        'users',
        COALESCE(n.id, o.id),
        CASE WHEN n.id IS NOT NULL AND o.id IS NOT NULL THEN 'UPDATE'
             WHEN n.id IS NOT NULL                      THEN 'INSERT'
             ELSE                                            'DELETE' END,
        COALESCE(n.lodge_id, o.lodge_id),
        @actor_id, @actor_role, @client_ip,
        o.doc,
        n.doc,
        CASE WHEN n.id IS NOT NULL AND o.id IS NOT NULL THEN
            (SELECT nv.[key]
             FROM OPENJSON(n.doc) nv
             JOIN OPENJSON(o.doc) ov ON ov.[key] = nv.[key]
             WHERE EXISTS (SELECT nv.value EXCEPT SELECT ov.value)
                -- The redacted column is compared from the real rows instead.
                OR (nv.[key] = 'password_hash' AND EXISTS (
                      SELECT ri.password_hash FROM inserted ri WHERE ri.id = n.id
                      EXCEPT
                      SELECT rd.password_hash FROM deleted  rd WHERE rd.id = o.id))
             FOR JSON PATH)
        END
    FROM new_rows n
    FULL OUTER JOIN old_rows o ON o.id = n.id;
END;
GO


-- --- dbo.roles -----------------------------------------------------
--
-- Permission sets. Worth auditing precisely because a privilege escalation is
-- invisible in every other table: nothing about a booking shows that the person
-- who made it was granted billing rights an hour earlier.

IF OBJECT_ID('dbo.trg_audit_roles', 'TR') IS NOT NULL
    DROP TRIGGER dbo.trg_audit_roles;
GO

CREATE TRIGGER dbo.trg_audit_roles
ON dbo.roles
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        RETURN;

    DECLARE @actor_id   BIGINT       = TRY_CAST(SESSION_CONTEXT(N'app_user_id') AS BIGINT);
    DECLARE @actor_role NVARCHAR(20) = CAST(SESSION_CONTEXT(N'app_user_role') AS NVARCHAR(20));
    DECLARE @client_ip  NVARCHAR(45) = CAST(SESSION_CONTEXT(N'app_client_ip') AS NVARCHAR(45));

    WITH new_rows AS (
        SELECT i.id, i.lodge_id,
               (SELECT x.* FROM inserted x WHERE x.id = i.id
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS doc
        FROM inserted i
    ),
    old_rows AS (
        SELECT d.id, d.lodge_id,
               (SELECT y.* FROM deleted y WHERE y.id = d.id
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS doc
        FROM deleted d
    )
    INSERT INTO dbo.audit_log
        (table_name, record_id, action, lodge_id, actor_user_id, actor_role, client_ip,
         old_values, new_values, changed_columns)
    SELECT
        'roles',
        COALESCE(n.id, o.id),
        CASE WHEN n.id IS NOT NULL AND o.id IS NOT NULL THEN 'UPDATE'
             WHEN n.id IS NOT NULL                      THEN 'INSERT'
             ELSE                                            'DELETE' END,
        COALESCE(n.lodge_id, o.lodge_id),
        @actor_id, @actor_role, @client_ip,
        o.doc,
        n.doc,
        CASE WHEN n.id IS NOT NULL AND o.id IS NOT NULL THEN
            (SELECT nv.[key]
             FROM OPENJSON(n.doc) nv
             JOIN OPENJSON(o.doc) ov ON ov.[key] = nv.[key]
             WHERE EXISTS (SELECT nv.value EXCEPT SELECT ov.value)
             FOR JSON PATH)
        END
    FROM new_rows n
    FULL OUTER JOIN old_rows o ON o.id = n.id;
END;
GO


-- --- dbo.rooms -----------------------------------------------------
--
-- Room inventory: what exists, and whether it is active and sellable.

IF OBJECT_ID('dbo.trg_audit_rooms', 'TR') IS NOT NULL
    DROP TRIGGER dbo.trg_audit_rooms;
GO

CREATE TRIGGER dbo.trg_audit_rooms
ON dbo.rooms
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        RETURN;

    DECLARE @actor_id   BIGINT       = TRY_CAST(SESSION_CONTEXT(N'app_user_id') AS BIGINT);
    DECLARE @actor_role NVARCHAR(20) = CAST(SESSION_CONTEXT(N'app_user_role') AS NVARCHAR(20));
    DECLARE @client_ip  NVARCHAR(45) = CAST(SESSION_CONTEXT(N'app_client_ip') AS NVARCHAR(45));

    WITH new_rows AS (
        SELECT i.id, i.lodge_id,
               (SELECT x.* FROM inserted x WHERE x.id = i.id
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS doc
        FROM inserted i
    ),
    old_rows AS (
        SELECT d.id, d.lodge_id,
               (SELECT y.* FROM deleted y WHERE y.id = d.id
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS doc
        FROM deleted d
    )
    INSERT INTO dbo.audit_log
        (table_name, record_id, action, lodge_id, actor_user_id, actor_role, client_ip,
         old_values, new_values, changed_columns)
    SELECT
        'rooms',
        COALESCE(n.id, o.id),
        CASE WHEN n.id IS NOT NULL AND o.id IS NOT NULL THEN 'UPDATE'
             WHEN n.id IS NOT NULL                      THEN 'INSERT'
             ELSE                                            'DELETE' END,
        COALESCE(n.lodge_id, o.lodge_id),
        @actor_id, @actor_role, @client_ip,
        o.doc,
        n.doc,
        CASE WHEN n.id IS NOT NULL AND o.id IS NOT NULL THEN
            (SELECT nv.[key]
             FROM OPENJSON(n.doc) nv
             JOIN OPENJSON(o.doc) ov ON ov.[key] = nv.[key]
             WHERE EXISTS (SELECT nv.value EXCEPT SELECT ov.value)
             FOR JSON PATH)
        END
    FROM new_rows n
    FULL OUTER JOIN old_rows o ON o.id = n.id;
END;
GO


-- --- dbo.room_categories -------------------------------------------
--
-- The rate card. Every room is sold at its category's base_price, so a change
-- here silently reprices the whole property — and a guest disputing their bill
-- is asking a question about this table.

IF OBJECT_ID('dbo.trg_audit_room_categories', 'TR') IS NOT NULL
    DROP TRIGGER dbo.trg_audit_room_categories;
GO

CREATE TRIGGER dbo.trg_audit_room_categories
ON dbo.room_categories
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        RETURN;

    DECLARE @actor_id   BIGINT       = TRY_CAST(SESSION_CONTEXT(N'app_user_id') AS BIGINT);
    DECLARE @actor_role NVARCHAR(20) = CAST(SESSION_CONTEXT(N'app_user_role') AS NVARCHAR(20));
    DECLARE @client_ip  NVARCHAR(45) = CAST(SESSION_CONTEXT(N'app_client_ip') AS NVARCHAR(45));

    WITH new_rows AS (
        SELECT i.id, i.lodge_id,
               (SELECT x.* FROM inserted x WHERE x.id = i.id
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS doc
        FROM inserted i
    ),
    old_rows AS (
        SELECT d.id, d.lodge_id,
               (SELECT y.* FROM deleted y WHERE y.id = d.id
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS doc
        FROM deleted d
    )
    INSERT INTO dbo.audit_log
        (table_name, record_id, action, lodge_id, actor_user_id, actor_role, client_ip,
         old_values, new_values, changed_columns)
    SELECT
        'room_categories',
        COALESCE(n.id, o.id),
        CASE WHEN n.id IS NOT NULL AND o.id IS NOT NULL THEN 'UPDATE'
             WHEN n.id IS NOT NULL                      THEN 'INSERT'
             ELSE                                            'DELETE' END,
        COALESCE(n.lodge_id, o.lodge_id),
        @actor_id, @actor_role, @client_ip,
        o.doc,
        n.doc,
        CASE WHEN n.id IS NOT NULL AND o.id IS NOT NULL THEN
            (SELECT nv.[key]
             FROM OPENJSON(n.doc) nv
             JOIN OPENJSON(o.doc) ov ON ov.[key] = nv.[key]
             WHERE EXISTS (SELECT nv.value EXCEPT SELECT ov.value)
             FOR JSON PATH)
        END
    FROM new_rows n
    FULL OUTER JOIN old_rows o ON o.id = n.id;
END;
GO

PRINT 'Audit trail installed: dbo.audit_log, dbo.vw_audit_log, 7 table triggers, append-only guard.';
GO

-- ===========================================================================
-- Reading the log
-- ===========================================================================
--
-- Reference queries. Everything below is a SELECT and changes nothing, so they
-- are safe to run on production while you are working out what happened.
--
-- ---------------------------------------------------------------------------
-- Everything that happened to one booking
-- ---------------------------------------------------------------------------
--
--   SELECT changed_at, action, actor_name, actor_role, changed_columns
--   FROM dbo.vw_audit_log
--   WHERE table_name = 'bookings' AND record_id = 123
--   ORDER BY changed_at DESC;
--
-- ---------------------------------------------------------------------------
-- Who voided invoices, and when
-- ---------------------------------------------------------------------------
--
-- The single most likely question this table will be asked.
--
--   SELECT changed_at, actor_name, actor_role, record_id,
--          JSON_VALUE(new_values, '$.invoice_number') AS invoice_number,
--          JSON_VALUE(new_values, '$.void_reason')    AS reason,
--          JSON_VALUE(old_values, '$.total_amount')   AS amount
--   FROM dbo.vw_audit_log
--   WHERE table_name = 'invoices'
--     AND action     = 'UPDATE'
--     AND JSON_VALUE(old_values, '$.status') = 'ISSUED'
--     AND JSON_VALUE(new_values, '$.status') = 'VOID'
--   ORDER BY changed_at DESC;
--
-- ---------------------------------------------------------------------------
-- Room rate changes
-- ---------------------------------------------------------------------------
--
--   SELECT changed_at, actor_name,
--          JSON_VALUE(new_values, '$.name')       AS category,
--          JSON_VALUE(old_values, '$.base_price') AS was,
--          JSON_VALUE(new_values, '$.base_price') AS [now]
--   FROM dbo.vw_audit_log
--   WHERE table_name = 'room_categories'
--     AND action     = 'UPDATE'
--     AND JSON_VALUE(old_values, '$.base_price') <> JSON_VALUE(new_values, '$.base_price')
--   ORDER BY changed_at DESC;
--
-- ---------------------------------------------------------------------------
-- One person's activity
-- ---------------------------------------------------------------------------
--
--   SELECT changed_at, table_name, record_id, action, changed_columns
--   FROM dbo.vw_audit_log
--   WHERE actor_user_id = 7
--     AND changed_at >= DATEADD(DAY, -30, SYSDATETIMEOFFSET())
--   ORDER BY changed_at DESC;
--
-- ---------------------------------------------------------------------------
-- Changes made OUTSIDE the application
-- ---------------------------------------------------------------------------
--
-- Once the app stamps SESSION_CONTEXT, a row with no actor did not come
-- through it — someone edited the database directly. Until then this returns
-- everything, so it only becomes meaningful after the app side is wired up.
--
--   SELECT changed_at, table_name, record_id, action, db_login, host_name, app_name
--   FROM dbo.vw_audit_log
--   WHERE actor_user_id IS NULL
--   ORDER BY changed_at DESC;
--
-- ---------------------------------------------------------------------------
-- Deletions of anything
-- ---------------------------------------------------------------------------
--
--   SELECT changed_at, table_name, record_id, actor_name, old_values
--   FROM dbo.vw_audit_log
--   WHERE action = 'DELETE'
--   ORDER BY changed_at DESC;
--
-- ---------------------------------------------------------------------------
-- How big is the log getting
-- ---------------------------------------------------------------------------
--
--   SELECT table_name, action, COUNT(*) AS rows_logged,
--          MIN(changed_at) AS oldest, MAX(changed_at) AS newest
--   FROM dbo.audit_log
--   GROUP BY table_name, action
--   ORDER BY rows_logged DESC;
--
-- ===========================================================================
-- Uninstalling
-- ===========================================================================
--
-- Removes the triggers and leaves the log intact, which is almost always what
-- you want — the history is the valuable part and outlives the mechanism.
--
--   DROP TRIGGER dbo.trg_audit_bookings;
--   DROP TRIGGER dbo.trg_audit_invoices;
--   DROP TRIGGER dbo.trg_audit_food_orders;
--   DROP TRIGGER dbo.trg_audit_users;
--   DROP TRIGGER dbo.trg_audit_roles;
--   DROP TRIGGER dbo.trg_audit_rooms;
--   DROP TRIGGER dbo.trg_audit_room_categories;
--
-- To trim old history you must first remove the append-only guard, which is
-- deliberately awkward — deleting audit history should be a decision, not a
-- keystroke:
--
--   DROP TRIGGER dbo.trg_audit_log_append_only;
--   DELETE FROM dbo.audit_log WHERE changed_at < DATEADD(YEAR, -7, SYSDATETIMEOFFSET());
--   -- then re-create the guard by re-running this file.
--
-- Seven years is the usual retention floor for Indian tax records. Confirm
-- against your own obligations before deleting anything.
