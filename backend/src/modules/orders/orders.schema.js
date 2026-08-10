const { z } = require('zod');

const ORDER_STATUSES = ['PENDING', 'QUEUED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED'];

const orderItemsSchema = z
  .array(
    z.object({
      itemId: z.coerce.number().int().positive('Invalid menu item.'),
      quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1.').max(99, 'Quantity is too large.'),
    })
  )
  .min(1, 'Add at least one item to the order.')
  .max(50, 'That’s too many lines for one order — split it.');

// Reception typing an order in at the counter. It can be attached to a table,
// to an occupied room, or to neither (a walk-in paying at the till), which is
// what COUNTER covers.
const counterOrderSchema = z
  .object({
    tableId: z.coerce.number().int().positive().optional().nullable(),
    roomId: z.coerce.number().int().positive().optional().nullable(),
    guestName: z.string().trim().max(200).optional().default(''),
    guestPhone: z.string().trim().max(20).optional().default(''),
    note: z.string().trim().max(300).optional().default(''),
    items: orderItemsSchema,
  })
  .refine((data) => !(data.tableId && data.roomId), {
    message: 'An order goes to a room or a table, not both.',
  });

const updateStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES, { error: 'Unknown order status.' }),
  cancelReason: z.string().trim().max(200).optional().default(''),
});

module.exports = { ORDER_STATUSES, orderItemsSchema, counterOrderSchema, updateStatusSchema };
