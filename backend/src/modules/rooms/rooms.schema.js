const { z } = require('zod');

const createRoomSchema = z
  .object({
    categoryId: z.coerce.number().int().positive('Choose a category.'),
    switchableChargeIds: z.array(z.coerce.number().int().positive()).optional().default([]),
    floor: z.string({ error: 'Enter the floor.' }).trim().min(1, 'Enter the floor.'),
    bedSize: z.enum(['SINGLE', 'DOUBLE', 'QUEEN', 'KING'], { error: 'Choose a bed size.' }),
    bathroomType: z.enum(['ATTACHED', 'COMMON'], { error: 'Choose a bathroom type.' }),
    maxOccupancy: z.coerce.number().int().positive('Enter a max occupancy greater than 0.'),
    description: z.string().trim().max(200, 'Keep the description under 200 characters.').optional().default(''),
    roomNumber: z.string().trim().optional().default(''),
    rangeStart: z.coerce.number().int().positive().optional(),
    rangeEnd: z.coerce.number().int().positive().optional(),
  })
  .refine(
    (data) => {
      const hasSingle = data.roomNumber.length > 0;
      const hasRange = data.rangeStart != null && data.rangeEnd != null;
      return hasSingle !== hasRange;
    },
    {
      message: 'Enter a single room number, or a bulk range — not both.',
      path: ['roomNumber'],
    }
  )
  .refine(
    (data) => data.rangeStart == null || data.rangeEnd == null || data.rangeEnd >= data.rangeStart,
    { message: 'Range end must be greater than or equal to the start.', path: ['rangeEnd'] }
  )
  .refine(
    (data) =>
      data.rangeStart == null || data.rangeEnd == null || data.rangeEnd - data.rangeStart < 100,
    { message: 'Add rooms in batches of 100 or fewer.', path: ['rangeEnd'] }
  );

// Editing a room is always a single room (no bulk range), so this is a
// leaner sibling of createRoomSchema rather than a .partial() of it — the
// edit form always resubmits every field, same as the add form.
// switchableChargeIds stays truly optional (no default) — the edit form
// doesn't manage it (booking extras now apply lodge-wide, not per room), so
// omitting it must leave any existing room_switchable_charges rows alone
// instead of wiping them on every edit.
const updateRoomSchema = z.object({
  roomNumber: z.string({ error: 'Enter a room number.' }).trim().min(1, 'Enter a room number.'),
  categoryId: z.coerce.number().int().positive('Choose a category.'),
  switchableChargeIds: z.array(z.coerce.number().int().positive()).optional(),
  floor: z.string({ error: 'Enter the floor.' }).trim().min(1, 'Enter the floor.'),
  bedSize: z.enum(['SINGLE', 'DOUBLE', 'QUEEN', 'KING'], { error: 'Choose a bed size.' }),
  bathroomType: z.enum(['ATTACHED', 'COMMON'], { error: 'Choose a bathroom type.' }),
  maxOccupancy: z.coerce.number().int().positive('Enter a max occupancy greater than 0.'),
  description: z.string().trim().max(200, 'Keep the description under 200 characters.').optional().default(''),
});

const statusSchema = z.object({ isActive: z.boolean({ error: 'isActive must be true or false.' }) });

module.exports = { createRoomSchema, updateRoomSchema, statusSchema };
