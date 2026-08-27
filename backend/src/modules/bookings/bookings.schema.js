const { z } = require('zod');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateField = (message) => z.string({ error: message }).regex(DATE_RE, message);

const ID_PROOF_TYPES = ['AADHAAR', 'PAN', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID', 'OTHER'];

const TEN_DIGITS = /^\d{10}$/;
const MOBILE_MESSAGE = 'Enter a 10-digit mobile number.';

// Takes what a desk actually types and keeps the ten digits that matter.
//
// Spaces and hyphens go, because "98765 43210" is how the number is read aloud
// and written on a slip. A +91 or a leading 0 goes too: both are ways of saying
// the same subscriber, and rejecting them would have staff retyping a number
// they had already entered correctly.
//
// Stored bare, so a guest looked up by phone matches whatever form the desk
// typed it in the second time.
function normaliseMobile(value) {
  if (typeof value !== 'string') return value;
  const digits = value.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

// The primary guest's number, which the stay cannot be taken without: it is how
// the property reaches whoever is in the room.
const requiredMobileField = () =>
  z.preprocess(
    normaliseMobile,
    z.string({ error: 'Enter the guest phone number.' }).regex(TEN_DIGITS, MOBILE_MESSAGE)
  );

// Everyone else on the booking. Blank stays blank — a second adult's number is
// useful, not required — but anything typed has to be a real one.
const optionalMobileField = () =>
  z.preprocess(
    (value) => {
      const digits = normaliseMobile(value);
      return digits === '' || digits == null ? undefined : digits;
    },
    z.string().regex(TEN_DIGITS, MOBILE_MESSAGE).optional()
  );
const VEHICLE_TYPES = ['TWO_WHEELER', 'FOUR_WHEELER', 'TRAVELLER', 'BUS'];
// The ID number read off the card, accepted instead of a scan of it. An
// untouched input posts '', which means "not given" rather than an empty ID,
// so it normalises to undefined and the COALESCE writes leave what's on file.
//
// Length only — no per-type format check. See the note in schema.sql: the
// number is a convenience for a desk without a scanner, and rejecting a
// legitimate passport because it doesn't look like an Aadhaar would push staff
// back to entering nothing at all.
const idProofNumberField = () =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().max(50, 'That ID number looks too long — check it.').optional()
  );

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
  phone: optionalMobileField(),
  idProofType: z.enum(ID_PROOF_TYPES).optional(),
  idProofNumber: idProofNumberField(),
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
    // What reception agreed this extra costs per night, for the whole line
    // rather than per unit. Absent means "charge the lodge price times the
    // count". 0 is allowed — a free extra is a real thing to give away — but
    // negative would credit the guest against the room.
    agreedAmount: z.coerce
      .number()
      .min(0, 'An extra cannot cost less than nothing.')
      .max(999999, 'That price looks wrong — check the number.')
      .optional(),
  })
);

// What reception knocked off the stay total after every extra was on it — one
// concession on the whole quote, not a re-negotiated nightly rate. Multipart
// form fields arrive as strings and an untouched input posts '', which means
// "no concession" rather than an invalid number, so it normalises to 0.
//
// A function rather than a shared constant: create and update need the same
// rules but different presence semantics, and reusing one instance would give
// them the same one.
const discountAmountField = () =>
  z.preprocess(
    (value) => (value === '' ? 0 : value),
    z.coerce
      .number({ error: 'Enter a valid concession amount.' })
      .min(0, 'A concession can’t be negative.')
      .max(1000000, 'That concession looks wrong — check the amount.')
      .optional()
  );

// Money that arrived over UPI or a card leaves a reference on both sides —
// the guest's app and the property's settlement statement — and recording it
// is what makes month-end reconciliation possible. It is offered wherever such
// money is taken, but never demanded: the number is often not to hand at the
// moment of payment, and blocking the booking over it stops a guest at the
// desk. Cash leaves no such trail, so it is not asked for there at all.
const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD'];
const ONLINE_METHODS = ['UPI', 'CARD'];

const paymentReferenceField = () =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().max(64, 'That transaction number looks too long — check it.').optional()
  );

// Applied wherever money is taken, so the rule reads the same at the desk and
// at the till. Named for what it guards rather than for the fields, since the
// two payment points call them different things.
//
// Always satisfied: the reference is optional on every method. Kept as a
// function, with its refines in place, so the rule stays in one place if the
// property ever wants it back for UPI and card.
function requiresReference() {
  return true;
}

const REFERENCE_REQUIRED = 'Enter the transaction number for a UPI or card payment.';

// ---------------------------------------------------------------------------
// Split payments
// ---------------------------------------------------------------------------

