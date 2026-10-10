const { logger } = require('../../config/logger');
const whatsapp = require('../../config/whatsapp');

// The WhatsApp nudge a guest gets before a stay they've already booked.
//
// The template's six variables, in order:
//
//   {{1}} name       {{4}} check_in
//   {{2}} hotel_name  {{5}} check_out
//   {{3}} days_away   {{6}} phone
//
// "Hi {{1}}, Just a friendly reminder — your stay at {{2}} is {{3}}!
//  Check-in: {{4}} / Check-out: {{5}}. We can't wait to welcome you! If
//  there's anything we can help with before you arrive, just call us at
//  {{6}}. See you soon!"
//
// One template, two moments: {{3}} carries "in 3 days" or "tomorrow"
// depending on which reminder this is — see reminderKind in
// stayReminders.service.js for which booking gets which, and why a booking
// never gets both.
//
// Best-effort, by design — same reasoning as the other notifiers. The sweep
// that calls this marks the booking reminded regardless of whether the send
// actually succeeded (see stayReminders.service.js), so a provider outage
// costs that one booking its reminder rather than retrying forever.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DAYS_AWAY_LABEL = {
  THREE_DAY: 'in 3 days',
  ONE_DAY: 'tomorrow',
};

// Same rule as every other notifier: the template's variables travel as one
// comma-separated string, so a comma inside a value would push every later
// variable along by one, and an empty value is sent to WhatsApp as a
// rejected send the provider still reports as submitted (see
// cancellationNotice.js) — so nothing here is ever allowed to come out empty.
function clean(value) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ' - ')
    .trim();
  return text || '-';
}

function dateParts(value) {
  if (typeof value === 'string') {
    const [y, m, d] = value.slice(0, 10).split('-').map(Number);
    return { y, m, d };
  }
  return { y: value.getUTCFullYear(), m: value.getUTCMonth() + 1, d: value.getUTCDate() };
}

function formatDate(value) {
  const { y, m, d } = dateParts(value);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function lodgeContact(lodge) {
  return lodge.phone || lodge.whatsappNumber || '-';
}

// The six template values, in template order. Pure, so it can be checked
// without a database; booking is bookings.service.js's mapped getBooking()
// shape (camelCase), lodge the row stayReminders.service.js's own loadLodge
// hands over. `kind` is 'THREE_DAY' or 'ONE_DAY' — see reminderKind.
function buildReminderSample(booking, lodge, kind) {
  return [
    clean(booking.guestName),
    clean(lodge.name),
    clean(DAYS_AWAY_LABEL[kind]),
    clean(formatDate(booking.checkInDate)),
    clean(formatDate(booking.checkOutDate)),
    clean(lodgeContact(lodge)),
  ];
}

// Fires the reminder and reports how it went, never throwing — one
// booking's failed send must not stop the sweep from reaching the rest.
async function notifyUpcomingStay(lodgeId, booking, lodge, kind) {
  if (!whatsapp.isReminderTemplateConfigured()) return { status: 'skipped', reason: 'not configured' };
  if (!booking.guestPhone) return { status: 'skipped', reason: 'no guest phone' };
  try {
    const sample = buildReminderSample(booking, lodge, kind);
    const { campaignId } = await whatsapp.sendTemplateMessage(
      booking.guestPhone,
      whatsapp.REMINDER_TEMPLATE_ID,
      sample.join(','),
      'stay_reminder'
    );
    logger.info({ bookingId: booking.id, lodgeId, kind, campaignId }, 'Stay reminder sent on WhatsApp');
    return { status: 'sent', campaignId };
  } catch (err) {
    logger.warn({ bookingId: booking.id, lodgeId, kind, err }, 'Stay reminder could not be sent on WhatsApp');
    return { status: 'failed', error: err.message };
  }
}

module.exports = {
  notifyUpcomingStay,
  buildReminderSample,
  DAYS_AWAY_LABEL,
  clean,
};
