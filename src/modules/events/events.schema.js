const { z } = require('zod');
const { DATE_RE, TEN_DIGITS, MOBILE_MESSAGE, normaliseMobile, optionalMobileField } = require('../bookings/bookings.schema');

// The organiser's number, with the same digit-keeping normalisation the stay
// form applies — but its own "missing" message, because "guest phone number"
// is the wrong word for whoever is paying for a wedding.
const requiredMobileField = (message) => z.preprocess(normaliseMobile, z.string({ error: message }).regex(TEN_DIGITS, MOBILE_MESSAGE));

const EVENT_TYPES = ['BIRTHDAY', 'WEDDING', 'RECEPTION', 'ENGAGEMENT', 'CORPORATE', 'OTHER'];
const SLOTS = ['MORNING', 'EVENING', 'FULL_DAY', 'CUSTOM'];
// The states the desk can put a fresh booking straight into. SETTLED only
// ever comes from the bill, and CANCELLED / EXPIRED are ways out, not in.
const OPENING_STATUSES = ['ENQUIRY', 'TENTATIVE', 'CONFIRMED'];

// An instant with its offset, as the browser sends it. Parsed rather than
// pattern-matched: what matters is that it is a real moment, and Date.parse is
// the same reading the service will give it.
const instantField = (message) =>
  z
    .string({ error: message })
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), message);

// '' from an untouched box means "not given", the same convention every other
// optional text field here follows — and so does null, which is how the form
// sends a note or reason it has nothing to say in.
const optionalText = (max) =>
  z.preprocess(
    (value) => (value == null || (typeof value === 'string' && value.trim() === '') ? undefined : value),
    z.string().trim().max(max).optional()
  );

// A money box left blank is "nothing", not an invalid number.
const moneyField = (message) =>
  z.preprocess(
    (value) => (value === '' || value == null ? undefined : value),
    z.coerce.number({ error: message }).min(0, message).max(9999999, 'That amount looks wrong — check it.').optional()
  );

const paxField = (message) =>
  z.preprocess(
    (value) => (value === '' || value == null ? undefined : value),
    z.coerce.number({ error: message }).int(message).min(0, message).max(100000, 'That count looks wrong — check it.').optional()
  );

const venueSchema = z.object({
  name: z.string({ error: 'Enter a name for the venue.' }).trim().min(1, 'Enter a name for the venue.').max(100),
  capacityPax: paxField('Enter the capacity as a whole number.'),
  baseCharge: moneyField('Enter the hire charge as a number.').default(0),
});

const updateVenueSchema = venueSchema.partial().extend({
  isActive: z.boolean().optional(),
});

const addonSchema = z.object({
  name: z.string({ error: 'Enter a name for the add-on.' }).trim().min(1, 'Enter a name for the add-on.').max(100),
  defaultAmount: moneyField('Enter the price as a number.').default(0),
  isPerUnit: z.boolean().optional().default(false),
});

const updateAddonSchema = addonSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// One add-on on a booking. Either a catalogue id (the label and unit price
// are read off the catalogue, unless overridden) or a typed label for a
// one-off. agreedAmount is the whole line; absent means unit × quantity.
const addonLineSchema = z
  .object({
    addonId: z.coerce.number().int().positive().optional(),
    label: optionalText(100),
    quantity: z.coerce
      .number()
      .int('Enter a whole number for the quantity.')
      .min(1, 'An add-on needs a quantity of at least 1.')
      .max(9999, 'That quantity looks wrong — check it.')
      .optional()
      .default(1),
    unitAmount: moneyField('Enter the add-on price as a number.'),
    agreedAmount: moneyField('Enter the agreed amount as a number.'),
    // Set on a line noted from the function's page while it was live, and
    // carried through an edit so the flag survives the form re-sending
    // every line. needsPricing is only honest on an extra.
    isExtra: z.boolean().optional(),
    needsPricing: z.boolean().optional(),
    notedAt: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.string().optional()),
  })
  .refine((line) => line.addonId != null || (line.label && line.label.length > 0), {
    message: 'Name each add-on, or pick one from the list.',
    path: ['label'],
  });

// What the quote is priced from. Shared by the live quote and by create /
// update, so what the desk saw is what gets saved.
const pricingFields = {
  venueId: z.coerce.number({ error: 'Choose a venue.' }).int().positive('Choose a venue.'),
  expectedPax: paxField('Enter the expected number of guests.'),
  guaranteedPax: paxField('Enter the guaranteed minimum as a whole number.'),
  finalPax: paxField('Enter the final head count as a whole number.'),
  // Absent means "the venue's own charge".
  venueCharge: moneyField('Enter the venue charge as a number.'),
  perPlateRate: moneyField('Enter the per-plate rate as a number.'),
  addons: z.array(addonLineSchema).max(50, 'That is too many add-ons for one function.').optional().default([]),
  discountAmount: moneyField('Enter a valid concession amount.'),
  discountReason: optionalText(100),
};

