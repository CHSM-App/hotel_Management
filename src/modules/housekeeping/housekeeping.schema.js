const { z } = require('zod');

const qty = z.coerce.number().int().positive('Enter a count above 0.').max(100000);
const idField = (message) => z.coerce.number().int().positive(message);
const optionalText = (max) => z.string().trim().max(max).optional().default('');
// What an outside laundry charged for the batch. Blank means not entered.
const optionalCharge = z.preprocess(
  (v) => (v === '' || v == null ? null : v),
  z.coerce.number({ invalid_type_error: 'Enter the charge as a number.' }).min(0, 'Charge cannot be negative.').max(9999999).nullable().optional()
);

const finishCleaningSchema = z.object({
  // Linen changed in the room, by item type — feeds the hotel linen stock.
  linen: z.array(z.object({ linenItemId: idField('Choose a linen item.'), quantity: qty })).max(50).optional().default([]),
  issues: optionalText(500),
  lostFound: optionalText(500),
  // The room cannot be let until the problem is fixed: it goes under repair.
  blockRoom: z.boolean().optional().default(false),
});

const closeIssueSchema = z.object({
  kind: z.enum(['ISSUE', 'FOUND']),
  note: optionalText(300),
});

const outOfOrderSchema = z.object({
  outOfOrder: z.boolean(),
  note: optionalText(300),
});

const linenItemSchema = z.object({
  name: z.string().trim().min(1, 'Enter a linen item name.').max(80),
  totalOwned: z.coerce.number().int().min(0, 'Owned count cannot be negative.').max(1000000).default(0),
});

const updateLinenItemSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  totalOwned: z.coerce.number().int().min(0).max(1000000).optional(),
  isActive: z.boolean().optional(),
});

const sendSchema = z.object({
  lines: z.array(z.object({ linenItemId: idField('Choose a linen item.'), quantity: qty })).min(1, 'Add at least one item.').max(50),
  note: optionalText(300),
  // The outside laundry's name, or "Own laundry".
  washedBy: optionalText(100),
  charge: optionalCharge,
});

const receiveSchema = z.object({
  lines: z
    .array(
      z.object({
        linenItemId: idField('Choose a linen item.'),
        received: z.coerce.number().int().min(0).max(100000).default(0),
        lost: z.coerce.number().int().min(0).max(100000).default(0),
        damaged: z.coerce.number().int().min(0).max(100000).default(0),
      })
    )
    .min(1, 'Add at least one item.')
    .max(50),
  note: optionalText(300),
  washedBy: optionalText(100),
  charge: optionalCharge,
});

const receiveHandoverSchema = z.object({
  movementIds: z.array(idField('Choose the linen to receive.')).min(1, 'Choose the linen to receive.').max(500),
});

const lossSchema = z.object({
  linenItemId: idField('Choose a linen item.'),
  kind: z.enum(['LOST', 'DAMAGED']),
  quantity: qty,
  note: optionalText(300),
});

const laundryOrderSchema = z.object({
  bookingId: z.preprocess((v) => (v === '' || v == null ? null : v), idField('Choose a guest.').nullable().optional()),
  // Which of a multi-room booking's rooms the clothes came from.
  roomId: z.preprocess((v) => (v === '' || v == null ? null : v), idField('Choose a room.').nullable().optional()),
  guestName: optionalText(200),
  guestPhone: optionalText(20),
  note: optionalText(300),
  // The order goes to be washed as it is taken in: who washes it, the vendor's
  // phone, and what an outside vendor charges the lodge for it.
  washedBy: optionalText(100),
  vendorPhone: optionalText(20),
  charge: optionalCharge,
  // Priced at the desk, per entry: no price list to keep. The name and price are
  // typed (or recalled from a recent order) and travel with the order.
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'Enter the garment name.').max(100),
        price: z.coerce.number({ invalid_type_error: 'Enter a price.' }).min(0, 'Price cannot be negative.').max(9999999),
        quantity: qty,
      })
    )
    .min(1, 'Add at least one garment.')
    .max(100),
});

const laundryStatusSchema = z.object({
  status: z.enum(['WASHING', 'READY', 'DELIVERED', 'CANCELLED']),
  // Given when the clothes come back from the wash (READY): who washed them,
  // the vendor's phone, and what the vendor charged. Ignored on other moves.
  washedBy: optionalText(100),
  vendorPhone: optionalText(20),
  charge: optionalCharge,
  // Garment prices corrected as the clothes come back, before the guest is
  // billed. Only the price: what was handed in does not change.
  items: z
    .array(
      z.object({
        id: idField('Choose a garment.'),
        price: z.coerce.number({ invalid_type_error: 'Enter a price.' }).min(0, 'Price cannot be negative.').max(9999999),
      })
    )
    .max(100)
    .optional()
    .default([]),
});

module.exports = {
  finishCleaningSchema,
  outOfOrderSchema,
  closeIssueSchema,
  linenItemSchema,
  updateLinenItemSchema,
  sendSchema,
  receiveSchema,
  receiveHandoverSchema,
  lossSchema,
  laundryOrderSchema,
  laundryStatusSchema,
};
