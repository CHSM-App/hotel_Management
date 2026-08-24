const { z } = require('zod');

const BED_SIZES = ['SINGLE', 'DOUBLE', 'QUEEN', 'KING'];

// The room's beds, as a list rather than one enum: a family room is a double
// and two singles, and picking one of the three to store loses the room.
//
// Arrives as a JSON string because the room form is multipart (it carries photo
// uploads), and every text field in a multipart body is a string. Parsed here so
// a malformed value fails validation with a message rather than throwing inside
// the service.
const bedsSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value; // falls through to the array check below, which rejects it
    }
  },
  z
    .array(
      z.object({
        size: z.enum(BED_SIZES, { error: 'Choose a bed size.' }),
        // Capped because it is typed by hand next to a delete button — 40 beds
        // in one room is a slipped keystroke, not a dormitory.
        count: z.coerce.number().int().min(1, 'A bed count must be at least 1.').max(20, 'That is too many beds for one room.'),
      })
    )
    .min(1, 'Add at least one bed.')
    .max(10, 'Add at most 10 bed types to a room.')
);

const createRoomSchema = z
  .object({
    categoryId: z.coerce.number().int().positive('Choose a category.'),
    switchableChargeIds: z.array(z.coerce.number().int().positive()).optional().default([]),
    floor: z.string({ error: 'Enter the floor.' }).trim().min(1, 'Enter the floor.'),
    beds: bedsSchema,
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
  beds: bedsSchema,
  bathroomType: z.enum(['ATTACHED', 'COMMON'], { error: 'Choose a bathroom type.' }),
  maxOccupancy: z.coerce.number().int().positive('Enter a max occupancy greater than 0.'),
  description: z.string().trim().max(200, 'Keep the description under 200 characters.').optional().default(''),
});

const statusSchema = z.object({ isActive: z.boolean({ error: 'isActive must be true or false.' }) });

// When the property wants its rooms back, and what it charges for the guest
// who doesn't. checkinMode isn't here on purpose — it is fixed at registration.
const checkoutPolicySchema = z
  .object({
    checkOutTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a checkout time as HH:MM, e.g. 11:00.'),
    lateGraceMinutes: z.coerce
      .number()
      .int()
      .min(0, 'A grace period can’t be negative.')
      .max(720, 'A grace period over 12 hours isn’t a grace period.'),
    lateHalfDayPercent: z.coerce
      .number()
      .min(0, 'A percentage can’t be negative.')
      .max(200, 'Keep the charge under 200% of a night.'),
    lateFullDayAfterMinutes: z.coerce
      .number()
      .int()
      .min(0, 'That has to be a number of minutes.')
      .max(1440, 'Past 24 hours it is another night, not a late checkout.'),
    lateFullDayPercent: z.coerce
      .number()
      .min(0, 'A percentage can’t be negative.')
      .max(200, 'Keep the charge under 200% of a night.'),
  })
  // The bands have to be in order or the full-day rate is unreachable — the
  // half-day band would run past the point the full-day one starts.
  .refine((data) => data.lateFullDayAfterMinutes > data.lateGraceMinutes, {
    message: 'The full-day charge has to start after the grace period ends.',
  });

module.exports = { createRoomSchema, updateRoomSchema, statusSchema, checkoutPolicySchema };
