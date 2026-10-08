const { z } = require('zod');
const { TEN_DIGITS, MOBILE_MESSAGE, normaliseMobile } = require('../bookings/bookings.schema');

const phoneField = () =>
  z.preprocess(normaliseMobile, z.string({ error: 'Enter a phone number.' }).regex(TEN_DIGITS, MOBILE_MESSAGE));

// The edit form always submits the whole record, so an absent optional field
// here means "clear it", not "leave unchanged" — the one exception is
// marketingOptIn, which the list screen can also toggle on its own without
// resubmitting the rest of the profile.
const createCustomerSchema = z.object({
  phone: phoneField(),
  name: z.string({ error: 'Enter the customer’s name.' }).trim().min(1, 'Enter the customer’s name.').max(200),
  email: z.string().trim().email('Enter a valid email.').max(255).optional().or(z.literal('')),
  notes: z.string().trim().max(1000).optional(),
  tags: z.string().trim().max(500).optional(),
  marketingOptIn: z.boolean().optional(),
});

const updateCustomerSchema = z.object({
  name: z.string().trim().min(1, 'Enter the customer’s name.').max(200).optional(),
  email: z.string().trim().email('Enter a valid email.').max(255).optional().or(z.literal('')),
  notes: z.string().trim().max(1000).optional(),
  tags: z.string().trim().max(500).optional(),
  marketingOptIn: z.boolean().optional(),
  idProofType: z.string().trim().max(30).optional(),
  idProofNumber: z.string().trim().max(50).optional(),
});

module.exports = { createCustomerSchema, updateCustomerSchema };
