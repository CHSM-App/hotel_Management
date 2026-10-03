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

// A dormitory has no single bed layout or max occupancy of its own — beds
// are the individually labelled, individually priced rows added after the
// room is saved (dormitory_beds), and there is no one party to cap the
// headcount of. Both fields are pointless to ask for on a dormitory, so they
// arrive optional and the room saves with the same "no data yet" shape
// dormitory_beds itself starts in: bed_size/beds NULL, max_occupancy NULL.
const optionalBedsSchema = bedsSchema.optional();
const optionalMaxOccupancy = z.coerce
  .number()
  .int()
  .positive('Enter a max occupancy greater than 0.')
  .optional();

// Arrives as the string "true"/"false" (multipart body, see bedsSchema above)
// — z.coerce.boolean() reads any non-empty string as true, so an unchecked
// box's "false" was silently becoming true and forcing every ordinary room
// through the dormitory-only validation below.
const isDormitoryField = () =>
  z.preprocess((value) => (typeof value === 'string' ? value === 'true' : value), z.boolean().optional().default(false));

const DORMITORY_GENDERS = ['MALE', 'FEMALE', 'BOTH'];

// Which guests a dormitory can hold — required on a dormitory room (see the
// refine below), meaningless and always absent on an ordinary one.
const dormitoryGenderField = () =>
  z.enum(DORMITORY_GENDERS, { error: 'Choose who this dormitory is for.' }).optional();

const DORMITORY_AC_OPTIONS = ['AC', 'NON_AC'];

// AC or Non-AC — the one thing the old free extras checklist was standing in
// for. A plain tag, not a charge: already priced into dormitoryPrice, same
// as dormitoryGender is descriptive rather than something billed. An enum
// rather than a coerced boolean on purpose — z.coerce.boolean() reads the
// string 'false' as true (any non-empty string is truthy), which would
// silently turn every "Non-AC" pick into "AC".
const dormitoryIsAcField = () =>
  z.enum(DORMITORY_AC_OPTIONS, { error: 'Choose AC or Non-AC.' }).optional();

// One rate for the whole room — every bed in it charges this. Required on a
// dormitory (see the refine below): unlike an ordinary room, a dormitory has
// no category-derived default the desk is likely to actually want — beds
// sell far under a private room's rate, and silently falling back to the
// category price would quietly overcharge every bed until someone noticed.
const dormitoryPriceField = () =>
  z.coerce.number().positive('Enter a price greater than 0.').optional();

