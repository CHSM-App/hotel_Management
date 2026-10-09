const { getPool, sql } = require('../../config/connection');
const { logger } = require('../../config/logger');
const whatsapp = require('../../config/whatsapp');
const birthdayWishes = require('../notifications/birthdayWishes');

// The daily sweep behind birthday wishes — same shape as
// stayReminders.service.js/feedbackRequests.service.js: a cross-lodge query,
// a per-row best-effort send, and a dedup write that happens regardless of
// whether the send succeeded.
//
// One wish per birthday, per customer, ever-recurring: last_birthday_wished_at
// only has to disagree with the *current year* to be eligible again, so the
// same customer is wished again next year without any special-casing.
//
// Every lodge is in India — see todayIsoIST in bookings.service.js for why
// this goes by the IST calendar date rather than the server's UTC one.
function todayIsoIST() {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// Runs once a day (see server.js). Never throws — one bad row or one
// provider outage must not stop the rest of the sweep, and there is no desk
// waiting on this the way there is for a cancellation.
async function sendDueBirthdayWishes() {
  if (!whatsapp.isBirthdayTemplateConfigured()) {
    return { checked: 0, sent: 0, skipped: 0, failed: 0 };
  }

  const pool = await getPool();
  const [year, month, day] = todayIsoIST().split('-').map(Number);

  const result = await pool
    .request()
    .input('month', sql.Int, month)
    .input('day', sql.Int, day)
    .input('year', sql.Int, year)
    .query(`
      SELECT c.id, c.lodge_id, c.name, c.phone, l.name AS lodge_name
      FROM dbo.customers c
      JOIN dbo.lodges l ON l.id = c.lodge_id
      WHERE c.date_of_birth IS NOT NULL
        AND MONTH(c.date_of_birth) = @month AND DAY(c.date_of_birth) = @day
        AND (c.last_birthday_wished_at IS NULL OR YEAR(c.last_birthday_wished_at) < @year)
    `);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of result.recordset) {
    const customer = { id: row.id, name: row.name, phone: row.phone };
    const lodge = { name: row.lodge_name };

    const outcome = await birthdayWishes.notifyBirthday(row.lodge_id, customer, lodge);
    if (outcome.status === 'sent') sent += 1;
    else if (outcome.status === 'failed') failed += 1;
    else skipped += 1;

    // Marked regardless of outcome — same reasoning as the other sweeps: a
    // failed send or a skip (no phone on file) won't succeed by retrying
    // later today, and "sent" obviously shouldn't repeat until next year.
    await pool
      .request()
      .input('id', sql.BigInt, row.id)
      .input('lodgeId', sql.BigInt, row.lodge_id)
      .query('UPDATE dbo.customers SET last_birthday_wished_at = SYSDATETIMEOFFSET() WHERE id = @id AND lodge_id = @lodgeId');
  }

  logger.info({ checked: result.recordset.length, sent, skipped, failed }, 'Birthday wishes sweep finished');
  return { checked: result.recordset.length, sent, skipped, failed };
}

module.exports = {
  sendDueBirthdayWishes,
};
