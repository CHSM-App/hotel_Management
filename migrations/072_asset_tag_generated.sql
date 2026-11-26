-- asset_tag becomes system-generated and unique per lodge.
--
-- A free-text tag let two assets collide on the same sticker, or one
-- owner's "AC1" mean nothing to the next. Generated tags (AST-0001,
-- AST-0002…) are real identifiers instead. Existing rows (asset_tag NULL
-- from before this migration) are backfilled from the same counter before
-- the column is locked to NOT NULL, so the constraint never fails against
-- data already in the table.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF OBJECT_ID('dbo.asset_tag_counters', 'U') IS NULL
CREATE TABLE dbo.asset_tag_counters (
    lodge_id     BIGINT NOT NULL PRIMARY KEY REFERENCES dbo.lodges(id),
    next_number  INT NOT NULL DEFAULT 1
);
GO

-- Backfill: one counter per lodge that has assets, then number every
-- untagged row in a stable order (oldest first) starting from 1.
IF COL_LENGTH('dbo.assets', 'asset_tag') IS NOT NULL
BEGIN
    INSERT INTO dbo.asset_tag_counters (lodge_id, next_number)
    SELECT DISTINCT lodge_id, 1
    FROM dbo.assets a
    WHERE (a.asset_tag IS NULL OR a.asset_tag = '')
      AND NOT EXISTS (SELECT 1 FROM dbo.asset_tag_counters c WHERE c.lodge_id = a.lodge_id);

    ;WITH untagged AS (
        SELECT id, lodge_id,
               ROW_NUMBER() OVER (PARTITION BY lodge_id ORDER BY id) AS rn
        FROM dbo.assets
        WHERE asset_tag IS NULL OR asset_tag = ''
    )
    UPDATE a
    SET a.asset_tag = 'AST-' + RIGHT('0000' + CAST(u.rn AS VARCHAR(10)), 4)
    FROM dbo.assets a
    JOIN untagged u ON u.id = a.id;

    UPDATE c
    SET c.next_number = ISNULL(t.max_rn, 0) + 1
    FROM dbo.asset_tag_counters c
    OUTER APPLY (
        SELECT MAX(CAST(SUBSTRING(a.asset_tag, 5, 10) AS INT)) AS max_rn
        FROM dbo.assets a
        WHERE a.lodge_id = c.lodge_id AND a.asset_tag LIKE 'AST-%'
          AND ISNUMERIC(SUBSTRING(a.asset_tag, 5, 10)) = 1
    ) t;
END
GO

IF COL_LENGTH('dbo.assets', 'asset_tag') IS NOT NULL
    EXEC('ALTER TABLE dbo.assets ALTER COLUMN asset_tag NVARCHAR(40) NOT NULL');
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_assets_lodge_tag' AND object_id = OBJECT_ID('dbo.assets'))
    ALTER TABLE dbo.assets ADD CONSTRAINT uq_assets_lodge_tag UNIQUE (lodge_id, asset_tag);
GO
