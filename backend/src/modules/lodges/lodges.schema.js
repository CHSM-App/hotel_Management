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
    city: z.string().trim().optional().default(''),
    state: z.string().trim().optional().default(''),
    checkinMode: z.enum(['HOUR_24', 'NIGHT_BASED']).default('HOUR_24'),
    isGstRegistered: z.boolean().default(false),
    gstin: z.string().trim().optional().default(''),
    isSpecifiedPremises: z.boolean().default(false),
    ownerName: z.string().trim().min(1, 'Owner name is required.'),
    ownerEmail: z.string().trim().email('Enter a valid email.').optional().or(z.literal('')).default(''),
    ownerPhone: z.string().trim().min(1, 'Owner phone is required.'),
    tempPassword: z.string().min(6, 'Temporary password must be at least 6 characters.'),
  })
  .refine((data) => !data.isGstRegistered || data.gstin.length > 0, {
    message: 'Enter the GSTIN, or turn off GST registration.',
    path: ['gstin'],
  });

module.exports = { createLodgeSchema };
