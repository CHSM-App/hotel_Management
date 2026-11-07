-- lodge_enquiries.summary dropped
--
-- The composed free-text message the public Enquire form used to send
-- alongside the structured fields (name, dates, room type, guests, extras,
-- phone — all still stored as their own columns). Decided not to keep it:
-- everything it said is already captured structurally, and there's no
-- reason to also hold a guest-composed paragraph. The public page still
-- builds that same text client-side for its own "message us on WhatsApp"
-- fallback link (LodgePublicPage.jsx's buildMessage) — only the storing of
-- it was removed, not the composing.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.lodge_enquiries', 'summary') IS NOT NULL
ALTER TABLE dbo.lodge_enquiries DROP COLUMN summary;
GO
