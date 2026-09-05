const { z } = require('zod');

// A map pin. The form sends numbers (or null / '' when the pin was cleared);
// a string is accepted so a coordinate pasted straight from Google Maps is not
// rejected for being text. Six decimal places is what the column stores.
const coordinate = (min, max, label) =>
  z.preprocess(
    (value) => {
      if (value === '' || value === undefined || value === null) return null;
      return typeof value === 'string' ? Number(value.trim()) : value;
    },
    z
      .number({ error: `${label} must be a number.` })
      .min(min, `${label} must be between ${min} and ${max}.`)
      .max(max, `${label} must be between ${min} and ${max}.`)
      .nullable()
  );

const latitude = coordinate(-90, 90, 'Latitude');
const longitude = coordinate(-180, 180, 'Longitude');

// Half a coordinate is not a place: the pair is stored together or not at all.
// On an update, a payload carrying only one half is judged against the stored
// row in the service instead.
const coordinatesPaired = [
  (data) =>
    data.latitude === undefined || data.longitude === undefined
      ? true
      : (data.latitude === null) === (data.longitude === null),
  { message: 'Enter both latitude and longitude, or leave both empty.', path: ['latitude'] },
];

const createLodgeSchema = z
  .object({
    lodgeName: z.string().trim().min(1, 'Lodge name is required.'),
    slug: z
      .string()
      .trim()
      .min(1, 'Slug is required.')
      .regex(/^[a-z0-9-]+$/, 'Slug can only have lowercase letters, numbers and hyphens.'),
    phone: z.string().trim().optional().default(''),
    whatsappNumber: z.string().trim().optional().default(''),
    address: z.string().trim().optional().default(''),
    // The masthead in Devanagari, exactly as the property writes it. Optional:
    // a lodge without them simply bills in English.
    lodgeNameMr: z.string().trim().max(200).optional().default(''),
    addressMr: z.string().trim().max(500).optional().default(''),
    city: z.string().trim().optional().default(''),
    state: z.string().trim().optional().default(''),
    // Where the property is on a map. Optional — not every onboarding has the
    // pin to hand — but when given, both halves must be.
    latitude: latitude.default(null),
    longitude: longitude.default(null),
    checkinMode: z.enum(['HOUR_24', 'NIGHT_BASED', 'CYCLE']).default('HOUR_24'),
    isGstRegistered: z.boolean().default(false),
    gstin: z.string().trim().optional().default(''),
    isSpecifiedPremises: z.boolean().default(false),
    // What kind of property this is. Defaults describe the original product —
    // a lodge with rooms and no food — so an existing caller that omits them
    // registers exactly what it used to.
    hasRooms: z.boolean().default(true),
    servesFood: z.boolean().default(false),
    foodRoomService: z.boolean().default(false),
    foodTableService: z.boolean().default(false),
    // A hall, lawn or terrace let out for functions. Independent of the other
    // two: a rooms-only lodge with a lawn and a restaurant with a party hall
    // are both real.
    hasEvents: z.boolean().default(false),
    ownerName: z.string().trim().min(1, 'Owner name is required.'),
    ownerEmail: z.string().trim().email('Enter a valid email.').optional().or(z.literal('')).default(''),
    ownerPhone: z.string().trim().min(1, 'Owner phone is required.'),
    tempPassword: z.string().min(6, 'Temporary password must be at least 6 characters.'),
  })
  .refine((data) => !data.isGstRegistered || data.gstin.length > 0, {
    message: 'Enter the GSTIN, or turn off GST registration.',
    path: ['gstin'],
  })
  .refine(...coordinatesPaired)
  .refine((data) => data.hasRooms || data.servesFood || data.hasEvents, {
    message: 'A property with no rooms, no food service and no venue has nothing to sell.',
    path: ['hasRooms'],
  })
  .refine((data) => !data.foodRoomService || data.hasRooms, {
    message: 'In-room ordering needs rooms — turn it off for a restaurant.',
    path: ['foodRoomService'],
  })
  .refine((data) => data.servesFood || (!data.foodRoomService && !data.foodTableService), {
    message: 'Turn on food service before choosing how orders are taken.',
    path: ['servesFood'],
  })
  // "Specified premises" is a GST status defined by accommodation: the property
  // charged over ₹7,500 per room per night in the preceding financial year, or
  // its owner filed a declaration opting in. Its only effect here is to tax
  // food at 18% with ITC instead of 5% without. A property with no rooms can't
  // hold that status, and one with no kitchen has no food supply to rate — so
  // in either case the flag would silently misprice a bill.
  .refine((data) => !data.isSpecifiedPremises || (data.hasRooms && data.servesFood), {
    message: 'Specified premises only applies to a property that has rooms and serves food.',
    path: ['isSpecifiedPremises'],
  });

// What internal staff may change on a property after go-live. Every field is
// optional and independently updatable; the cross-field rules (a GSTIN when
// registered, food before food service, something to sell) are re-checked in
// the service against the merged row, because they need what is already
// stored to be judged.
const updateLodgeSchema = z.object({
  lodgeName: z.string().trim().min(1, 'Lodge name is required.').max(200).optional(),
  slug: z
    .string()
    .trim()
    .min(1, 'Slug is required.')
    .regex(/^[a-z0-9-]+$/, 'Slug can only have lowercase letters, numbers and hyphens.')
    .optional(),
  phone: z.string().trim().max(50).optional(),
  whatsappNumber: z.string().trim().max(50).optional(),
  address: z.string().trim().max(500).optional(),
  lodgeNameMr: z.string().trim().max(200).optional(),
  addressMr: z.string().trim().max(500).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  // null clears the pin.
  latitude: latitude.optional(),
  longitude: longitude.optional(),
  checkinMode: z.enum(['HOUR_24', 'NIGHT_BASED', 'CYCLE']).optional(),
  isGstRegistered: z.boolean().optional(),
  gstin: z.string().trim().max(20).optional(),
  isSpecifiedPremises: z.boolean().optional(),
  hasRooms: z.boolean().optional(),
  servesFood: z.boolean().optional(),
  foodRoomService: z.boolean().optional(),
  foodTableService: z.boolean().optional(),
  hasEvents: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

module.exports = { createLodgeSchema, updateLodgeSchema };
