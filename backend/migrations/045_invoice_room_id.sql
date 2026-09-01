-- invoice_room_id
--
-- The room a food-only bill was raised against.
--
-- This file is both halves at once: a guarded ADD, so it builds alongside
-- 004-044, and carries an existing database forward.
--
-- Remember: the same change must also land in src/config/schema.sql.

-- ---------------------------------------------------------------------------
-- invoices.room_id
-- ---------------------------------------------------------------------------

-- An open food tab is one payer's running total. Table orders key on table_id,
-- counter orders on neither — and room service with nobody checked in had
-- nothing to key on at all, because its table_id is null exactly like the
-- counter's. So it was swept into the counter tab, and a room's food was billed
-- on the same document as an unrelated walk-in's.
--
-- Room service placed against a live stay is unaffected: it carries a
-- booking_id and settles on that stay's bill at checkout, as it always has.
--
-- Nullable, and null on every existing row, which is truthful for them: they
-- were raised against a table or the counter, never a room.
IF COL_LENGTH('dbo.invoices', 'room_id') IS NULL
    ALTER TABLE dbo.invoices ADD room_id BIGINT NULL REFERENCES dbo.rooms(id);
