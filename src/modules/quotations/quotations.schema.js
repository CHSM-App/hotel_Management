const { z } = require('zod');
const { normaliseMobile } = require('../bookings/bookings.schema');
const { quoteSchema: eventQuoteSchema } = require('../events/events.schema');

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

const KINDS = ['ROOM', 'EVENT', 'FOOD', 'BAR'];

const base = { guestName: optionalName, guestPhone: optionalPhone };
const qty = z.coerce.number().int().min(1, 'Enter a quantity.').max(999, 'That quantity looks wrong.');
const note = z.string().trim().max(300).nullish().transform((v) => v || null);
const discount = z.coerce.number().min(0, 'Enter a valid discount.').max(10000000).optional().default(0);

const roomPart = { rooms: z.array(quotationRoomSchema).min(1, 'Add at least one room.').max(20, 'Quote up to 20 rooms at a time.') };
// Same pricing fields the live event quote takes; the service prices it again.
const eventPart = { event: eventQuoteSchema, note };
const foodPart = {
  items: z
    .array(
      z.object({
        itemId: z.coerce.number().int().positive('Choose an item.'),
        portionId: z.coerce.number().int().positive().nullish(),
        quantity: qty,
      })
    )
    .min(1, 'Add at least one item.')
    .max(100, 'That is too many items for one quotation.'),
  discountAmount: discount,
  note,
};
const barPart = {
  items: z
    .array(z.object({ menuItemId: z.coerce.number().int().positive('Choose an item.'), quantity: qty }))
    .min(1, 'Add at least one item.')
    .max(100, 'That is too many items for one quotation.'),
  discountAmount: discount,
  note,
};

// kind defaults to ROOM so the existing room client keeps working unchanged.
const createQuotationSchema = z.preprocess(
  (v) => (v && typeof v === 'object' && v.kind == null ? { ...v, kind: 'ROOM' } : v),
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('ROOM'), ...base, ...roomPart }),
    z.object({ kind: z.literal('EVENT'), ...base, ...eventPart }),
    z.object({ kind: z.literal('FOOD'), ...base, ...foodPart }),
    z.object({ kind: z.literal('BAR'), ...base, ...barPart }),
  ])
);

const updateQuotationSchema = z
  .object({
    guestName: optionalName.optional(),
    guestPhone: optionalPhone,
    status: z.literal('BOOKED').optional(),
    bookingId: z.coerce.number().int().positive().optional(),
    // Event / food order / bar order id for the non-room kinds.
    refId: z.coerce.number().int().positive().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' });

module.exports = { createQuotationSchema, updateQuotationSchema, KINDS };
