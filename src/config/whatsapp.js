const https = require('https');
const { logger } = require('./logger');

// WhatsApp delivery through SMSala (https://api2.smsala.com).
//
// Ported from the college-admission backend's services/whatsapp.js. Two things
// go out over it: the numeric code behind a password change (sendOtp) and the
// approved templates below (sendTemplateMessage, driven from the various
// src/modules/notifications/*.js files — bookingConfirmation.js now covers
// room stays only; an event/function's own confirmation, reminder,
// cancellation, reschedule and final-bill notices each have their own
// template, same reasoning as every other split in this file). The college
// backend also
// mirrors every send into a whatsapp_message_log table; that does not exist
// here, so sends are recorded in the normal application log instead of a table
// nobody would read.
//
// The OTP code itself is never logged. It is the secret the whole flow rests on,
// and a log line carrying it would undo the point of hashing it in the database.

const API_HOST = 'api2.smsala.com';
const API_TOKEN = process.env.WHATSAPP_API_TOKEN || '';
const OTP_TEMPLATE_ID = process.env.WHATSAPP_OTP_TEMPLATE_ID || '';
// The approved "your booking is confirmed" template — room stays only as of
// the split described above. Left blank, no confirmation goes out and
// nothing else changes — the switch for a property that has not had the
// template approved yet. Its ten variables, in order, are built by
// bookingConfirmation.js:
//   {{1}} name  {{2}} hotel_name  {{3}} room  {{4}} checkin_at
//   {{5}} checkout_at  {{6}} advance  {{7}} balance
//   {{8}} receipt_link  {{9}} directions  {{10}} contact
const BOOKING_TEMPLATE_ID = process.env.WHATSAPP_BOOKING_TEMPLATE_ID || '';
// The approved "your event booking is confirmed" template — a function's own
// wording (venue, a single date, a start-end time range) rather than reusing
// the stay template's "Room No"/separate check-in-check-out shape, which
// read wrong for a function. Its ten variables, in order, are built by
// eventConfirmation.js:
//   {{1}} name  {{2}} hotel_name  {{3}} venue  {{4}} event_date
//   {{5}} time_range  {{6}} advance_paid  {{7}} total_amount
//   {{8}} balance_due  {{9}} directions  {{10}} phone
const EVENT_BOOKING_TEMPLATE_ID = process.env.WHATSAPP_EVENT_BOOKING_TEMPLATE_ID || '';
// The approved "here is your bill" template, sent from the billing screen when
// the desk shares a bill with a guest. Separate from the booking one because
// they say different things at different times and a property may have only
// one of them approved. Left blank, the Share menu reports the channel as
// unavailable rather than failing at the provider.
//
// Its seven variables, in order, are built by billShare.service.js:
//   {{1}} name  {{2}} hotel_name  {{3}} booking_id  {{4}} amt
//   {{5}} checkin_date  {{6}} checkout_date  {{7}} link
const BILL_TEMPLATE_ID = process.env.WHATSAPP_BILL_TEMPLATE_ID || '';
// The same for an event booking's final bill — a function's own wording
// (venue, a single event date) rather than the stay bill's "Booking No" /
// check-in-check-out shape, same reasoning as the booking-confirmation split
// above. shareInvoiceOnWhatsApp (billShare.service.js) picks this one over
// BILL_TEMPLATE_ID whenever the invoice being shared is for an event rather
// than a room stay — the desk presses the same "Share on WhatsApp" button
// either way; which template goes out is decided from the invoice itself.
//
// Its seven variables, in order, are built by billShare.service.js:
//   {{1}} name  {{2}} hotel_name  {{3}} bill_no  {{4}} venue
//   {{5}} event_date  {{6}} total_amount  {{7}} link
const EVENT_BILL_TEMPLATE_ID = process.env.WHATSAPP_EVENT_BILL_TEMPLATE_ID || '';
// The approved "your booking is cancelled" template, sent when the desk
// cancels a booking. A separate approval from the confirmation and bill
// templates — cancellation says something different again, at a different
// moment — so a property that hasn't had it approved yet just doesn't send
// this one, same as the other two.
//
// Its seven variables, in order, are built by cancellationNotice.js:
//   {{1}} name  {{2}} hotel_name  {{3}} room_no  {{4}} check_in
//   {{5}} checkout  {{6}} reason  {{7}} refund_mode_amount
const CANCELLATION_TEMPLATE_ID = process.env.WHATSAPP_CANCELLATION_TEMPLATE_ID || '';
// The same for a cancelled function — its own approval, separate from the
// stay cancellation above, since a function names a venue and a single date
// rather than a room number and a check-in/check-out pair.
//
// Its seven variables, in order, are built by eventCancellation.js:
//   {{1}} name  {{2}} hotel_name  {{3}} venue  {{4}} event_date
//   {{5}} reason  {{6}} refund_mode_amount  {{7}} phone
const EVENT_CANCELLATION_TEMPLATE_ID = process.env.WHATSAPP_EVENT_CANCELLATION_TEMPLATE_ID || '';
// The approved "here is your receipt" template, sent from the advance-receipt
// screen when the desk shares an advance/deposit receipt with a guest. Its
// own approval, separate from the bill one: a receipt for money taken up
// front reads differently from a final bill, and a property may have only
// one of the two approved. Unlike the bill template, there is no event-only
// counterpart for this one — the message names no room number, check-in/
// check-out, or venue, so this one template already covers an advance
// against either a room stay or an event booking.
//
// Its six variables, in order, are built by receiptShare.service.js:
//   {{1}} name  {{2}} hotel_name  {{3}} receipt_number
//   {{4}} amt  {{5}} payment_method  {{6}} link
const RECEIPT_TEMPLATE_ID = process.env.WHATSAPP_RECEIPT_TEMPLATE_ID || '';
// The approved "welcome" template, sent once a guest is checked in. Its own
// approval, separate from the booking-confirmation one — a confirmation goes
// out before the stay even starts, this one lands the moment the guest is
// actually standing in the room — so a property can have either, both, or
// neither approved yet.
//
// Its five variables, in order, are built by checkinWelcome.js:
//   {{1}} name  {{2}} hotel_name  {{3}} room_no
//   {{4}} checkout  {{5}} phone
const CHECKIN_TEMPLATE_ID = process.env.WHATSAPP_CHECKIN_TEMPLATE_ID || '';
// The approved "your stay is coming up" reminder template. Sent once per
// booking by the daily sweep (stayReminders.service.js) — three days before
// a stay booked with enough lead time to say that truthfully, or the day
// before a stay booked too close to its own check-in for a three-day notice
// to have ever been true. Its own approval, separate from every other
// template here, same reasoning as the rest.
//
// Its six variables, in order, are built by stayReminder.js:
//   {{1}} name  {{2}} hotel_name  {{3}} days_away
//   {{4}} check_in  {{5}} check_out  {{6}} phone
const REMINDER_TEMPLATE_ID = process.env.WHATSAPP_REMINDER_TEMPLATE_ID || '';
// The same for an upcoming function. Sent once per booking, the day before
// the event, by its own daily sweep (eventReminders.service.js) — unlike the
// stay reminder above, a function only ever gets the one moment, since there
// is no "booked with enough lead time" branch asked for here. Its own
// approval, separate from the stay reminder.
//
// Its seven variables, in order, are built by eventReminder.js:
//   {{1}} name  {{2}} hotel_name  {{3}} days_away  {{4}} venue
//   {{5}} event_date  {{6}} event_time  {{7}} phone
const EVENT_REMINDER_TEMPLATE_ID = process.env.WHATSAPP_EVENT_REMINDER_TEMPLATE_ID || '';
// The approved "your event has been rescheduled" template. Sent when a
// confirmed function's venue or date/time changes under an edit — see
// updateEventBooking's own `moved` check in events.service.js, the same flag
// it already uses to decide whether to re-run the clash check. A function
// that was never confirmed in the first place (still a DRAFT, or already
// cancelled) has nothing to reschedule, so this never fires for either. Its
// own approval, separate from every other template here.
//
// Its six variables, in order, are built by eventReschedule.js:
//   {{1}} name  {{2}} hotel_name  {{3}} venue
//   {{4}} new_date  {{5}} new_time  {{6}} phone
const EVENT_RESCHEDULE_TEMPLATE_ID = process.env.WHATSAPP_EVENT_RESCHEDULE_TEMPLATE_ID || '';
// The approved "please share your feedback" template. Sent a few hours after
// checkout by its own sweep (feedbackRequests.service.js) — or after an
// event is marked complete, by eventFeedbackRequests.service.js; the same
// template and the same two variables serve both, since neither names a
// room or a venue. The link in it opens a page this app hosts itself
// (dbo.feedback_requests), not something the owner has to configure. Its
// own approval, separate from every other template here, same reasoning as
// the rest.
//
// Its two variables, in order, are built by feedbackRequest.js:
//   {{1}} name  {{2}} greet_message (an opening line that differs by
//   whether this is a stay or a function, then the ask and the feedback
//   link — composed server-side as one block. An earlier three-variable
//   version was rejected by WhatsApp's reviewers; one placeholder per line
//   of static text is what passed)
const FEEDBACK_TEMPLATE_ID = process.env.WHATSAPP_FEEDBACK_TEMPLATE_ID || '';
// The approved birthday-wishes template. Sent once per birthday by its own
// daily sweep (birthdayWishes.service.js) — keyed on dbo.customers'
// date_of_birth, which is entered by hand on a customer's profile and
// nowhere derived automatically. Its own approval, separate from every
// other template here, same reasoning as the rest.
//
// Its two variables, in order, are built by birthdayWishes.js:
//   {{1}} name  {{2}} hotel_name
const BIRTHDAY_TEMPLATE_ID = process.env.WHATSAPP_BIRTHDAY_TEMPLATE_ID || '';

