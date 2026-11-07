-- "Hotel linen" is not a word lodge staff use. The asset category that feeds
-- Laundry is called "Bedsheets & Towels" instead. It is still found by its
-- is_linen flag, so only the label changes; a property that already has a
-- category by the new name keeps both rather than colliding on the unique name.
--
-- Remember: the same change must also land in src/config/schema.sql.

UPDATE c
SET c.name = N'Bedsheets & Towels'
FROM dbo.asset_categories c
WHERE c.is_linen = 1 AND LOWER(LTRIM(RTRIM(c.name))) = 'hotel linen'
  AND NOT EXISTS (SELECT 1 FROM dbo.asset_categories o WHERE o.lodge_id = c.lodge_id AND o.name = N'Bedsheets & Towels');
GO
