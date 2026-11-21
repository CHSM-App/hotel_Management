-- How many people shared one service use, alongside quantity (how much of
-- the service's own rate unit -- hours, km, sessions... -- they used
-- together). line_total = unit_price * quantity * headcount, computed once
-- in startUsage() and never recomputed, same as quantity always has been.
IF COL_LENGTH('dbo.service_usages', 'headcount') IS NULL
    EXEC('ALTER TABLE dbo.service_usages ADD headcount INT NOT NULL
          CONSTRAINT df_service_usages_headcount DEFAULT 1
          CONSTRAINT ck_service_usages_headcount CHECK (headcount > 0)');
GO
