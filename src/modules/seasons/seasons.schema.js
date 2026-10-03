const { z } = require('zod');

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

const createSeasonSchema = z
  .object({
    name: z.string().trim().min(1, 'Season name is required.'),
    startDate: dateString,
    endDate: dateString,
    adjustmentPercent: z.coerce.number(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: 'End date must be on or after the start date.',
    path: ['endDate'],
  });

module.exports = { createSeasonSchema, updateSeasonSchema: createSeasonSchema };