// Indian numbers, in the shapes people actually type them: ten digits, ten with
// a leading zero, or already carrying the 91 country code. Anything else is
// returned as digits and left for the API to reject — guessing at a country code
// would be worse than failing.
function normalisePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return digits || null;
}

// 919876543210 -> +91 ******3210. Enough for the right person to recognise
// their own number and not enough for anyone else to learn it. Shared by
// every flow that sends a code and then has to tell the user where it went.
function maskPhone(normalised) {
  const digits = String(normalised);
  const last4 = digits.slice(-4);
  return `+${digits.slice(0, 2)} ${'*'.repeat(Math.max(0, digits.length - 6))}${last4}`;
}

function post(path, contentType, payload) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: API_HOST,
        path,
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          'Content-Length': Buffer.byteLength(payload),
        },
        // Without this a hung provider holds the request open until the client
        // gives up, and the user sees a spinner rather than "try again".
        timeout: 15000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ raw: data });
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('WhatsApp provider timed out.')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function postJson(path, body) {
  return post(path, 'application/json', JSON.stringify(body));
}

// SendMessage takes a form body, not JSON — the one place the provider's two
// endpoints differ, and the reason this is not one helper.
function postForm(path, body) {
  const payload = Object.entries(body)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return post(path, 'application/x-www-form-urlencoded', payload);
}

