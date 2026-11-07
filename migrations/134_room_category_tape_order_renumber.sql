-- room_categories: renumber tape_order to 1..n per lodge
--
-- Saving a category now shifts the others to make room, so two categories
-- never share a position. This closes the duplicates and blanks left from
-- before: each lodge's categories keep their current order (blanks last, ties
-- by id) and are numbered 1..n.
--
-- Data only — nothing to mirror in src/config/schema.sql. Safe to re-run:
-- only rows whose number differs are touched.

WITH ordered AS (
    SELECT tape_order,
           ROW_NUMBER() OVER (
               PARTITION BY lodge_id
               ORDER BY CASE WHEN tape_order IS NULL THEN 1 ELSE 0 END, tape_order, id
           ) AS pos
    FROM dbo.room_categories
)
UPDATE ordered SET tape_order = pos WHERE tape_order IS NULL OR tape_order <> pos;
GO
