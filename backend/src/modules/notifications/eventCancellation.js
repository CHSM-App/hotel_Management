const { getPool, sql } = require('../../config/connection');
const { logger } = require('../../config/logger');
const whatsapp = require('../../config/whatsapp');

// The WhatsApp notice an organiser gets when their function is cancelled —
// cancellationNotice.js's own counterpart for a function rather than a
// stay, since a function has a venue and a single date to name instead of a
// room number and a check-in/check-out pair.
//
// The template's seven variables, in order:
//
//   {{1}} name           {{5}} reason
//   {{2}} hotel_name      {{6}} refund_mode_amount
//   {{3}} venue            {{7}} phone
//   {{4}} event_date
//
// "Dear {{1}}, {{2}}, Your event booking has been cancelled as per your
//  request. Booking Details: Venue: {{3}} / Event Date: {{4}} / {{5}} /
//  {{6}} / Your refund will be processed within a few business days. If
//  you did not request this cancellation, please contact us immediately.
//  contact: {{7}}. We hope to host your event another time."
//
// Best-effort, by design — same reasoning as eventConfirmation.js. The
// cancellation is already committed when this runs, and a provider outage
// must not turn "the cancellation succeeded" into an error at the desk.

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

// The reason slot is a bare line in the template, with no caption of its
// own — same reasoning as cancellationNotice.js's reasonLine: the label is
// always sent, in WhatsApp's bold (*…*), so a missing reason still reads
// "Reason: -" rather than leaving the slot empty.
function reasonLine(reason) {
  return `*Reason:* ${clean(reason)}`;
}

// The event's own calendar day, read off when it starts — same as
// eventConfirmation.js's eventDate, duplicated rather than imported per the
// repo's own self-contained-notifier convention.
function eventDate(startAt) {
  const shifted = new Date(new Date(startAt).getTime() + IST_OFFSET_MS);
  return `${shifted.getUTCDate()} ${MONTHS[shifted.getUTCMonth()]} ${shifted.getUTCFullYear()}`;
}

// "Refund: Rs 10000.00 via UPI" / "Cancellation charge: Rs 2000.00 (adjusted
// against the advance held)" / "No refund due" — whichever of the two
// settlements the desk recorded. The two are mutually exclusive on a
// cancelled function (see cancelEventBooking in events.service.js: a refund
// figure is what sets the cancellation charge, never both independently).
//
// `event` here is getEventBooking()'s mapped shape (camelCase).
function refundModeAmount(event) {
  const refund = event.refundAmount != null ? Number(event.refundAmount) : null;
  const charge = event.cancellationCharge != null ? Number(event.cancellationCharge) : null;
  if (refund != null && refund > 0) {
    return `Refund: Rs ${refund.toFixed(2)} via ${event.refundPaymentMethod || '-'}`;
  }
  if (charge != null && charge > 0) {
    return `Cancellation charge: Rs ${charge.toFixed(2)} (adjusted against the advance held)`;
  }
  return 'No refund due';
}

// The seven template values, in template order. Pure, so it can be checked
// without a database; event is getEventBooking()'s mapped shape, lodge the
// raw dbo.lodges row loadLodge below hands over.
function buildCancellationSample(event, lodge) {
  return [
    clean(event.organiserName),
    clean(lodge.name),
    clean(event.venueName),
    clean(eventDate(event.startAt)),
    reasonLine(event.cancelReason),
    clean(refundModeAmount(event)),
    clean(lodge.phone || lodge.whatsapp_number),
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

// Fires the cancellation notice and reports how it went, never throwing —
// the cancellation stands regardless of whether WhatsApp is reachable.
async function notifyEventCancelled(lodgeId, event) {
  if (!whatsapp.isEventCancellationTemplateConfigured()) return { status: 'skipped', reason: 'not configured' };
  try {
    const lodge = await loadLodge(lodgeId);
    if (!lodge) return { status: 'skipped', reason: 'lodge not found' };
    if (!event.organiserPhone) return { status: 'skipped', reason: 'no organiser phone' };

    const sample = buildCancellationSample(event, lodge);
    const { campaignId } = await whatsapp.sendTemplateMessage(
      event.organiserPhone,
      whatsapp.EVENT_CANCELLATION_TEMPLATE_ID,
      sample.join(','),
      'event_cancellation'
    );
    logger.info({ eventId: event.id, lodgeId, campaignId }, 'Event cancellation notice sent on WhatsApp');
    return { status: 'sent', campaignId };
  } catch (err) {
    logger.warn({ eventId: event.id, lodgeId, err }, 'Event cancellation notice could not be sent on WhatsApp');
    return { status: 'failed', error: err.message };
  }
}

module.exports = {
  notifyEventCancelled,
  buildCancellationSample,
  refundModeAmount,
  eventDate,
  clean,
};
