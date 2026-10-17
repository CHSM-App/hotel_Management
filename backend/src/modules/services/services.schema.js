const { z } = require('zod');

// The service form is multipart now that it can carry a photo, so every field
// arrives as a string — which the coercions below already handled, except for
// a checkbox, whose "true"/"false" needs saying out loud. See menu.schema.js,
// which carries the same comment for the same reason.
const formBoolean = z.preprocess((value) => {
  if (typeof value === 'string') return value === 'true' || value === '1';
  return value;
}, z.boolean());

const serviceSchema = z.object({
  name: z.string().trim().min(1, 'Service name is required.').max(100),
  unitLabel: z.string().trim().min(1).max(30).default('use'),
  price: z.coerce.number({ invalid_type_error: 'Enter a price.' }).min(0, 'Price cannot be negative.').max(9999999),
  gstRatePercent: z.coerce.number().min(0, 'GST cannot be negative.').max(28, 'GST cannot be above 28%.').default(18),
  // A garment priced for guest laundry (shirt, saree ...) rather than a service
  // started and completed on its own.
  isLaundry: formBoolean.default(false),
});

// Written out rather than serviceSchema.partial(): partial() keeps the create
// defaults, so toggling a service off would silently reset its unit, GST rate
// and laundry flag. An update only changes what it names.
const updateServiceSchema = z.object({
  name: serviceSchema.shape.name.optional(),
  unitLabel: z.string().trim().min(1).max(30).optional(),
  price: serviceSchema.shape.price.optional(),
  gstRatePercent: z.coerce.number().min(0, 'GST cannot be negative.').max(28, 'GST cannot be above 28%.').optional(),
  isLaundry: formBoolean.optional(),
  isActive: formBoolean.optional(),
  // Only an edit can mean it: "take the photo off this service", as distinct
  // from an edit that simply doesn't mention the photo and leaves it alone.
  removeImage: formBoolean.optional().default(false),
});

const startUsageSchema = z.object({
  serviceId: z.coerce.number().int().positive('Choose a service.'),
  quantity: z.coerce.number().positive('Quantity must be more than 0.').max(100000).default(1),
  headcount: z.coerce.number().int().positive('Head count must be at least 1.').max(1000).default(1),
  // A guest staying in-house; the room and name are read off the stay.
  bookingId: z.preprocess((v) => (v === '' || v == null ? null : v), z.coerce.number().int().positive().nullable().optional()),
  guestName: z.string().trim().max(200).optional().default(''),
  guestPhone: z.string().trim().max(20).optional().default(''),
  note: z.string().trim().max(300).optional().default(''),
});

// Written out rather than startUsageSchema.partial(), for the same reason as
// updateServiceSchema: calling .optional() on a field that already carries a
// .default() does not stop the default from firing on an absent field (it
// still resolves to that default before "optional" is ever asked), so an
// edit that only touches the note would silently reset quantity and head
// count to 1. The service itself isn't editable here — only the catalogue
// pick at start time decides what was used; correcting that means cancelling
// and starting again, not retargeting an existing use at a different price.
const updateUsageSchema = z.object({
  quantity: z.coerce.number().positive('Quantity must be more than 0.').max(100000).optional(),
  headcount: z.coerce.number().int().positive('Head count must be at least 1.').max(1000).optional(),
  // Only an empty string (the guest picker cleared to "Walk-in") becomes
  // null here — an absent field stays undefined, so the service layer can
  // tell "switched to walk-in" apart from "guest picker wasn't touched."
  bookingId: z.preprocess((v) => (v === '' ? null : v), z.coerce.number().int().positive().nullable().optional()),
  guestName: z.string().trim().max(200).optional(),
  guestPhone: z.string().trim().max(20).optional(),
  note: z.string().trim().max(300).optional(),
});

const idsSchema = z.object({
  usageIds: z.array(z.coerce.number().int().positive()).min(1, 'Select at least one service.').max(200),
});

module.exports = { serviceSchema, updateServiceSchema, startUsageSchema, updateUsageSchema, idsSchema };
