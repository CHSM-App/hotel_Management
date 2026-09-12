-- The lodge's name and address in Marathi, for the bill's masthead.
--
-- The printed bill book these lodges come from heads the sheet in Devanagari —
-- "आनंद एक्झिक्युटिव्ह" — with the rest of the form in English. The app's bill
-- can now do the same, but only from text the property actually supplied: a
-- transliteration guessed by a machine has no place on a tax document, so an
-- empty column here simply means that lodge's masthead stays in English.
--
-- Two columns rather than a locale table: the masthead is the only thing that
-- translates, and Marathi is the only language these properties asked for.
-- A general i18n scheme would be scaffolding for requirements nobody has.

IF COL_LENGTH('dbo.lodges', 'name_mr') IS NULL
    ALTER TABLE dbo.lodges ADD name_mr NVARCHAR(200) NULL;

IF COL_LENGTH('dbo.lodges', 'address_mr') IS NULL
    ALTER TABLE dbo.lodges ADD address_mr NVARCHAR(500) NULL;
