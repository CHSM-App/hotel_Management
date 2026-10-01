const { z } = require('zod');

const serviceSchema = z.object({
  name: z.string().trim().min(1, 'Service name is required.').max(100),
  unitLabel: z.string().trim().min(1).max(30).default('use'),
  price: z.coerce.number({ invalid_type_error: 'Enter a price.' }).min(0, 'Price cannot be negative.').max(9999999),
  gstRatePercent: z.coerce.number().min(0, 'GST cannot be negative.').max(28, 'GST cannot be above 28%.').default(18),
});

const updateServiceSchema = serviceSchema.partial().extend({ isActive: z.boolean().optional() });

const startUsageSchema = z.object({
  serviceId: z.coerce.number().int().positive('Choose a service.'),
  quantity: z.coerce.number().positive('Quantity must be more than 0.').max(100000).default(1),
  // A guest staying in-house; the room and name are read off the stay.
  bookingId: z.preprocess((v) => (v === '' || v == null ? null : v), z.coerce.number().int().positive().nullable().optional()),
  guestName: z.string().trim().max(200).optional().default(''),
  guestPhone: z.string().trim().max(20).optional().default(''),
  note: z.string().trim().max(300).optional().default(''),
});

const idsSchema = z.object({
  usageIds: z.array(z.coerce.number().int().positive()).min(1, 'Select at least one service.').max(200),
});

module.exports = { serviceSchema, updateServiceSchema, startUsageSchema, idsSchema };
