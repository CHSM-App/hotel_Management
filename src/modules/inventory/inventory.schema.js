const { z } = require('zod');

// The unit a material is bought, counted and cooked in. There is no conversion
// between them anywhere — see the note above dbo.raw_materials — so this list
// exists to keep the label on screen honest, not to do arithmetic with.
const MATERIAL_UNITS = ['KG', 'G', 'L', 'ML', 'PCS'];

// Which shelf a material belongs on. Fixed rather than per-lodge: it is a
// label on a store room, not a business decision, and a shared set means a
// cross-property report could group by it later without reconciling eight
// spellings of "Spices". OTHER is the fallback and sorts last.
const MATERIAL_CATEGORIES = ['GRAINS', 'BAKERY', 'PRODUCE', 'PROTEIN', 'STAPLES', 'SPICES', 'BOTTLED', 'OTHER'];

// Quantities carry three decimals to match DECIMAL(12,3) in the schema. Asking
// for more precision than the column keeps would silently round on the way in,
// which is how "I typed 0.0005 and it saved 0" happens.
const quantity = z.coerce
  .number()
  .refine((n) => Number.isFinite(n), { error: 'Quantity must be a number.' })
  .refine((n) => Math.round(n * 1000) === n * 1000, {
    error: 'Quantities go to three decimal places.',
  });

const createMaterialSchema = z.object({
  name: z.string().trim().min(1, 'Material name is required.').max(120),
  unit: z.enum(MATERIAL_UNITS, { error: 'Choose a unit.' }),
  category: z.enum(MATERIAL_CATEGORIES, { error: 'Choose a group.' }).optional().default('OTHER'),
  // Opening stock. Optional because a lodge often adds the material first and
  // counts the shelf afterwards. Stock is allowed to go negative later, but
  // only by being cooked — there is no such thing as starting out owing rice.
  quantity: quantity
    .refine((n) => n >= 0, { error: 'Opening stock can’t be negative.' })
    .optional()
    .default(0),
  lowStockThreshold: quantity
    .refine((n) => n >= 0, { error: 'The low-stock level can’t be negative.' })
    .optional()
    .default(0),
});

// unit is absent on purpose. Changing it would restate every recipe quantity
// and every past movement written against this material — 500 of something is
// a different fact in grams than in kilos, and there is nothing on the row that
// says which one the old numbers meant. Retire the material and add a new one.
//
// category is editable, and safely so: nothing computes with it. Moving rice
// from one heading to another changes where it appears on a screen and nothing
// else, which is exactly why it is not held to the same rule as the unit.
const updateMaterialSchema = z.object({
  name: z.string().trim().min(1, 'Material name is required.').max(120),
  category: z.enum(MATERIAL_CATEGORIES, { error: 'Choose a group.' }).optional().default('OTHER'),
  lowStockThreshold: quantity
    .refine((n) => n >= 0, { error: 'The low-stock level can’t be negative.' })
    .optional()
    .default(0),
});

// Two ways stock moves by hand, and they are different questions. ADD is "20 kg
// arrived" and is the one used daily. SET is "I counted the shelf and it says
// 12" — the delta is worked out from where the count actually is, which is the
// only correct way to reconcile a drift the ledger doesn't know about.
const adjustStockSchema = z
  .object({
    mode: z.enum(['ADD', 'SET'], { error: 'Choose whether you’re adding stock or setting a count.' }),
    quantity,
    note: z.string().trim().max(200).optional().default(''),
  })
  .refine((v) => v.mode !== 'SET' || v.quantity >= 0, {
    error: 'A counted quantity can’t be negative.',
    path: ['quantity'],
  })
  .refine((v) => v.mode !== 'ADD' || v.quantity !== 0, {
    error: 'Enter how much came in, or use “Correct to a counted total” instead.',
    path: ['quantity'],
  });

// A dish's whole ingredient list, saved as the complete set it should end up as
// — the same replace-don't-diff rule the portions editor follows.
//
// portionId null means the line applies to the dish at any size. Mixing sizes
// and nulls for the same material is refused in the service rather than here,
// because the check needs to know which sizes the dish actually has.
const itemRecipeSchema = z.object({
  lines: z
    .array(
      z.object({
        portionId: z.coerce.number().int().positive().nullable().optional().default(null),
        materialId: z.coerce.number().int().positive('Choose a raw material.'),
        quantity: quantity.refine((n) => n > 0, {
          error: 'Every ingredient needs a quantity above zero.',
        }),
      })
    )
    .max(60, 'That’s a lot of ingredients for one dish.')
    .default([]),
});

const statusSchema = z.object({ isActive: z.boolean({ error: 'isActive must be true or false.' }) });

module.exports = {
  MATERIAL_UNITS,
  MATERIAL_CATEGORIES,
  createMaterialSchema,
  updateMaterialSchema,
  adjustStockSchema,
  itemRecipeSchema,
  statusSchema,
};