const quoteSchema = z.object(pricingFields);

// A date the way the stay form sends one, blank meaning "not given".
const optionalDateField = (message) =>
  z.preprocess(
    (value) => (value === '' || value == null ? undefined : value),
    z.string({ error: message }).regex(DATE_RE, message).optional()
  );

// Rooms wanted alongside the function. Recorded as a need — how many, which
// nights, a note — not booked: the stay is made from the tape chart. When
// roomsRequired is off the rest is ignored and cleared.
const roomsFields = {
  roomsRequired: z.boolean().optional(),
  roomsCount: z.preprocess(
    (value) => (value === '' || value == null ? undefined : value),
    z.coerce
      .number({ error: 'How many rooms are needed?' })
      .int('Enter the number of rooms as a whole number.')
      .min(1, 'How many rooms are needed?')
      .max(999, 'That many rooms looks wrong — check it.')
      .optional()
  ),
  roomsFrom: optionalDateField('Choose the night the rooms are needed from.'),
  roomsTo: optionalDateField('Choose the morning the rooms are needed until.'),
  roomsNotes: optionalText(500),
};

// Only checked when rooms are asked for: an unticked box carries nothing.
const roomsAreComplete = (data) => {
  if (!data.roomsRequired) return true;
  return data.roomsCount != null && data.roomsFrom != null && data.roomsTo != null && data.roomsTo > data.roomsFrom;
};
const roomsMessage = (data) => {
  if (data.roomsCount == null) return ['roomsCount', 'How many rooms are needed?'];
  if (data.roomsFrom == null) return ['roomsFrom', 'Choose the night the rooms are needed from.'];
  if (data.roomsTo == null) return ['roomsTo', 'Choose the morning the rooms are needed until.'];
  return ['roomsTo', 'The rooms have to be needed for at least one night.'];
};
const withRoomsCheck = (schema) =>
  schema.superRefine((data, ctx) => {
    if (roomsAreComplete(data)) return;
    const [path, message] = roomsMessage(data);
    ctx.addIssue({ code: 'custom', path: [path], message });
  });

const detailFields = {
  eventType: z.enum(EVENT_TYPES, {
    error: 'Choose what kind of function this is.',
  }),
  title: z.string({ error: 'Give the function a name.' }).trim().min(1, 'Give the function a name.').max(200),
  organiserName: z.string({ error: 'Enter the organiser’s name.' }).trim().min(1, 'Enter the organiser’s name.').max(200),
  organiserPhone: requiredMobileField('Enter the organiser’s phone number.'),
  organiserAltPhone: optionalMobileField(),
  startAt: instantField('Choose when the function starts.'),
  endAt: instantField('Choose when the function ends.'),
  slot: z.enum(SLOTS).optional().default('CUSTOM'),
  menuNotes: optionalText(4000),
  setupNotes: optionalText(4000),
  scheduleNotes: optionalText(4000),
};

const rangeIsForward = (data) => !data.startAt || !data.endAt || Date.parse(data.endAt) > Date.parse(data.startAt);

// Money taken as the function is written down, the way a stay's booking form
// takes a deposit. The shape the booking form sends: the total, how it was
// paid, the transaction number where one exists, and the split when the
// money arrived more than one way. A deposit is what confirmation means, so
// a function saved with one is confirmed whatever status was asked for.
const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD'];
const advanceLineSchema = z.object({
  method: z.enum(PAYMENT_METHODS, { error: 'Choose how each part was paid.' }),
  amount: z.coerce.number({ error: 'Each payment needs an amount.' }).positive('Each payment must be more than zero.'),
  reference: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().max(64, 'That transaction number looks too long — check it.').optional()
  ),
});
const advanceFields = {
  advanceAmount: moneyField('Enter the advance as a number.'),
  advancePaymentMethod: z.enum(PAYMENT_METHODS, { error: 'Choose how the advance was paid.' }).optional(),
  advanceReference: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().max(64, 'That transaction number looks too long — check it.').optional()
  ),
  advanceLines: z.array(advanceLineSchema).max(5, 'That is too many payments for one advance.').optional(),
};
const takesAdvance = (data) => Number(data.advanceAmount) > 0;
const advanceLinesSettle = (data) =>
  !data.advanceLines?.length ||
  Math.abs(data.advanceLines.reduce((sum, l) => sum + l.amount, 0) - Number(data.advanceAmount)) < 0.005;

