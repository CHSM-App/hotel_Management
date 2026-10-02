const { z } = require('zod');

const qty = z.coerce.number().int().positive('Enter a count above 0.').max(100000);
const idField = (message) => z.coerce.number().int().positive(message);
const optionalText = (max) => z.string().trim().max(max).optional().default('');

const finishCleaningSchema = z.object({
  // Linen changed in the room, by item type — feeds the hotel linen stock.
  linen: z.array(z.object({ linenItemId: idField('Choose a linen item.'), quantity: qty })).max(50).optional().default([]),
  issues: optionalText(500),
  lostFound: optionalText(500),
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
});

module.exports = {
  finishCleaningSchema,
  outOfOrderSchema,
  linenItemSchema,
  updateLinenItemSchema,
  sendSchema,
  receiveSchema,
  lossSchema,
  laundryOrderSchema,
  laundryStatusSchema,
};
