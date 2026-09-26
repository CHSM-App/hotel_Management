const { z } = require('zod');

const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required.'),
  basePrice: z.coerce.number().positive('Base price must be greater than 0.'),
});

const statusSchema = z.object({ isActive: z.boolean({ error: 'isActive must be true or false.' }) });

module.exports = { createCategorySchema, updateCategorySchema: createCategorySchema, statusSchema };
