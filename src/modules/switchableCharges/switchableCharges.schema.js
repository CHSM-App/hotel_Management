const { z } = require('zod');

const createSwitchableChargeSchema = z.object({
  name: z.string().trim().min(1, 'Charge name is required.'),
  chargePerNight: z.coerce.number().positive('Enter an amount greater than 0.'),
});

const statusSchema = z.object({ isActive: z.boolean({ error: 'isActive must be true or false.' }) });

module.exports = {
  createSwitchableChargeSchema,
  updateSwitchableChargeSchema: createSwitchableChargeSchema,
  statusSchema,
};