// One way money arrived. A guest settling a bill often hands over some cash and
// pays the rest by UPI or card, and every money document here used to record a
// single method — so the other half was filed under a method it never used.
//
// Each line carries its own reference because each is its own payment: two
// cards are two approval codes, and a cash line has none. Same rule as the
// single-method fields, applied per line.
const paymentLineSchema = z
  .object({
    method: z.enum(PAYMENT_METHODS, { error: 'Choose how this part was paid.' }),
    amount: z.coerce
      .number({ error: 'Enter the amount for each payment.' })
      .positive('Each payment must be more than zero.'),
    reference: paymentReferenceField(),
  })
  .refine((line) => requiresReference(line.method, line.reference), {
    message: REFERENCE_REQUIRED,
    path: ['reference'],
  });

// Five is a typo guard rather than a policy — nobody settles a room in six
// tenders, and an unbounded array is a way to write megabytes into a request.
const paymentLinesField = () => z.array(paymentLineSchema).max(5, 'That is too many payments for one settlement.').optional();

// Whether a set of lines settles exactly the amount they are meant to.
//
// Compared in paise, never as floats: 600 + 900.10 is 1500.0999999999999 in
// binary floating point, and a settlement refused for a rounding artefact is
// worse than one that adds up.
function paymentLinesSettle(lines, total) {
  const paise = (n) => Math.round(Number(n) * 100);
  return lines.reduce((sum, line) => sum + paise(line.amount), 0) === paise(total);
}

const PAYMENT_LINES_MISMATCH = 'The payments must add up to the amount collected.';

// The one place a caller turns "however this request expressed the payment"
// into the list of lines to store. Every writer goes through it, including
// autoIssueAdvanceReceipt, which is not an HTTP caller at all.
//
// A request may send lines, or the older single method/reference pair, or
// nothing at all when no money changed hands. The single pair becomes a
// one-line split, which is what makes every document — including every one
// issued before this existed — readable through one code path.
function paymentLinesOf(input, total) {
  if (Array.isArray(input.paymentLines) && input.paymentLines.length > 0) {
    return input.paymentLines.map((line) => ({
      method: line.method,
      amount: Number(line.amount),
      reference: line.reference ?? null,
    }));
  }
  if (!input.paymentMethod || !(Number(total) > 0)) return [];
  return [
    { method: input.paymentMethod, amount: Number(total), reference: input.paymentReference ?? null },
  ];
}


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
    guestPhone: requiredMobileField(),
    numGuests: z.coerce.number().int().positive().optional().default(1),
    discountAmount: discountAmountField(),
    idProofType: z.enum(ID_PROOF_TYPES).optional(),
    idProofNumber: idProofNumberField(),
    // A returning guest picked off the name suggestions: the stay whose ID
    // document should be carried onto this one, so reception doesn't ask for a
    // card the property already holds a copy of. The document is copied
    // server-side — the browser never sees it, and never sends it back.
    idProofFromBookingId: z.coerce.number().int().positive().optional(),
    advanceAmount: z.coerce.number().nonnegative().optional(),
    advancePaymentMethod: z.enum(PAYMENT_METHODS).optional(),
    advanceReference: paymentReferenceField(),
    // Part cash, part UPI — the usual shape of a deposit. advancePaymentMethod
    // above stays required and stays the first tender, so the booking row and
    // the register keep a single method to show; these say what really arrived.
    advanceLines: paymentLinesField(),
    // The nightly rate reception agreed for this stay, where it is not the
    // category's own. Positive or absent — a zero or negative rate is a
    // mis-key, and the pricing engine ignores one rather than selling a room
    // for nothing.
    basePriceOverride: z.coerce
      .number({ error: 'Enter the room rate as a number.' })
      .positive('A room rate has to be more than zero.')
      .optional(),
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
  )
  .refine((data) => requiresReference(data.advancePaymentMethod, data.advanceReference), {
    message: REFERENCE_REQUIRED,
    path: ['advanceReference'],
  })
  .refine(
    (data) => !data.advanceLines?.length || paymentLinesSettle(data.advanceLines, data.advanceAmount),
    { message: PAYMENT_LINES_MISMATCH, path: ['advanceLines'] }
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
    advancePaymentMethod: z.enum(PAYMENT_METHODS).optional(),
    advanceReference: paymentReferenceField(),
    // Part cash, part UPI — the usual shape of a deposit. advancePaymentMethod
    // above stays required and stays the first tender, so the booking row and
    // the register keep a single method to show; these say what really arrived.
    advanceLines: paymentLinesField(),
    idProofType: z.enum(ID_PROOF_TYPES).optional(),
    idProofNumber: idProofNumberField(),
    guests: z.array(bookingGuestSchema).optional().default([]),
    vehicles: z.array(bookingVehicleSchema).optional().default([]),
  })
  .refine(
    (data) => (data.advanceAmount == null) === (data.advancePaymentMethod == null),
    { message: 'Choose a payment method for the advance amount.', path: ['advancePaymentMethod'] }
  )
  .refine((data) => requiresReference(data.advancePaymentMethod, data.advanceReference), {
    message: REFERENCE_REQUIRED,
    path: ['advanceReference'],
  })
  .refine(
    (data) => !data.advanceLines?.length || paymentLinesSettle(data.advanceLines, data.advanceAmount),
    { message: PAYMENT_LINES_MISMATCH, path: ['advanceLines'] }
  );