const createEventSchema = withRoomsCheck(
  z
    .object({
      ...pricingFields,
      ...detailFields,
      ...roomsFields,
      ...advanceFields,
      // Where the booking starts its life. A phone enquiry stays ENQUIRY; a desk
      // taking a hold or money at the same time can go straight past it.
      status: z.enum(OPENING_STATUSES).optional().default('ENQUIRY'),
      // How long a tentative hold stands. Only read when status is TENTATIVE.
      holdHours: z.coerce.number().int().min(1).max(720).optional(),
    })
    .refine((data) => data.expectedPax != null, {
      message: 'Enter the expected number of guests.',
      path: ['expectedPax'],
    })
    .refine((data) => !takesAdvance(data) || data.advancePaymentMethod != null || (data.advanceLines?.length ?? 0) > 0, {
      message: 'Choose how the advance was paid.',
      path: ['advancePaymentMethod'],
    })
    .refine(
      (data) =>
        !takesAdvance(data) ||
        (data.advanceLines?.length ?? 0) > 1 ||
        data.advancePaymentMethod === 'CASH' ||
        data.advancePaymentMethod == null ||
        data.advanceReference != null,
      { message: 'Enter the UPI or card transaction number for the advance.', path: ['advanceReference'] }
    )
    .refine((data) => !takesAdvance(data) || advanceLinesSettle(data), {
      message: 'The split payments have to add up to the advance.',
      path: ['advanceLines'],
    })
    .refine(rangeIsForward, {
      message: 'The function must end after it starts.',
      path: ['endAt'],
    })
);

// On an edit, free text has three states rather than two: absent leaves it,
// blank or null clears it, anything else replaces it. The form sends every
// note on every save, so a note the desk has emptied must arrive as "clear".
const clearableText = (max) =>
  z.preprocess((v) => (v === '' ? null : v), z.union([z.null(), z.string().trim().max(max)]).optional());

// Everything optional and independently updatable. addons has no default:
// omitted means "leave them", [] means "clear them".
const updateEventSchema = withRoomsCheck(
  z
    .object({
      ...Object.fromEntries(Object.entries(pricingFields).map(([k, v]) => [k, k === 'venueId' ? v.optional() : v])),
      addons: z.array(addonLineSchema).max(50).optional(),
      ...Object.fromEntries(Object.entries(detailFields).map(([k, v]) => [k, v.optional()])),
      menuNotes: clearableText(4000),
      setupNotes: clearableText(4000),
      scheduleNotes: clearableText(4000),
      // Sent as a set: roomsRequired present means "replace the rooms need
      // with this"; absent leaves it as it was.
      ...roomsFields,
      roomsNotes: clearableText(500),
      // Blank clears the discount reason; absent leaves it.
      discountReason: clearableText(100),
    })
    .refine(rangeIsForward, {
      message: 'The function must end after it starts.',
      path: ['endAt'],
    })
);

// An extra noted on the day: what, how many, and the price if one was agreed
// on the spot — left blank, it is a reminder the bill will insist on.
const extraSchema = z.object({
  label: z.string({ error: 'Say what the extra is.' }).trim().min(1, 'Say what the extra is.').max(100),
  quantity: z.coerce
    .number()
    .int('Enter a whole number for the quantity.')
    .min(1, 'An extra needs a quantity of at least 1.')
    .max(9999, 'That quantity looks wrong — check it.')
    .optional()
    .default(1),
  agreedAmount: moneyField('Enter the agreed amount as a number.'),
});

// A blank box is not a price of nothing: coerce would read '' as 0.
const priceExtraSchema = z.object({
  agreedAmount: z.preprocess(
    (value) => (value === '' || value == null ? undefined : value),
    z.coerce
      .number({ error: 'Enter the agreed amount as a number.' })
      .min(0, 'Enter the agreed amount as a number.')
      .max(9999999, 'That amount looks wrong — check it.')
  ),
});

const holdSchema = z.object({
  holdHours: z.coerce.number().int().min(1, 'A hold needs at least an hour.').max(720, 'A hold can’t run past 30 days.').optional(),
});

const cancelSchema = z.object({
  reason: z.string({ error: 'Enter a reason for cancelling.' }).trim().min(1, 'Enter a reason for cancelling.').max(200),
  refundAmount: moneyField('Enter the refund as a number.'),
});

module.exports = {
  DATE_RE,
  EVENT_TYPES,
  SLOTS,
  venueSchema,
  updateVenueSchema,
  addonSchema,
  updateAddonSchema,
  quoteSchema,
  createEventSchema,
  updateEventSchema,
  holdSchema,
  cancelSchema,
  extraSchema,
  priceExtraSchema,
};
