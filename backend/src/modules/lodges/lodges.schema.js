const { z } = require('zod');

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
    checkinMode: z.enum(['HOUR_24', 'NIGHT_BASED']).default('HOUR_24'),
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
    ownerName: z.string().trim().min(1, 'Owner name is required.'),
    ownerEmail: z.string().trim().email('Enter a valid email.').optional().or(z.literal('')).default(''),
    ownerPhone: z.string().trim().min(1, 'Owner phone is required.'),
    tempPassword: z.string().min(6, 'Temporary password must be at least 6 characters.'),
  })
  .refine((data) => !data.isGstRegistered || data.gstin.length > 0, {
    message: 'Enter the GSTIN, or turn off GST registration.',
    path: ['gstin'],
  })
  .refine((data) => data.hasRooms || data.servesFood, {
    message: 'A property with no rooms and no food service has nothing to sell.',
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

module.exports = { createLodgeSchema };