// An edit sends the whole party back, not a list of changes — so an existing
// guest has to say which row they are, or a save would delete and re-create
// them and lose the ID proof already on file. No id means a guest added by
// this edit; a row whose id doesn't come back was removed by it.
const editBookingGuestSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  name: z.string().trim().min(1, 'Enter a name for each additional guest.').max(200),
  phone: optionalMobileField(),
  idProofType: z.enum(ID_PROOF_TYPES).optional(),
  idProofNumber: idProofNumberField(),
  isChild: z.boolean().optional().default(false),
});

// Blank clears, absent leaves alone. An advance is the one money field on a
// booking that can legitimately go back to "none" — a deposit refunded or
// keyed in against the wrong stay — so '' has to mean something different
// from not sending the field at all.
// z.null() is tried first on purpose. A union takes the first branch that
// matches, and z.coerce.number() matches null by coercing it to 0 — so with
// the value schema first, clearing an advance silently recorded a ₹0 payment
// with no method against it instead of no payment at all.
const clearableField = (schema) =>
  z.preprocess((value) => (value === '' ? null : value), z.union([z.null(), schema]).optional());

// Every field is optional and independently updatable — a save might touch
// only the guest's phone number, or only the room. switchableCharges has
// no .default([]) here (unlike createBookingSchema) on purpose: omitted
// means "leave the current extras alone", an explicit [] means "clear
// them", and the service needs to tell those two apart. guests and vehicles
// follow the same rule.
// discountAmount is the same two-way rule: omitted keeps whatever concession
// was already agreed, and a number (0 included, which is how a concession is
// taken back) re-prices the stay against it.
const updateBookingSchema = z
  .object({
    discountAmount: discountAmountField(),
    // Only a stay that hasn't started yet can be moved — see the guard in
    // updateBooking. Once a guest is in the room, when they arrived is a fact,
    // not a field.
    checkInDate: dateField('Choose a valid check-in date.').optional(),
    checkOutDate: dateField('Choose a valid check-out date.').optional(),
    roomId: z.coerce.number().int().positive('Choose a valid room.').optional(),
    numGuests: z.coerce.number().int().positive('Enter a guest count greater than 0.').optional(),
    guestName: z.string().trim().min(1, 'Enter the guest name.').optional(),
    guestPhone: requiredMobileField().optional(),
    switchableCharges: z.array(chargeSelectionSchema).optional(),
    guests: z.array(editBookingGuestSchema).optional(),
    vehicles: z.array(bookingVehicleSchema).optional(),
    // Set, not added to — unlike check-in, which tops up whatever was already
    // taken. An edit is a correction of the record, so what is typed is what
    // the booking ends up holding.
    advanceAmount: clearableField(z.coerce.number().nonnegative('An advance can’t be negative.')),
    advancePaymentMethod: clearableField(z.enum(PAYMENT_METHODS)),
    advanceReference: clearableField(z.string().trim().max(64, 'That transaction number looks too long — check it.')),
    // Same two-way rule as the advance: absent leaves the agreed rate alone,
    // blank puts the stay back on the category's own price.
    basePriceOverride: clearableField(
      z.coerce
        .number({ error: 'Enter the room rate as a number.' })
        .positive('A room rate has to be more than zero.')
    ),
    idProofType: z.enum(ID_PROOF_TYPES).optional(),
    idProofNumber: idProofNumberField(),
  })
  .refine((data) => (data.advanceAmount == null) === (data.advancePaymentMethod == null), {
    message: 'Choose a payment method for the advance amount.',
    path: ['advancePaymentMethod'],
  })
  .refine((data) => requiresReference(data.advancePaymentMethod, data.advanceReference), {
    message: REFERENCE_REQUIRED,
    path: ['advanceReference'],
  });

// A parked booking form. Deliberately barely validated: the whole point of a
// draft is that it is allowed to be wrong and incomplete — half a phone
// number, no room yet, a date range the wrong way round. It gets validated
// properly when it is turned into a booking, by the schema above.
//
// The two rules that do apply are about the shape the screen has to be able to
// render back, and a size ceiling so a draft can't be used to write megabytes
// into the row.
const bookingDraftSchema = z.object({
  form: z
    .object({
      adults: z.array(z.object({ name: z.string().max(200).optional().default('') }).loose()).min(1),
      children: z.array(z.looseObject({})),
    })
    .loose()
    .refine((form) => JSON.stringify(form).length <= 200000, {
      message: 'That draft is too large to save.',
    }),
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
  PAYMENT_METHODS,
  ONLINE_METHODS,
  requiresReference,
  REFERENCE_REQUIRED,
  paymentLineSchema,
  paymentLinesField,
  paymentLinesSettle,
  paymentLinesOf,
  PAYMENT_LINES_MISMATCH,
  ID_PROOF_TYPES,
  VEHICLE_TYPES,
  createBookingSchema,
  checkInSchema,
  updateBookingSchema,
  checkOutSchema,
  bookingDraftSchema,
};
