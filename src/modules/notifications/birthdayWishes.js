const { logger } = require('../../config/logger');
const whatsapp = require('../../config/whatsapp');

// The WhatsApp birthday wish a customer gets, once a year, if their date of
// birth is on file.
//
// The template's two variables, in order:
//
//   {{1}} name  {{2}} hotel_name
//
// "Hi {{1}}, Wishing you a very happy birthday from all of us at {{2}}!
//  We feel lucky to have had you stay with us, and we hope this year brings
//  you joy, good health, and many more reasons to celebrate. We'd love to
//  welcome you back for another wonderful stay."
//
// Best-effort, by design — same reasoning as the other notifiers. The sweep
// that calls this marks the customer wished for this calendar year
// regardless of whether the send actually succeeded (see
// birthdayWishes.service.js), so a provider outage costs that one wish
// rather than retrying every day for the rest of the year.

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

// The two template values, in template order. Pure, so it can be checked
// without a database; customer is customers.service.js's mapped shape
// (camelCase), lodge the row birthdayWishes.service.js's own loadLodge
// hands over.
function buildBirthdaySample(customer, lodge) {
  return [clean(customer.name), clean(lodge.name)];
}

// Fires the wish and reports how it went, never throwing — one customer's
// failed send must not stop the sweep from reaching the rest.
async function notifyBirthday(lodgeId, customer, lodge) {
  if (!whatsapp.isBirthdayTemplateConfigured()) return { status: 'skipped', reason: 'not configured' };
  if (!customer.phone) return { status: 'skipped', reason: 'no customer phone' };
  try {
    const sample = buildBirthdaySample(customer, lodge);
    const { campaignId } = await whatsapp.sendTemplateMessage(
      customer.phone,
      whatsapp.BIRTHDAY_TEMPLATE_ID,
      sample.join(','),
      'birthday_wishes'
    );
    logger.info({ customerId: customer.id, lodgeId, campaignId }, 'Birthday wish sent on WhatsApp');
    return { status: 'sent', campaignId };
  } catch (err) {
    logger.warn({ customerId: customer.id, lodgeId, err }, 'Birthday wish could not be sent on WhatsApp');
    return { status: 'failed', error: err.message };
  }
}

module.exports = {
  notifyBirthday,
  buildBirthdaySample,
  clean,
};
