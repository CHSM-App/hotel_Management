const { z } = require('zod');
const { normaliseMobile } = require('../bookings/bookings.schema');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Blank stays blank — a quotation can be for "someone who rang" — but anything
// typed has to be a real mobile, the same rule the booking form applies.
const optionalPhone = z.preprocess(
  (v) => {
    const digits = normaliseMobile(v);
    return digits === '' || digits == null ? undefined : digits;
  },
  z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number.').optional()
);

const optionalName = z
  .string()
  .trim()
  .max(120, 'Keep the name under 120 characters.')
  .nullish()
  .transform((v) => v || null);

// Only what the desk chose. Lines and totals are never taken from the client:
// the service prices every room again, so a stored quotation cannot disagree
// with the rate card.
const quotationRoomSchema = z.object({
  roomId: z.coerce.number().int().positive('Choose a room.'),
  fromDate: z.string().regex(DATE_RE, 'Choose a from date.'),
  toDate: z.string().regex(DATE_RE, 'Choose a to date.'),
  // "3,5:2" — the same selection string /pricing/simulate takes.
  chargeIds: z.string().max(200).nullish(),
});

const createQuotationSchema = z.object({
  guestName: optionalName,
  guestPhone: optionalPhone,
  rooms: z.array(quotationRoomSchema).min(1, 'Add at least one room.').max(20, 'Quote up to 20 rooms at a time.'),
});

const updateQuotationSchema = z
  .object({
    guestName: optionalName.optional(),
    guestPhone: optionalPhone,
    status: z.literal('BOOKED').optional(),
    bookingId: z.coerce.number().int().positive().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' });

module.exports = { createQuotationSchema, updateQuotationSchema };
