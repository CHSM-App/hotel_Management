const https = require('https');
const { logger } = require('./logger');

// WhatsApp delivery through SMSala (https://api2.smsala.com).
//
// Ported from the college-admission backend's services/whatsapp.js. Two things
// go out over it: the numeric code behind a password change (sendOtp) and the
// approved booking-confirmation template a guest gets when their stay or
// function is written down (sendTemplateMessage, driven from
// src/modules/notifications/bookingConfirmation.js). The college backend also
// mirrors every send into a whatsapp_message_log table; that does not exist
// here, so sends are recorded in the normal application log instead of a table
// nobody would read.
//
// The OTP code itself is never logged. It is the secret the whole flow rests on,
// and a log line carrying it would undo the point of hashing it in the database.

const API_HOST = 'api2.smsala.com';
const API_TOKEN = process.env.WHATSAPP_API_TOKEN || '';
const OTP_TEMPLATE_ID = process.env.WHATSAPP_OTP_TEMPLATE_ID || '';
// The approved "your booking is confirmed" template. Left blank, no
// confirmation goes out and nothing else changes — the switch for a property
// that has not had the template approved yet.
const BOOKING_TEMPLATE_ID = process.env.WHATSAPP_BOOKING_TEMPLATE_ID || '';

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
  isConfigured,
  isBookingTemplateConfigured,
  BOOKING_TEMPLATE_ID,
};