// Whether a code can be sent at all. Checked before the code is generated and
// stored, so a property with no provider configured gets a clear error instead
// of a code that exists in the database and was never delivered.
function isConfigured() {
  return Boolean(API_TOKEN) && !API_TOKEN.startsWith('REPLACE');
}

function isPlaceholder(value) {
  return !value || String(value).startsWith('REPLACE');
}

// Whether a booking confirmation can go out: the account token and the
// approved template, both. Checked by the notifier before it reads anything,
// so an unconfigured install pays nothing for the feature.
function isBookingTemplateConfigured() {
  return isConfigured() && !isPlaceholder(BOOKING_TEMPLATE_ID);
}

// The same question for the event booking confirmation template.
function isEventBookingTemplateConfigured() {
  return isConfigured() && !isPlaceholder(EVENT_BOOKING_TEMPLATE_ID);
}

// The same question for the bill template. Asked by the billing screen before
// it offers WhatsApp as a channel, so a property without the template sees the
// option greyed out with a reason rather than a send that fails at the desk
// after the guest has been told the bill is on its way.
function isBillTemplateConfigured() {
  return isConfigured() && !isPlaceholder(BILL_TEMPLATE_ID);
}

// The same question for the event bill template.
function isEventBillTemplateConfigured() {
  return isConfigured() && !isPlaceholder(EVENT_BILL_TEMPLATE_ID);
}

// The same question for the cancellation template. Asked by the cancellation
// notifier before it reads anything, so an unconfigured install pays nothing
// for the feature — same shape as the bill and booking checks above.
function isCancellationTemplateConfigured() {
  return isConfigured() && !isPlaceholder(CANCELLATION_TEMPLATE_ID);
}

// The same question for the event cancellation template.
function isEventCancellationTemplateConfigured() {
  return isConfigured() && !isPlaceholder(EVENT_CANCELLATION_TEMPLATE_ID);
}

// The same question for the receipt template. Asked by the advance-receipt
// screen before it offers WhatsApp as a channel, same shape as the bill check
// above.
function isReceiptTemplateConfigured() {
  return isConfigured() && !isPlaceholder(RECEIPT_TEMPLATE_ID);
}

// The same question for the check-in welcome template. Asked by the
// notifier before it reads anything, same shape as the cancellation check
// above.
function isCheckinTemplateConfigured() {
  return isConfigured() && !isPlaceholder(CHECKIN_TEMPLATE_ID);
}

// The same question for the stay-reminder template. Asked by the daily sweep
// before it even queries for bookings due a reminder, so an unconfigured
// install doesn't pay for a query whose answer it can't send anyway.
function isReminderTemplateConfigured() {
  return isConfigured() && !isPlaceholder(REMINDER_TEMPLATE_ID);
}

// The same question for the event-reminder template.
function isEventReminderTemplateConfigured() {
  return isConfigured() && !isPlaceholder(EVENT_REMINDER_TEMPLATE_ID);
}

