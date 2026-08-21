const https = require('https');
const { logger } = require('./logger');

// WhatsApp OTP delivery through SMSala (https://api2.smsala.com).
//
// Ported from the college-admission backend's services/whatsapp.js, reduced to
// the one thing this app needs: sending a numeric code. That backend also sends
// templated status messages and mirrors every send into a whatsapp_message_log
// table; neither exists here, so sends are recorded in the normal application
// log instead of a table nobody would read.
//
// The OTP code itself is never logged. It is the secret the whole flow rests on,
// and a log line carrying it would undo the point of hashing it in the database.

const API_HOST = 'api2.smsala.com';
const API_TOKEN = process.env.WHATSAPP_API_TOKEN || '';
const OTP_TEMPLATE_ID = process.env.WHATSAPP_OTP_TEMPLATE_ID || '';

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

function postJson(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: API_HOST,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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

// Whether a code can be sent at all. Checked before the code is generated and
// stored, so a property with no provider configured gets a clear error instead
// of a code that exists in the database and was never delivered.
function isConfigured() {
  return Boolean(API_TOKEN) && !API_TOKEN.startsWith('REPLACE');
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

module.exports = { sendOtp, normalisePhone, isConfigured };
