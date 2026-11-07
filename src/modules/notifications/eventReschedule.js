const { getPool, sql } = require('../../config/connection');
const { logger } = require('../../config/logger');
const whatsapp = require('../../config/whatsapp');

// The WhatsApp notice an organiser gets when their confirmed function's
// venue or date/time is edited.
//
// The template's six variables, in order:
//
//   {{1}} name        {{4}} new_date
//   {{2}} hotel_name   {{5}} new_time
//   {{3}} venue         {{6}} phone
//
// "Dear {{1}}, This is {{2}} — your event booking details have been
//  updated. Venue: {{3}} / New Date: {{4}} / New Time: {{5}}. If this
//  change wasn't expected or you have any questions, please call us at
//  {{6}}. Thank you for your understanding."
//
// Fired from updateEventBooking's own `moved` check (events.service.js) —
// the same flag it already uses to decide whether to re-run the clash
// check — so this says something only when the venue or the start/end
// instant actually changed, never on an edit to pax or pricing alone.
//
// Best-effort, by design — same reasoning as the other notifiers. The edit
// is already committed when this runs, and a provider outage must not turn
// "the change was saved" into an error at the desk.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

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

// An instant, said in IST — same shift eventReminder.js's own helpers use.
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

function newDate(startAt) {
  const { y, m, d } = istParts(startAt);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function newTime(startAt) {
  const { h, min } = istParts(startAt);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(min).padStart(2, '0')} ${suffix}`;
}

function lodgeContact(lodge) {
  return lodge.phone || lodge.whatsapp_number || '-';
}

// The six template values, in template order. Pure, so it can be checked
// without a database; event is getEventBooking()'s mapped shape (camelCase)
// — the *updated* row, after the edit — lodge the raw dbo.lodges row
// loadLodge below hands over.
function buildRescheduleSample(event, lodge) {
  return [
    clean(event.organiserName),
    clean(lodge.name),
    clean(event.venueName),
    clean(newDate(event.startAt)),
    clean(newTime(event.startAt)),
    clean(lodgeContact(lodge)),
  ];
}

async function loadLodge(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query('SELECT name, phone, whatsapp_number FROM dbo.lodges WHERE id = @lodgeId');
  return result.recordset[0] ?? null;
}

// Fires the reschedule notice and reports how it went, never throwing — the
// edit stands regardless of whether WhatsApp is reachable.
async function notifyEventRescheduled(lodgeId, event) {
  if (!whatsapp.isEventRescheduleTemplateConfigured()) return { status: 'skipped', reason: 'not configured' };
  try {
    const lodge = await loadLodge(lodgeId);
    if (!lodge) return { status: 'skipped', reason: 'lodge not found' };
    if (!event.organiserPhone) return { status: 'skipped', reason: 'no organiser phone' };

    const sample = buildRescheduleSample(event, lodge);
    const { campaignId } = await whatsapp.sendTemplateMessage(
      event.organiserPhone,
      whatsapp.EVENT_RESCHEDULE_TEMPLATE_ID,
      sample.join(','),
      'event_reschedule'
    );
    logger.info({ eventId: event.id, lodgeId, campaignId }, 'Event reschedule notice sent on WhatsApp');
    return { status: 'sent', campaignId };
  } catch (err) {
    logger.warn({ eventId: event.id, lodgeId, err }, 'Event reschedule notice could not be sent on WhatsApp');
    return { status: 'failed', error: err.message };
  }
}

module.exports = {
  notifyEventRescheduled,
  buildRescheduleSample,
  newDate,
  newTime,
  clean,
};
