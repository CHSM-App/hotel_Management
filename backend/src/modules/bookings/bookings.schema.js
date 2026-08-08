const { z } = require('zod');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateField = (message) => z.string({ error: message }).regex(DATE_RE, message);

const ID_PROOF_TYPES = ['AADHAAR', 'PAN', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID', 'OTHER'];

// An additional guest beyond the primary one on dbo.bookings — phone and ID
// proof type are optional here (only the primary guest's are required),
// since a room can be booked for guests whose ID proof isn't in hand yet.
const bookingGuestSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name for each additional guest.').max(200),
  phone: z.string().trim().max(20).optional().default(''),
  idProofType: z.enum(ID_PROOF_TYPES).optional(),
});

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
    idProofType: z.enum(ID_PROOF_TYPES).optional(),
    advanceAmount: z.coerce.number().nonnegative().optional(),
    advancePaymentMethod: z.enum(['CASH', 'UPI', 'CARD']).optional(),
    guests: z.array(bookingGuestSchema).optional().default([]),
    vehicleNumbers: z.array(z.string().trim().min(1).max(20)).optional().default([]),
    switchableChargeIds: z.array(z.coerce.number().int().positive()).optional().default([]),
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
    vehicleNumbers: z.array(z.string().trim().min(1).max(20)).optional().default([]),
  })
  .refine(
    (data) => (data.advanceAmount == null) === (data.advancePaymentMethod == null),
    { message: 'Choose a payment method for the advance amount.', path: ['advancePaymentMethod'] }
  );

// Every field is optional and independently updatable — a save might touch
// only the guest's phone number, or only the room. switchableChargeIds has
// no .default([]) here (unlike createBookingSchema) on purpose: omitted
// means "leave the current extras alone", an explicit [] means "clear
// them", and the service needs to tell those two apart.
const updateBookingSchema = z.object({
  checkOutDate: dateField('Choose a valid check-out date.').optional(),
  roomId: z.coerce.number().int().positive('Choose a valid room.').optional(),
  numGuests: z.coerce.number().int().positive('Enter a guest count greater than 0.').optional(),
  guestName: z.string().trim().min(1, 'Enter the guest name.').optional(),
  guestPhone: z.string().trim().min(1, 'Enter the guest phone number.').optional(),
  switchableChargeIds: z.array(z.coerce.number().int().positive()).optional(),
});

module.exports = { DATE_RE, ID_PROOF_TYPES, createBookingSchema, checkInSchema, updateBookingSchema };
