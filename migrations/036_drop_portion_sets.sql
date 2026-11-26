-- Retired objects: the first cut of portions
--
-- Portions first shipped routed through reusable "portion sets": a lodge
-- defined "Half / Full" once and each dish pointed at it. It was one step more
-- than the job needed, and menu_item_portions carries the label directly now.
--
-- Nothing in these migrations ever creates these tables, so on a database built
-- from this set the file is a no-op. It is here for a database that ran the
-- older schema.sql and is being carried forward, where the unwinding of
-- set_option_id and portion_set_id has already happened and only the empty
-- shells remain.

-- ---------------------------------------------------------------------------
-- Retired objects
-- ---------------------------------------------------------------------------
-- Portions first shipped routed through reusable "portion sets": a lodge defined
-- "Half / Full" once and each dish pointed at it. It was one step more than the
-- job needed, and menu_item_portions above carries the label directly instead.
--
-- Nothing above ever creates these, so on a database built by this file the two
-- statements are no-ops. They are here for a database that ran the older
-- schema.sql and is being carried forward, where the unwinding of set_option_id
-- and portion_set_id has already happened and only the empty shells remain.
IF OBJECT_ID('dbo.portion_set_options', 'U') IS NOT NULL DROP TABLE dbo.portion_set_options;
GO

IF OBJECT_ID('dbo.portion_sets', 'U') IS NOT NULL DROP TABLE dbo.portion_sets;
GO