// The same question for the event-reschedule template.
function isEventRescheduleTemplateConfigured() {
  return isConfigured() && !isPlaceholder(EVENT_RESCHEDULE_TEMPLATE_ID);
}

// The same question for the feedback-request template. Asked by the daily
// sweep before it even queries for checked-out bookings, so an unconfigured
// install doesn't pay for a query whose answer it can't send anyway.
function isFeedbackTemplateConfigured() {
  return isConfigured() && !isPlaceholder(FEEDBACK_TEMPLATE_ID);
}

// The same question for the birthday-wishes template. Asked by the daily
// sweep before it even queries for birthdays, so an unconfigured install
// doesn't pay for a query whose answer it can't send anyway.
function isBirthdayTemplateConfigured() {
  return isConfigured() && !isPlaceholder(BIRTHDAY_TEMPLATE_ID);
}

async function sendOtp(phone, otpCode) {
  if (!isConfigured()) {
    throw new Error('WhatsApp API token is not configured.');
  }
  const normPhone = normalisePhone(phone);
  if (!normPhone) throw new Error('Invalid phone number.');

  const result = await postJson('/whatsapp/SendOtp', {
    PhoneNumber: normPhone,
    OtpCode: String(otpCode),
    ApiToken: API_TOKEN,
    TemplateId: OTP_TEMPLATE_ID || undefined,
  });

  const success = result.IsSuccess || result.ErrorCode === 0;
  if (!success) {
    // The provider's own description, which is what distinguishes "number not on
    // WhatsApp" from "template not approved" — the two failures an operator has
    // to tell apart, and neither is guessable from a generic message.
    throw new Error(result.ErrorDescription || 'WhatsApp OTP send failed.');
  }

  logger.info({ phone: normPhone, campaignId: result.ReturnData }, 'WhatsApp OTP sent');
  return result;
}

// Sends an approved template with its variables filled in. `sample` is the
// provider's shape for the variables: the {{1}}..{{n}} values joined by commas,
// in order. A comma inside a value therefore shifts every variable after it,
// which is why the caller strips them (see bookingConfirmation.js).
//
// Throws on any failure — network, timeout, or the provider saying no — with
// the provider's own description where there is one, since "number not on
// WhatsApp" and "template not approved" call for different fixes. Whether a
// failure matters is the caller's decision: an OTP has to reach the phone, a
// booking confirmation is best-effort.
async function sendTemplateMessage(phone, templateId, sample, campaignName) {
  if (!isConfigured()) {
    throw new Error('WhatsApp API token is not configured.');
  }
  if (isPlaceholder(templateId)) {
    throw new Error(`WhatsApp template for "${campaignName}" is not configured.`);
  }
  const normPhone = normalisePhone(phone);
  if (!normPhone) throw new Error('Invalid phone number.');

  const result = await postForm('/whatsapp/SendMessage', {
    ApiToken: API_TOKEN,
    TemplateId: String(templateId),
    QuickNumber: normPhone,
    Sample: sample || '',
    CampaignName: campaignName || 'lodge',
  });

  const success = result.IsSuccess || result.ErrorCode === 0;
  if (!success) {
    throw new Error(result.ErrorDescription || `WhatsApp "${campaignName}" send failed.`);
  }

  logger.info({ phone: normPhone, campaignName, campaignId: result.ReturnData }, 'WhatsApp template sent');
  return { campaignId: result.ReturnData ?? null };
}

module.exports = {
  sendOtp,
  sendTemplateMessage,
  normalisePhone,
  maskPhone,
  isConfigured,
  isBookingTemplateConfigured,
  isEventBookingTemplateConfigured,
  isBillTemplateConfigured,
  isEventBillTemplateConfigured,
  isCancellationTemplateConfigured,
  isEventCancellationTemplateConfigured,
  isReceiptTemplateConfigured,
  isCheckinTemplateConfigured,
  isReminderTemplateConfigured,
  isEventReminderTemplateConfigured,
  isEventRescheduleTemplateConfigured,
  isFeedbackTemplateConfigured,
  isBirthdayTemplateConfigured,
  BOOKING_TEMPLATE_ID,
  EVENT_BOOKING_TEMPLATE_ID,
  BILL_TEMPLATE_ID,
  EVENT_BILL_TEMPLATE_ID,
  CANCELLATION_TEMPLATE_ID,
  EVENT_CANCELLATION_TEMPLATE_ID,
  RECEIPT_TEMPLATE_ID,
  CHECKIN_TEMPLATE_ID,
  REMINDER_TEMPLATE_ID,
  EVENT_REMINDER_TEMPLATE_ID,
  EVENT_RESCHEDULE_TEMPLATE_ID,
  FEEDBACK_TEMPLATE_ID,
  BIRTHDAY_TEMPLATE_ID,
};
