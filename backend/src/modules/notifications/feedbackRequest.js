const { logger } = require('../../config/logger');
const whatsapp = require('../../config/whatsapp');

// The WhatsApp ask for feedback a guest gets a few hours after checkout (or
// an organiser gets after their function is marked complete — see
// eventFeedbackRequests.service.js).
//
// The template's two variables, in order:
//
//   {{1}} name  {{2}} greet_message
//
// "Hello *{{1}}*, {{2}} We look forward to serving you again."
//
// greet_message is the whole of the rest of the body — hotel name, the ask,
// and the feedback_link — composed server-side by buildGreetMessage below,
// not three separate placeholders. An earlier three-variable version of this
// template ({{1}} name {{2}} hotel_name {{3}} feedback_link) was rejected by
// WhatsApp's reviewers; collapsing the last two into one variable leaves
// exactly one placeholder per line of static text, which is the shape that
// passed approval.
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

// The composed {{2}}. Not run through clean() as a whole — the line breaks
// are meaningful, and clean() would flatten them to spaces — only the hotel
// name is cleaned before it goes in, since that's the one piece of this
// block that is ever user-typed data and so the one piece that could carry
// a comma. The static wording and the link carry none, so the finished
// block is guaranteed comma-free without needing to scrub it afterwards.
function buildGreetMessage(lodge, link) {
  const hotelName = clean(lodge.name);
  return `Thank you for choosing ${hotelName}. We would appreciate it if you could take a moment to share your feedback with us.\n\nPlease use the link below to leave your feedback:\n${link}`;
}

// The two template values, in template order. Pure, so it can be checked
// without a database; booking is bookings.service.js's mapped getBooking()
// shape (camelCase), lodge the row feedbackRequests.service.js's own
// loadLodge hands over, link the full URL already built by the caller
// (feedbackRequests.service.js owns the token and publicBaseUrl() call —
// this module only ever sees the finished string).
function buildFeedbackSample(booking, lodge, link) {
  return [clean(booking.guestName), buildGreetMessage(lodge, link)];
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
  buildGreetMessage,
  clean,
};
