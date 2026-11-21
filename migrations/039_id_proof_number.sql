-- The guest's ID number, typed in, as an ALTERNATIVE to uploading a scan.
--
-- This column existed once and was dropped when the upload replaced it. The
-- upload-only rule turned out to be too strict for the desk it runs on: a
-- receptionist holding a guest's Aadhaar card with no scanner nearby could not
-- complete a walk-in at all, and the workaround — pick a type, skip the file —
-- was closed off by the controller guard. So the number is back, not as the
-- replacement it used to be, but as the second of two ways to satisfy the same
-- requirement. Either the document or the number identifies the guest; the ID
-- type alone still does not.
--
-- Both tables, because an additional guest on a booking is registered the same
-- way the primary one is.
--
-- NVARCHAR(50) and nothing else: no format check per ID type, and no NOT NULL.
-- An Aadhaar is 12 digits, a passport is not, and a desk that mistypes one is
-- making a correctable clerical error rather than crossing a security boundary
-- — the uploaded document is what carries evidential weight. Validating shape
-- here would reject legitimate IDs and push staff back to recording nothing.

IF OBJECT_ID('dbo.bookings', 'U') IS NOT NULL AND COL_LENGTH('dbo.bookings', 'id_proof_number') IS NULL
    ALTER TABLE dbo.bookings ADD id_proof_number NVARCHAR(50) NULL;
GO

IF OBJECT_ID('dbo.booking_guests', 'U') IS NOT NULL AND COL_LENGTH('dbo.booking_guests', 'id_proof_number') IS NULL
    ALTER TABLE dbo.booking_guests ADD id_proof_number NVARCHAR(50) NULL;
