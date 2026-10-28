-- Map coordinates for a property.
--
-- Where the property actually is, as a latitude/longitude pair. The address
-- fields say what to print on a bill; this says where to drop the pin — for a
-- directions link on the public page, and for anything later that needs to
-- know which properties are near a guest. Captured at onboarding by internal
-- staff, either typed in or picked off a map, and correctable afterwards.
--
-- DECIMAL(9,6): six decimal places is roughly 10 cm, more than any map pin
-- needs, and 9 digits holds -180.000000. Both nullable, and either both are
-- set or neither is — half a coordinate is not a place.
--
-- Remember: the same change must also land in src/config/schema.sql.
IF COL_LENGTH('dbo.lodges', 'latitude') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD latitude DECIMAL(9,6) NULL');
GO

IF COL_LENGTH('dbo.lodges', 'longitude') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD longitude DECIMAL(9,6) NULL');
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_lodges_coordinates')
    EXEC('ALTER TABLE dbo.lodges WITH CHECK ADD CONSTRAINT ck_lodges_coordinates CHECK (
        (latitude IS NULL AND longitude IS NULL)
     OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))');
GO
