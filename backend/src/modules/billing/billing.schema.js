const { z } = require('zod');
const { PAYMENT_METHODS, requiresReference, REFERENCE_REQUIRED } = require('../bookings/bookings.schema');

const issueInvoiceSchema = z
  .object({
    billingSide: z.enum(['GST', 'NON_GST']).optional(),
    // Required, not optional. The property doesn't extend credit — a bill is
    // written when the guest settles, so a document issued with no payment
    // recorded against it would be a receivable this system has nowhere to
    // track and nobody to chase.
    //
    // Zero is still allowed, for the one case where nothing is owed: an
    // advance that already covered the whole stay. That case also has no
    // payment type, which is why the method is conditional below rather than
    // required outright.
    collectedAmount: z.coerce
      .number({ error: 'Enter the amount collected from the guest.' })
      .nonnegative('The amount collected can’t be negative.'),
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
    // The UPI or card transaction number for what was collected at the till.
    // Same rule as the advance taken at the desk — money with a trail has its
    // trail recorded, cash doesn't because there isn't one.
    paymentReference: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().max(64, 'That transaction number looks too long — check it.').optional()
    ),
    // Whether the late checkout charge reception agreed at the desk goes onto
    // this bill. Defaults to true so a caller that says nothing keeps billing
    // what was agreed; ignored on a food bill, which has no stay behind it.
    includeLateCheckout: z.boolean().optional().default(true),
    // What the desk knocked off this document, in rupees. Only the amount is
    // accepted: the screen offers a percentage too, but a percentage and an
    // amount that disagree have no right answer, so the percentage is turned
    // into money on the way in and re-derived from it on the way out.
    // Clamped to what is on the bill rather than rejected — the desk can't
    // give away more than was sold, and the preview already showed the cap.
    discountAmount: z.coerce
      .number({ error: 'Enter a valid discount amount.' })
      .nonnegative('A discount can’t be negative.')
      .optional()
      .default(0),
  })
  .refine((data) => data.collectedAmount === 0 || data.paymentMethod != null, {
    message: 'Choose a payment type for the amount collected.',
    path: ['paymentMethod'],
  })
  .refine((data) => requiresReference(data.paymentMethod, data.paymentReference), {
    message: REFERENCE_REQUIRED,
    path: ['paymentReference'],
  });

const voidInvoiceSchema = z.object({
  reason: z.string({ error: 'Enter a reason for voiding this bill.' }).trim().min(1, 'Enter a reason for voiding this bill.'),
});

module.exports = { issueInvoiceSchema, voidInvoiceSchema };
