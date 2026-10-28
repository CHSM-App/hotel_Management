-- room_categories: optional tape chart display order
--
-- Lets an owner control which category section leads on the tape chart.
-- Optional — a category with no tape_order sorts after ordered ones, by id
-- (creation order), so leaving it blank behaves as "add to the end".
--
-- Remember: the same change must also land in src/config/schema.sql.

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.room_categories') AND name = 'tape_order'
)
BEGIN
    ALTER TABLE dbo.room_categories ADD tape_order INT NULL;
END
GO
