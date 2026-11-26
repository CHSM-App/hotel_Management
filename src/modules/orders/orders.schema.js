const { z } = require('zod');

const ORDER_STATUSES = ['PENDING', 'QUEUED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED'];

const orderItemsSchema = z
  .array(
    z.object({
      itemId: z.coerce.number().int().positive('Invalid menu item.'),
      // Only meaningful for a dish that offers portions, and only checked
      // against that dish — resolveOrderLines refuses a portion belonging to
      // anything else, and refuses a missing one when the dish needs it.
      portionId: z.coerce.number().int().positive().optional().nullable(),
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
    // Which guest in a dormitory the food goes to; ignored without a roomId.
    bookingId: z.coerce.number().int().positive().optional().nullable(),
    guestName: z.string().trim().max(200).optional().default(''),
    guestPhone: z.string().trim().max(20).optional().default(''),
    note: z.string().trim().max(300).optional().default(''),
    // Who at the table this is for; only meaningful with a tableId.
    customerTag: z.string().trim().max(60).optional().nullable(),
    // Counter order packed to go; ignored for a room or table.
    isParcel: z.boolean().optional().default(false),
    items: orderItemsSchema,
  })
  // Guest name and phone are optional on a counter order, same as the bar.
  .refine((data) => !(data.tableId && data.roomId), {
    message: 'An order goes to a room or a table, not both.',
  });

const customerSchema = z.object({ customerTag: z.string().trim().max(60).nullable() });

const updateStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES, { error: 'Unknown order status.' }),
  cancelReason: z.string().trim().max(200).optional(),
});

// Ticking one dish off the ticket. A boolean rather than a bare "mark ready"
// call because a cook mis-taps on a wall tablet and needs to take it back.
const updateItemReadySchema = z.object({
  // Not coerced: z.coerce.boolean() reads the string "false" as true, which
  // would turn an untick into a tick.
  ready: z.boolean({ error: 'Say whether the item is ready.' }),
});

// Captain editing a live order. Items may be empty when the kitchen has already
// cooked everything and only the note is changing.
const editOrderSchema = z.object({
  items: orderItemsSchema.min(0),
  note: z.string().trim().max(300).optional(),
});

// Cancelling some dishes off a live order.
const cancelItemsSchema = z.object({
  itemIds: z.array(z.coerce.number().int().positive()).min(1, 'Pick at least one dish to cancel.').max(50),
  cancelReason: z.string().trim().max(200).optional(),
});

module.exports = {
  cancelItemsSchema,
  editOrderSchema,
  ORDER_STATUSES,
  orderItemsSchema,
  counterOrderSchema,
  customerSchema,
  updateStatusSchema,
  updateItemReadySchema,
};