const createRoomSchema = z
  .object({
    categoryId: z.coerce.number().int().positive('Choose a category.'),
    switchableChargeIds: z.array(z.coerce.number().int().positive()).optional().default([]),
    floor: z.string().trim().optional().default(''),
    beds: optionalBedsSchema,
    bathroomType: z.enum(['ATTACHED', 'COMMON'], { error: 'Choose a bathroom type.' }),
    maxOccupancy: optionalMaxOccupancy,
    description: z.string().trim().max(200, 'Keep the description under 200 characters.').optional().default(''),
    roomNumber: z.string().trim().optional().default(''),
    rangeStart: z.coerce.number().int().positive().optional(),
    rangeEnd: z.coerce.number().int().positive().optional(),
    // Sold bed by bed rather than as one whole room. A bulk range can't be a
    // dormitory — dormitory beds are added one at a time after the room
    // exists, the same reason bulk-created rooms get no photos either.
    isDormitory: isDormitoryField(),
    dormitoryGender: dormitoryGenderField(),
    dormitoryPrice: dormitoryPriceField(),
    dormitoryIsAc: dormitoryIsAcField(),
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
  )
  .refine((data) => !data.isDormitory || data.roomNumber.length > 0, {
    message: 'A dormitory room can’t be added as a bulk range — add it as a single room, then add its beds.',
    path: ['isDormitory'],
  })
  // An ordinary room still needs both — only a dormitory is let off the
  // hook, and only because it has its own answer to both questions
  // (individual beds, no shared occupancy cap) that lives elsewhere.
  .refine((data) => data.isDormitory || (data.beds && data.beds.length > 0), {
    message: 'Add at least one bed.',
    path: ['beds'],
  })
  .refine((data) => data.isDormitory || data.maxOccupancy != null, {
    message: 'Enter a max occupancy greater than 0.',
    path: ['maxOccupancy'],
  })
  // The one thing a dormitory does require that an ordinary room has no
  // equivalent of — which beds it's even open to booking.
  .refine((data) => !data.isDormitory || data.dormitoryGender != null, {
    message: 'Choose who this dormitory is for.',
    path: ['dormitoryGender'],
  })
  .refine((data) => !data.isDormitory || data.dormitoryPrice != null, {
    message: 'Enter a price per night for this dormitory.',
    path: ['dormitoryPrice'],
  })
  .refine((data) => !data.isDormitory || data.dormitoryIsAc != null, {
    message: 'Choose AC or Non-AC.',
    path: ['dormitoryIsAc'],
  });

// Editing a room is always a single room (no bulk range), so this is a
// leaner sibling of createRoomSchema rather than a .partial() of it — the
// edit form always resubmits every field, same as the add form.
// switchableChargeIds stays truly optional (no default) — the edit form
// doesn't manage it (booking extras now apply lodge-wide, not per room), so
// omitting it must leave any existing room_switchable_charges rows alone
// instead of wiping them on every edit.
const updateRoomSchema = z
  .object({
    roomNumber: z.string({ error: 'Enter a room number.' }).trim().min(1, 'Enter a room number.'),
    categoryId: z.coerce.number().int().positive('Choose a category.'),
    switchableChargeIds: z.array(z.coerce.number().int().positive()).optional(),
    floor: z.string().trim().optional().default(''),
    beds: optionalBedsSchema,
    bathroomType: z.enum(['ATTACHED', 'COMMON'], { error: 'Choose a bathroom type.' }),
    maxOccupancy: optionalMaxOccupancy,
    description: z.string().trim().max(200, 'Keep the description under 200 characters.').optional().default(''),
    isDormitory: isDormitoryField(),
    dormitoryGender: dormitoryGenderField(),
    dormitoryPrice: dormitoryPriceField(),
    dormitoryIsAc: dormitoryIsAcField(),
  })
  // Same carve-out as createRoomSchema: a dormitory answers "beds" and
  // "occupancy" through dormitory_beds instead, so it's the one case that
  // can save without either.
  .refine((data) => data.isDormitory || (data.beds && data.beds.length > 0), {
    message: 'Add at least one bed.',
    path: ['beds'],
  })
  .refine((data) => data.isDormitory || data.maxOccupancy != null, {
    message: 'Enter a max occupancy greater than 0.',
    path: ['maxOccupancy'],
  })
  .refine((data) => !data.isDormitory || data.dormitoryGender != null, {
    message: 'Choose who this dormitory is for.',
    path: ['dormitoryGender'],
  })
  .refine((data) => !data.isDormitory || data.dormitoryPrice != null, {
    message: 'Enter a price per night for this dormitory.',
    path: ['dormitoryPrice'],
  })
  .refine((data) => !data.isDormitory || data.dormitoryIsAc != null, {
    message: 'Choose AC or Non-AC.',
    path: ['dormitoryIsAc'],
  });

const statusSchema = z.object({ isActive: z.boolean({ error: 'isActive must be true or false.' }) });

// When the property wants its rooms back, and what it charges for the guest
// who doesn't. checkinMode isn't here on purpose — it is fixed at registration.
const checkoutPolicySchema = z
  .object({
    checkOutTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a checkout time as HH:MM, e.g. 11:00.'),
    // Only meaningful on a CYCLE property; harmless elsewhere.
    checkInTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a check-in time as HH:MM, e.g. 11:00.')
      .optional(),
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

module.exports = {
  createRoomSchema,
  updateRoomSchema,
  statusSchema,
  checkoutPolicySchema,
  DORMITORY_GENDERS,
  DORMITORY_AC_OPTIONS,
};
