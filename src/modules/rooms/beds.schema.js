const { z } = require('zod');

// A bed's own label — short, because it's what a housekeeping sheet and a
// booking chip both print next to a room number: "12 / L1", not a sentence.
const bedLabelField = () =>
  z.string({ error: 'Enter a bed label.' }).trim().min(1, 'Enter a bed label.').max(20, 'Keep the bed label short.');

// A bed has no price of its own — every bed in a dormitory room charges the
// room's own rate (rooms.dormitory_price, or the category price under
// that). Only the label is ever asked for here.
const createBedSchema = z.object({
  bedLabel: bedLabelField(),
});

const updateBedSchema = z.object({
  bedLabel: bedLabelField(),
  isActive: z.boolean().optional(),
});

// The desk doesn't name beds one at a time — it says how many the room
// has, and setBedCount reconciles dormitory_beds to that number, adding or
// removing auto-labelled rows ("Bed 1", "Bed 2", ...) at the top end. Capped
// the same reason the room's own descriptive beds JSON is capped at 20 in a
// type — a dormitory sized in the hundreds is a slipped keystroke.
const bedCountSchema = z.object({
  count: z.coerce.number().int().min(1, 'A dormitory needs at least one bed.').max(60, 'That’s too many beds for one room.'),
});

module.exports = { createBedSchema, updateBedSchema, bedCountSchema };
