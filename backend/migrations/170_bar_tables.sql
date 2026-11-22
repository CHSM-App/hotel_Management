-- Separate table setup for the bar (170). dining_tables gets an area: 'RESTAURANT' for every
-- existing row, 'BAR' for tables set up under Bar. A label is unique per area, so the bar can
-- have its own "T1". Remember: the same change must also land in src/config/schema.sql.
IF COL_LENGTH('dbo.dining_tables', 'area') IS NULL
    EXEC('ALTER TABLE dbo.dining_tables ADD area NVARCHAR(10) NOT NULL CONSTRAINT df_dining_tables_area DEFAULT ''RESTAURANT'' CONSTRAINT ck_dining_tables_area CHECK (area IN (''RESTAURANT'',''BAR''))');
GO

IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'uq_dining_tables_lodge_label' AND parent_object_id = OBJECT_ID('dbo.dining_tables'))
    ALTER TABLE dbo.dining_tables DROP CONSTRAINT uq_dining_tables_lodge_label;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_dining_tables_lodge_area_label' AND object_id = OBJECT_ID('dbo.dining_tables'))
    CREATE UNIQUE INDEX uq_dining_tables_lodge_area_label ON dbo.dining_tables(lodge_id, area, label);
GO
