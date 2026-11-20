const { z } = require('zod');

const id = z.coerce.number().int().positive();
const ml = z.coerce.number().int().min(0).max(10_000_000);
const text = (max) => z.string().trim().max(max);

const categorySchema = z.object({
  name: text(100).min(1, 'Category name is required.'),
  sortOrder: z.coerce.number().int().optional(),
  isActive: z.boolean().optional(),
});

const sizeSchema = z.object({
  label: text(50).min(1, 'Size name is required.'),
  ml: z.coerce.number().int().positive('ML per serving must be more than 0.'),
  price: z.coerce.number().min(0, 'Price cannot be negative.'),
});

const productSchema = z.object({
  name: text(150).min(1, 'Product name is required.'),
  brand: text(100).optional().nullable(),
  categoryId: id.optional().nullable(),
  bottleMl: z.coerce.number().int().positive('Bottle size must be more than 0 ml.'),
  // Alert limit in ml; the UI converts bottles to ml. Null clears it (falls back to the lodge default).
  lowStockMl: ml.optional().nullable(),
  isActive: z.boolean().optional(),
  sizes: z.array(sizeSchema).optional(),
  openingBottles: ml.optional(),
  openingMl: ml.optional(),
});

const sizePatchSchema = sizeSchema.partial().extend({
  isAvailable: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const stockSchema = z
  .object({
    reason: z.enum(['PURCHASE', 'OPENING', 'WASTAGE', 'ADJUSTMENT']),
    // ADJUSTMENT only: add or remove. PURCHASE/OPENING always add, WASTAGE always removes.
    direction: z.enum(['ADD', 'REMOVE']).optional(),
    bottles: ml.default(0),
    ml: ml.default(0),
    note: text(200).optional().nullable(),
  })
  .refine((d) => d.bottles > 0 || d.ml > 0, { message: 'Enter bottles or ml.', path: ['bottles'] });

const foodItemSchema = z.object({
  itemId: id,
  portionId: id.optional().nullable(),
  quantity: z.coerce.number().int().min(1).max(100),
});

// Drinks and/or restaurant food; an order needs at least one line of either.
const hasLines = (d) => (d.items?.length || 0) + (d.foodItems?.length || 0) > 0;
const noLines = { message: 'Add at least one item.', path: ['items'] };

const orderSchema = z.object({
  source: z.enum(['COUNTER', 'TABLE', 'ROOM']).default('COUNTER'),
  tableId: id.optional().nullable(),
  roomId: id.optional().nullable(),
  bookingId: id.optional().nullable(),
  restaurantOrderId: id.optional().nullable(),
  guestName: text(100).optional().nullable(),
  guestPhone: text(20).optional().nullable(),
  items: z.array(z.object({ menuItemId: id, quantity: z.coerce.number().int().min(1).max(100) })).default([]),
  foodItems: z.array(foodItemSchema).default([]),
}).refine(hasLines, noLines);

const addItemsSchema = z.object({
  items: z.array(z.object({ menuItemId: id, quantity: z.coerce.number().int().min(1).max(100) })).default([]),
  foodItems: z.array(foodItemSchema).default([]),
}).refine(hasLines, noLines);

const roomBillSchema = z.object({ bookingId: id, roomId: id });

const qtySchema = z.object({ quantity: z.coerce.number().int().min(1).max(100) });

const billSchema = z.object({
  orderIds: z.array(id).min(1, 'Pick at least one order.'),
  customerName: text(100).optional().nullable(),
  customerPhone: text(20).optional().nullable(),
  // Bill even though some items have not been delivered yet.
  billAnyway: z.boolean().optional(),
  payments: z
    .array(
      z.object({
        method: z.enum(['CASH', 'UPI', 'CARD']),
        amount: z.coerce.number().positive('Payment must be more than 0.'),
        reference: text(100).optional().nullable(),
      })
    )
    .min(1, 'Add a payment.'),
});

const settingsSchema = z.object({
  taxPercent: z.coerce.number().min(0).max(100).optional(),
  defaultLowStockMl: ml.optional().nullable(),
});

const rangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD'),
});

module.exports = {
  categorySchema,
  productSchema,
  sizeSchema,
  sizePatchSchema,
  stockSchema,
  orderSchema,
  addItemsSchema,
  qtySchema,
  roomBillSchema,
  billSchema,
  settingsSchema,
  rangeSchema,
};
