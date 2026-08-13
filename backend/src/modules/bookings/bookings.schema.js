const { z } = require('zod');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateField = (message) => z.string({ error: message }).regex(DATE_RE, message);

const ID_PROOF_TYPES = ['AADHAAR', 'PAN', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID', 'OTHER'];
const VEHICLE_TYPES = ['TWO_WHEELER', 'FOUR_WHEELER', 'TRAVELLER', 'BUS'];

// A vehicle is its plate plus what it is — the type is what turns a list of
// numbers into a parking answer, so it's required whenever a plate is given.
const bookingVehicleSchema = z.object({
  number: z.string().trim().min(1, 'Enter a vehicle number.').max(20),
  type: z.enum(VEHICLE_TYPES, { error: 'Choose a type for each vehicle.' }),
});

// An additional guest beyond the primary one on dbo.bookings — phone and ID
// proof type are optional here (only the primary guest's are required),
// since a room can be booked for guests whose ID proof isn't in hand yet.
// isChild defaults to false so callers that don't split the party (check-in
// adding a late arrival) keep booking adults, as they always did.
const bookingGuestSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name for each additional guest.').max(200),
  phone: z.string().trim().max(20).optional().default(''),
  idProofType: z.enum(ID_PROOF_TYPES).optional(),
  isChild: z.boolean().optional().default(false),
});

// An extra the guest took, and how many of it: the lodge prices one extra bed
// and reception says the guest wanted three. A bare id still means one, so a
// client that hasn't learned about counts yet keeps working.
// The ceiling is a typo guard, not a policy — the lodge sets no limit of its
// own, so 999 beds is legal and 9999 is a slipped keystroke.
const chargeSelectionSchema = z.preprocess(
  (value) => (typeof value === 'number' || typeof value === 'string' ? { id: value, quantity: 1 } : value),
  z.object({
    id: z.coerce.number().int().positive('Choose a valid extra.'),
    quantity: z.coerce
      .number()
      .int('Enter a whole number of extras.')
      .positive('An extra needs a count of at least 1.')
      .max(999, 'That count looks wrong — check the number.')
      .optional()
      .default(1),
  })
);

// The rate reception negotiated for this stay, replacing the room category's
// base price. Multipart form fields arrive as strings and an untouched input
// posts '' — that means "no override", not a ₹0 room, so it's normalised away
// before the number check runs.
const basePriceOverrideField = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.coerce
    .number({ error: 'Enter a valid base price.' })
    .positive('Enter a base price greater than 0.')
    .max(1000000, 'That base price looks wrong — check the amount.')
    .optional()
);

// idProofType is optional here — a walk-in guest provides ID proof on the
// spot (enforced by the controller requiring a matching file upload), but a
// pre-reservation only needs the primary guest's name and phone to hold the
// room; their ID proof is captured later at check-in instead.
const createBookingSchema = z
  .object({
    roomId: z.coerce.number().int().positive('Choose a room.'),
    checkInDate: dateField('Choose a check-in date.'),
    checkOutDate: dateField('Choose a check-out date.'),
    guestName: z.string({ error: 'Enter the guest name.' }).trim().min(1, 'Enter the guest name.'),
    guestPhone: z.string({ error: 'Enter the guest phone number.' }).trim().min(1, 'Enter the guest phone number.'),
    numGuests: z.coerce.number().int().positive().optional().default(1),
    basePriceOverride: basePriceOverrideField,
    idProofType: z.enum(ID_PROOF_TYPES).optional(),
    advanceAmount: z.coerce.number().nonnegative().optional(),
    advancePaymentMethod: z.enum(['CASH', 'UPI', 'CARD']).optional(),
    guests: z.array(bookingGuestSchema).optional().default([]),
    vehicles: z.array(bookingVehicleSchema).optional().default([]),
    switchableCharges: z.array(chargeSelectionSchema).optional().default([]),
  })
  .refine((data) => data.checkOutDate > data.checkInDate, {
    message: 'Check-out date must be after check-in date.',
    path: ['checkOutDate'],
  })
  .refine((data) => data.guests.length + 1 <= data.numGuests, {
    message: 'Guest details can’t exceed the number of guests.',
    path: ['guests'],
  })
  .refine(
    (data) => (data.advanceAmount == null) === (data.advancePaymentMethod == null),
    { message: 'Choose a payment method for the advance amount.', path: ['advancePaymentMethod'] }
  );

// Check-in is also where staff fill in guest/vehicle details that weren't
// available at booking time (a pre-booked stay might arrive with a vehicle
// the guest didn't know about in advance) — same shape as createBookingSchema,
// added on top of whatever guests/vehicles the booking already has. The
// primary guest's idProofType is only meaningful here when the booking was
// created without one (a pre-reservation) — the controller and service treat
// it as filling in what's missing, not replacing what's already on file.
const checkInSchema = z
  .object({
    advanceAmount: z.coerce.number().nonnegative().optional(),
    advancePaymentMethod: z.enum(['CASH', 'UPI', 'CARD']).optional(),
    idProofType: z.enum(ID_PROOF_TYPES).optional(),
    guests: z.array(bookingGuestSchema).optional().default([]),
    vehicles: z.array(bookingVehicleSchema).optional().default([]),
  })
  .refine(
    (data) => (data.advanceAmount == null) === (data.advancePaymentMethod == null),
    { message: 'Choose a payment method for the advance amount.', path: ['advancePaymentMethod'] }
  );

// Every field is optional and independently updatable — a save might touch
// only the guest's phone number, or only the room. switchableCharges has
// no .default([]) here (unlike createBookingSchema) on purpose: omitted
// means "leave the current extras alone", an explicit [] means "clear
// them", and the service needs to tell those two apart.
// basePriceOverride follows the same three-way rule as switchableCharges:
// omitted keeps the agreed rate, null drops back to the category's price, and
// a number re-prices the stay at that rate.
const updateBookingSchema = z.object({
  basePriceOverride: z.preprocess(
    (value) => (value === '' ? null : value),
    z.union([
      z.coerce
        .number()
        .positive('Enter a base price greater than 0.')
        .max(1000000, 'That base price looks wrong — check the amount.'),
      z.null(),
    ]).optional()
  ),
  checkOutDate: dateField('Choose a valid check-out date.').optional(),
  roomId: z.coerce.number().int().positive('Choose a valid room.').optional(),
  numGuests: z.coerce.number().int().positive('Enter a guest count greater than 0.').optional(),
  guestName: z.string().trim().min(1, 'Enter the guest name.').optional(),
  guestPhone: z.string().trim().min(1, 'Enter the guest phone number.').optional(),
  switchableCharges: z.array(chargeSelectionSchema).optional(),
});

// What reception decided to charge for running past the checkout deadline.
// Defaults to 0 so an on-time checkout can keep posting an empty body, and 0
// is also the explicit "waived" answer — the two are indistinguishable here on
// purpose, because late_checkout_minutes is what tells them apart later.
const checkOutSchema = z.object({
  lateCharge: z.coerce
    .number()
    .min(0, 'A late charge can’t be negative.')
    .max(100000, 'That late charge looks wrong — check the amount.')
    .optional()
    .default(0),
});

module.exports = {
  DATE_RE,
  ID_PROOF_TYPES,
  VEHICLE_TYPES,
  createBookingSchema,
  checkInSchema,
  updateBookingSchema,
  checkOutSchema,
};
