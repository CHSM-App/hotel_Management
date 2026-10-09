const { logger } = require('../../config/logger');
const whatsapp = require('../../config/whatsapp');

// The WhatsApp ask for feedback a guest gets a few hours after checkout.
//
// The template's three variables, in order:
//
//   {{1}} name  {{2}} hotel_name  {{3}} feedback_link
//
// "Hi {{1}}, {{2}}. Thank you so much for staying with us. We hope you had a
//  comfortable and memorable time. Your feedback means a lot to us — it
//  helps us take even better care of you and every guest after you. Share
//  your experience here: {{3}}. With gratitude and warm wishes."
//
// feedback_link opens a page this app hosts itself (see
// feedbackRequests.service.js and public.service.js's getFeedbackContext) —
// not an owner-supplied review URL. Every response lands in
// dbo.feedback_requests rather than on a third-party page nobody here sees.
//
// Best-effort, by design — same reasoning as the other notifiers. The sweep
// that calls this has already created the dbo.feedback_requests row (and so
// already "spent" this booking's one ask) before the send is even attempted,
// so a provider outage costs that booking its feedback request rather than
// leaving it to retry forever.

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

// The three template values, in template order. Pure, so it can be checked
// without a database; booking is bookings.service.js's mapped getBooking()
// shape (camelCase), lodge the row feedbackRequests.service.js's own
// loadLodge hands over, link the full URL already built by the caller
// (feedbackRequests.service.js owns the token and publicBaseUrl() call —
// this module only ever sees the finished string).
function buildFeedbackSample(booking, lodge, link) {
  return [clean(booking.guestName), clean(lodge.name), clean(link)];
}

// Fires the feedback request and reports how it went, never throwing — the
// dbo.feedback_requests row already exists by the time this is called, so a
// failure here just means that booking's one ask went unanswered, not that
// the sweep has to undo anything.
async function notifyFeedbackRequest(lodgeId, booking, lodge, link) {
  if (!whatsapp.isFeedbackTemplateConfigured()) return { status: 'skipped', reason: 'not configured' };
  if (!booking.guestPhone) return { status: 'skipped', reason: 'no guest phone' };
  try {
    const sample = buildFeedbackSample(booking, lodge, link);
    const { campaignId } = await whatsapp.sendTemplateMessage(
      booking.guestPhone,
      whatsapp.FEEDBACK_TEMPLATE_ID,
      sample.join(','),
      'feedback_request'
    );
    logger.info({ bookingId: booking.id, lodgeId, campaignId }, 'Feedback request sent on WhatsApp');
    return { status: 'sent', campaignId };
  } catch (err) {
    logger.warn({ bookingId: booking.id, lodgeId, err }, 'Feedback request could not be sent on WhatsApp');
    return { status: 'failed', error: err.message };
  }
}

module.exports = {
  notifyFeedbackRequest,
  buildFeedbackSample,
  clean,
};
