const { z } = require('zod');

const serviceSchema = z.object({
  name: z.string().trim().min(1, 'Service name is required.').max(100),
  unitLabel: z.string().trim().min(1).max(30).default('use'),
  price: z.coerce.number({ invalid_type_error: 'Enter a price.' }).min(0, 'Price cannot be negative.').max(9999999),
  gstRatePercent: z.coerce.number().min(0, 'GST cannot be negative.').max(28, 'GST cannot be above 28%.').default(18),
  // A garment priced for guest laundry (shirt, saree ...) rather than a service
  // started and completed on its own.
  isLaundry: z.boolean().default(false),
});

// Written out rather than serviceSchema.partial(): partial() keeps the create
// defaults, so toggling a service off would silently reset its unit, GST rate
// and laundry flag. An update only changes what it names.
const updateServiceSchema = z.object({
  name: serviceSchema.shape.name.optional(),
  unitLabel: z.string().trim().min(1).max(30).optional(),
  price: serviceSchema.shape.price.optional(),
  gstRatePercent: z.coerce.number().min(0, 'GST cannot be negative.').max(28, 'GST cannot be above 28%.').optional(),
  isLaundry: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

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
