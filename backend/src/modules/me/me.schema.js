const { z } = require('zod');

const currentPassword = z
  .string({ error: 'Enter your current password.' })
  .min(1, 'Enter your current password.');

// Step 1 asks only for the current password: the new one is not collected until
// the code has arrived, so there is nothing to validate about it yet.
const sendPasswordOtpSchema = z.object({ currentPassword });

const changePasswordSchema = z.object({
  currentPassword,
  newPassword: z
    .string({ error: 'Enter a new password.' })
    .min(8, 'New password must be at least 8 characters.'),
  // Exactly six digits. Trimmed first because the code arrives by WhatsApp and
  // gets pasted with whitespace around it more often than not.
  otp: z
    .string({ error: 'Enter the code sent to your phone.' })
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code sent to your phone.'),
});

// A map pin, same shape as lodges.schema's coordinate() — kept separate rather
// than shared because this schema only ever touches the fields an owner is
// allowed to change, not the property's structure.
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

// What an owner may change about their own property from the dashboard's
// profile menu. Deliberately narrower than internal's updateLodgeSchema: the
// slug (their public URL), check-in mode, GST-registered switch and what the
// property actually sells (rooms/food/events) stay something only Vengurla
// Tech's admin panel touches, since those ripple into billing and routing in
// ways a quick edit here shouldn't risk.
const updateMyLodgeSchema = z.object({
  lodgeName: z.string().trim().min(1, 'Enter the property name.').max(200),
  phone: z.string().trim().max(50).optional().default(''),
  whatsappNumber: z.string().trim().max(50).optional().default(''),
  address: z.string().trim().max(500).optional().default(''),
  lodgeNameMr: z.string().trim().max(200).optional().default(''),
  addressMr: z.string().trim().max(500).optional().default(''),
  city: z.string().trim().max(100).optional().default(''),
  state: z.string().trim().max(100).optional().default(''),
  latitude: coordinate(-90, 90, 'Latitude').default(null),
  longitude: coordinate(-180, 180, 'Longitude').default(null),
  gstin: z.string().trim().max(20).optional().default(''),
  // Whether the uploaded logo (if any) prints on the bill masthead. Separate
  // from the upload itself so a logo can exist for the dashboard brand mark
  // without appearing on a legal document until the owner opts in.
  showLogoOnReceipt: z.boolean().optional(),
})
  .refine(
    (data) => (data.latitude === null) === (data.longitude === null),
    { message: 'Enter both latitude and longitude, or leave both empty.', path: ['latitude'] }
  );

module.exports = { changePasswordSchema, sendPasswordOtpSchema, updateMyLodgeSchema };
