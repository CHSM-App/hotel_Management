const { z } = require('zod');

// Two, not three: egg used to be its own type and has been folded into
// non-veg — see the migration in schema.sql, which moved the dishes and put
// the same pair on the CHECK constraint. An old client still sending 'EGG' is
// refused here rather than at the database.
const FOOD_TYPES = ['VEG', 'NON_VEG'];

// What a stored food_type means today. The schema migration rewrites every EGG
// row to NON_VEG, but init-db is a deploy step rather than something that runs
// on boot — so between the two, a database can still hand back a type no screen
// has a group or a mark for, and the dishes carrying it would silently vanish
// from the menu they're grouped into. Reads go through here so that can't
// happen; the constraint, not this, is what stops new ones being written.
function normaliseFoodType(value) {
  return value === 'EGG' ? 'NON_VEG' : value;
}

const createMenuCategorySchema = z.object({
  name: z.string().trim().min(1, 'Section name is required.'),
  sortOrder: z.coerce.number().int().min(0).optional().default(0),
});

// The dish form is multipart now that it can carry a photo, so every field
// arrives as a string — which the coercions here already handled, except for a
// checkbox, whose "true"/"false" needs saying out loud.
const formBoolean = z.preprocess((value) => {
  if (typeof value === 'string') return value === 'true' || value === '1';
  return value;
}, z.boolean().optional().default(false));

const createMenuItemSchema = z.object({
  categoryId: z.coerce.number().int().positive('Choose a menu section.'),
  name: z.string().trim().min(1, 'Item name is required.'),
  description: z.string().trim().max(300).optional().default(''),
  price: z.coerce.number().min(0, 'Price can’t be negative.'),
  foodType: z.enum(FOOD_TYPES, { error: 'Choose veg or non-veg.' }).optional().default('VEG'),
  sortOrder: z.coerce.number().int().min(0).optional().default(0),
  // Only an edit can mean it: "take the photo off this dish", as distinct from
  // an edit that simply doesn't mention the photo and leaves it where it is.
  removeImage: formBoolean,
});

// A dish's sizes in the order they should appear. An empty list is the way
// back to a single-price dish, so it is valid on purpose — see setItemPortions.
const itemPortionsSchema = z.object({
  portions: z
    .array(
      z.object({
        label: z.string().trim().min(1, 'Every size needs a name, like “Half plate”.').max(60),
        price: z.coerce.number().min(0, 'Price can’t be negative.'),
        isAvailable: z.boolean().optional().default(true),
      })
    )
    .max(10, 'That’s a lot of sizes for one dish.')
    .default([]),
});

const availabilitySchema = z.object({
  isAvailable: z.boolean({ error: 'isAvailable must be true or false.' }),
});

const statusSchema = z.object({ isActive: z.boolean({ error: 'isActive must be true or false.' }) });

// hasRooms is deliberately absent — whether a property has rooms at all is set
// by Vengurla Tech at onboarding, not toggled by the owner. Turning it off on a
// live lodge would strand its bookings behind a hidden section.
const foodSettingsSchema = z.object({
  servesFood: z.boolean({ error: 'servesFood must be true or false.' }),
  foodRoomService: z.boolean({ error: 'foodRoomService must be true or false.' }),
  foodTableService: z.boolean({ error: 'foodTableService must be true or false.' }),
});

// One row of a parsed menu spreadsheet — already turned into JS values by
// read-excel-file on the client, so this only has to check what a human
// editing a cell could still get wrong (a blank name, a non-numeric price, a
// "Veg?" typo), not parse text itself. Left loose (raw strings/unknowns pass
// through) rather than as the array element type of menuImportSchema below —
// one malformed row has to fail on its own inside importRows, not sink the
// zod parse for every row that came with it.
const menuImportRowSchema = z.object({
  section: z.string().trim().min(1, 'Section is required.'),
  name: z.string().trim().min(1, 'Item name is required.'),
  description: z.string().trim().max(300).optional().default(''),
  price: z.coerce.number().min(0, 'Price can’t be negative.'),
  foodType: z.enum(FOOD_TYPES, { error: 'Type must be VEG or NON_VEG.' }).optional().default('VEG'),
});

// The envelope only checks there's a non-empty, not-absurd array of raw row
// objects — each row's own fields are validated individually in importRows
// via menuImportRowSchema, so a typo in row 40 doesn't block rows 1-39.
const menuImportSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1, 'The file has no rows to import.').max(2000),
});

module.exports = {
  FOOD_TYPES,
  normaliseFoodType,
  createMenuCategorySchema,
  updateMenuCategorySchema: createMenuCategorySchema,
  createMenuItemSchema,
  updateMenuItemSchema: createMenuItemSchema,
  itemPortionsSchema,
  availabilitySchema,
  statusSchema,
  foodSettingsSchema,
  menuImportSchema,
};
