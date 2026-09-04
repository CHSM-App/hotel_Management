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
    guestName: z.string().trim().max(200).optional().default(''),
    guestPhone: z.string().trim().max(20).optional().default(''),
    note: z.string().trim().max(300).optional().default(''),
    items: orderItemsSchema,
  })
  .refine((data) => !(data.tableId && data.roomId), {
    message: 'An order goes to a room or a table, not both.',
  })
  // A counter order is the one shape with nothing else identifying the payer:
  // no booking, no table the party is sitting at. The name and number are the
  // only record of whose food it is and the only way to call them back, so
  // they are required here and ignored everywhere else. Enforced server-side
  // because the form is not the rule — a direct API call has to obey it too.
  .refine((data) => data.tableId || data.roomId || data.guestName.trim().length > 0, {
    message: 'Add the guest’s name for a counter order.',
    path: ['guestName'],
  })
  .refine((data) => data.tableId || data.roomId || data.guestPhone.trim().length > 0, {
    message: 'Add a phone number for a counter order.',
    path: ['guestPhone'],
  });

const updateStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES, { error: 'Unknown order status.' }),
  cancelReason: z.string().trim().max(200).optional().default(''),
});

// Ticking one dish off the ticket. A boolean rather than a bare "mark ready"
// call because a cook mis-taps on a wall tablet and needs to take it back.
const updateItemReadySchema = z.object({
  // Not coerced: z.coerce.boolean() reads the string "false" as true, which
  // would turn an untick into a tick.
  ready: z.boolean({ error: 'Say whether the item is ready.' }),
});

module.exports = {
  ORDER_STATUSES,
  orderItemsSchema,
  counterOrderSchema,
  updateStatusSchema,
  updateItemReadySchema,
};
