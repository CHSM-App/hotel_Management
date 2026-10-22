const { z } = require('zod');
const { normaliseMobile } = require('../bookings/bookings.schema');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const optionalDate = z
  .string()
  .regex(DATE_RE, 'Enter a valid date.')
  .nullish()
  .transform((v) => v || null);

const optionalId = z.coerce.number().int().positive().nullish().transform((v) => v ?? null);

const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .nullish()
    .transform((v) => v || null);

// What the public page sends. `website` is a honeypot: the form never shows it,
// so only a bot fills it in — the service quietly drops those.
const publicEnquirySchema = z.object({
  kind: z.enum(['ROOM', 'EVENT', 'GENERAL', 'SERVICE']),
  name: z
    .string({ error: 'Enter your name.' })
    .trim()
    .min(1, 'Enter your name.')
    .max(120, 'Keep your name under 120 characters.'),
  phone: z.preprocess(
    normaliseMobile,
    z.string({ error: 'Enter your phone number.' }).regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number.')
  ),
  checkInDate: optionalDate,
  checkOutDate: optionalDate,
  eventDate: optionalDate,
  eventType: optionalText(60),
  roomTypeId: optionalId,
  venueId: optionalId,
  guests: z.coerce.number().int().min(1).max(1000).nullish().transform((v) => v ?? null),
  addonIds: z.array(z.coerce.number().int().positive()).max(30).nullish().transform((v) => v ?? []),
  summary: optionalText(1000),
  notes: optionalText(1000),
  website: z.string().nullish(),
});

const updateEnquirySchema = z.object({
  status: z.enum(['NEW', 'CONTACTED', 'CONVERTED', 'CLOSED']),
});

module.exports = { publicEnquirySchema, updateEnquirySchema };
