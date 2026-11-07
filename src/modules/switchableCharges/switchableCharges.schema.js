const { z } = require('zod');

const createSwitchableChargeSchema = z.object({
  name: z.string().trim().min(1, 'Charge name is required.'),
  chargePerNight: z.coerce.number().positive('Enter an amount greater than 0.'),
  // Charged per unit: booking asks "how many" beside it (an extra bed, a
  // mattress). Optional so a caller that never sends it leaves an existing
  // extra as it is on an update, and creates a plain per-night one.
  isCounter: z.boolean().optional(),
  // Another extra that, once ticked, hides this one (one-way). Blank = never.
  hiddenWhenChargeId: z.preprocess(
    (v) => (v === '' || v == null ? null : v),
    z.coerce.number().int().positive().nullable()
  ).optional(),
});

const statusSchema = z.object({ isActive: z.boolean({ error: 'isActive must be true or false.' }) });

module.exports = {
  createSwitchableChargeSchema,
  updateSwitchableChargeSchema: createSwitchableChargeSchema,
  statusSchema,
};
