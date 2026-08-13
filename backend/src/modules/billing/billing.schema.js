const { z } = require('zod');

const issueInvoiceSchema = z
  .object({
    billingSide: z.enum(['GST', 'NON_GST']).optional(),
    collectedAmount: z.coerce.number().nonnegative().optional(),
    paymentMethod: z.enum(['CASH', 'UPI', 'CARD']).optional(),
    // Whether the late checkout charge reception agreed at the desk goes onto
    // this bill. Defaults to true so a caller that says nothing keeps billing
    // what was agreed; ignored on a food bill, which has no stay behind it.
    includeLateCheckout: z.boolean().optional().default(true),
  })
  .refine((data) => (data.collectedAmount == null) === (data.paymentMethod == null), {
    message: 'Choose a payment method for the amount collected.',
    path: ['paymentMethod'],
  });

const voidInvoiceSchema = z.object({
  reason: z.string({ error: 'Enter a reason for voiding this bill.' }).trim().min(1, 'Enter a reason for voiding this bill.'),
});

module.exports = { issueInvoiceSchema, voidInvoiceSchema };
