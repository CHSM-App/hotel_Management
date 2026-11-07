const { z } = require('zod');

const createTableSchema = z.object({
  label: z.string().trim().min(1, 'Table name is required.'),
  seats: z.coerce.number().int().positive('Seats must be greater than 0.').optional().nullable(),
});

// Same "add 101 to 110 in one go" convenience the rooms panel has — a
// restaurant numbering twenty tables shouldn't fill twenty forms.
const bulkCreateTableSchema = z.object({
  prefix: z.string().trim().max(20).optional().default('T'),
  rangeStart: z.coerce.number().int().min(0, 'Start must be 0 or more.'),
  rangeEnd: z.coerce.number().int().min(0, 'End must be 0 or more.'),
  seats: z.coerce.number().int().positive('Seats must be greater than 0.').optional().nullable(),
});

const statusSchema = z.object({ isActive: z.boolean({ error: 'isActive must be true or false.' }) });

module.exports = {
  createTableSchema,
  updateTableSchema: createTableSchema,
  bulkCreateTableSchema,
  statusSchema,
};
