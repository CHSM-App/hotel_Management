const { logger } = require('../../config/logger');
const whatsapp = require('../../config/whatsapp');

// The WhatsApp nudge an organiser gets the day before their function.
//
// The template's seven variables, in order:
//
//   {{1}} name        {{5}} event_date
//   {{2}} hotel_name   {{6}} event_time
//   {{3}} days_away     {{7}} phone
//   {{4}} venue
//
// "Hi {{1}}, Just a friendly reminder — your event at {{2}} is {{3}}!
//  Venue: {{4}} / Date: {{5}} / Time: {{6}}. We can't wait to host you!
//  If there's anything we can help with before the day, just call us at
//  {{7}}. See you soon!"
//
// Unlike stayReminder.js, there is only ever one moment here — the sweep
// (eventReminders.service.js) fires it exactly one day before the event, so
// {{3}} is always "tomorrow"; no lead-time branching like the stay
// reminder's THREE_DAY/ONE_DAY split was asked for on this one.
//
// Best-effort, by design — same reasoning as the other notifiers. The sweep
// that calls this marks the function reminded regardless of whether the
// send actually succeeded (see eventReminders.service.js), so a provider
// outage costs that one function its reminder rather than retrying forever.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAYS_AWAY_LABEL = 'tomorrow';

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

// An instant, said in IST — every property on this system is in India, and
// an event booked for "6 PM" must read 6 PM regardless of the server's clock.
function istParts(value) {
  const shifted = new Date(new Date(value).getTime() + IST_OFFSET_MS);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    min: shifted.getUTCMinutes(),
  };
}

function eventDate(startAt) {
  const { y, m, d } = istParts(startAt);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function eventTime(startAt) {
  const { h, min } = istParts(startAt);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(min).padStart(2, '0')} ${suffix}`;
}

function lodgeContact(lodge) {
  return lodge.phone || lodge.whatsappNumber || '-';
}

// The seven template values, in template order. Pure, so it can be checked
// without a database; event is eventReminders.service.js's own row shape
// (camelCase, built straight off the SELECT — see loadDueEvents), lodge the
// same shape stayReminder.js's buildReminderSample takes.
function buildReminderSample(event, lodge) {
  return [
    clean(event.organiserName),
    clean(lodge.name),
    clean(DAYS_AWAY_LABEL),
    clean(event.venueName),
    clean(eventDate(event.startAt)),
    clean(eventTime(event.startAt)),
    clean(lodgeContact(lodge)),
  ];
}

// Fires the reminder and reports how it went, never throwing — one
// function's failed send must not stop the sweep from reaching the rest.
async function notifyUpcomingEvent(lodgeId, event, lodge) {
  if (!whatsapp.isEventReminderTemplateConfigured()) return { status: 'skipped', reason: 'not configured' };
  if (!event.organiserPhone) return { status: 'skipped', reason: 'no organiser phone' };
  try {
    const sample = buildReminderSample(event, lodge);
    const { campaignId } = await whatsapp.sendTemplateMessage(
      event.organiserPhone,
      whatsapp.EVENT_REMINDER_TEMPLATE_ID,
      sample.join(','),
      'event_reminder'
    );
    logger.info({ eventId: event.id, lodgeId, campaignId }, 'Event reminder sent on WhatsApp');
    return { status: 'sent', campaignId };
  } catch (err) {
    logger.warn({ eventId: event.id, lodgeId, err }, 'Event reminder could not be sent on WhatsApp');
    return { status: 'failed', error: err.message };
  }
}

module.exports = {
  notifyUpcomingEvent,
  buildReminderSample,
  eventDate,
  eventTime,
  DAYS_AWAY_LABEL,
  clean,
};
