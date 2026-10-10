const crypto = require('crypto');
const { getPool, sql } = require('../../config/connection');
const { logger } = require('../../config/logger');
const whatsapp = require('../../config/whatsapp');
const { publicBaseUrl } = require('../../config/publicBaseUrl');
const feedbackRequest = require('../notifications/feedbackRequest');

// The sibling of stayReminders.service.js: a daily-cron's-worth-of-calendar-
// math job, except this one runs on an hour window rather than a calendar
// day, so it gets its own, more frequent, tick (see server.js).
//
// One ask per booking, ever — dbo.feedback_requests' own UNIQUE(booking_id)
// is the whole of the dedup; there's no separate "already asked" column on
// dbo.bookings to keep in sync with it, because inserting that row *is* the
// act of marking it asked. The row is written before the WhatsApp send is
// even attempted, for the same reason billShare.service.js writes its row
// before the send: a guest reaching the link has to always find a page that
// matches it, never a 404 because the write happened after a send that
// then failed.

// Same shape as orders.service.js's newPublicToken — 18 random bytes,
// base64url, long enough that guessing one is not a realistic attack and
// short enough to read back in a support conversation if it ever needs to.
function newFeedbackToken() {
  return crypto.randomBytes(18).toString('base64url');
}

// Every lodge is in India — see todayIsoIST in bookings.service.js for why
// IST matters elsewhere; this one works in absolute hours instead of
// calendar days, so no timezone shift is needed here at all.
const DELAY_HOURS = 4;
const MAX_AGE_DAYS = 3;

// Runs every two hours (see server.js). Never throws — one bad row or one
// provider outage must not stop the rest of the sweep, and there is no desk
// waiting on this the way there is for a cancellation.
async function sendDueFeedbackRequests() {
  // Checked before the query, not just before the send: publicBaseUrl()
  // would throw deep inside the per-row loop below otherwise, and this
  // function promises never to throw — same reasoning as the template check
  // right beside it.
  if (!whatsapp.isFeedbackTemplateConfigured() || !process.env.PUBLIC_BASE_URL?.trim()) {
    return { checked: 0, sent: 0, skipped: 0, failed: 0 };
  }

  const pool = await getPool();

  const result = await pool
    .request()
    .input('delayHours', sql.Int, DELAY_HOURS)
    .input('maxAgeDays', sql.Int, MAX_AGE_DAYS)
    .query(`
      SELECT b.id, b.lodge_id, b.guest_name, b.guest_phone,
             l.name AS lodge_name, l.phone AS lodge_phone, l.whatsapp_number AS lodge_whatsapp_number
      FROM dbo.bookings b
      JOIN dbo.lodges l ON l.id = b.lodge_id
      WHERE b.status = 'CHECKED_OUT'
        AND b.actual_check_out_at <= DATEADD(hour, -@delayHours, SYSDATETIMEOFFSET())
        AND b.actual_check_out_at >= DATEADD(day, -@maxAgeDays, SYSDATETIMEOFFSET())
        AND NOT EXISTS (SELECT 1 FROM dbo.feedback_requests fr WHERE fr.booking_id = b.id)
    `);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of result.recordset) {
    const token = newFeedbackToken();

    // Written before the send, not after — see the file comment above. The
    // WHERE EXISTS re-confirms row.lodge_id against dbo.bookings in the same
    // statement that writes it, rather than just trusting the join the
    // candidate SELECT above already did — belt-and-suspenders on tenant
    // isolation, same reasoning this codebase applies everywhere else (see
    // tenantIsolation.test.js). inserted stays 0, not an error, if it ever
    // disagreed.
    let inserted = 0;
    try {
      const result2 = await pool
        .request()
        .input('lodgeId', sql.BigInt, row.lodge_id)
        .input('bookingId', sql.BigInt, row.id)
        .input('token', sql.NVarChar(32), token)
        .query(`
          INSERT INTO dbo.feedback_requests (lodge_id, booking_id, token)
          SELECT @lodgeId, @bookingId, @token
          WHERE EXISTS (SELECT 1 FROM dbo.bookings WHERE id = @bookingId AND lodge_id = @lodgeId)
        `);
      inserted = result2.rowsAffected[0];
    } catch (err) {
      // UNIQUE(booking_id) racing a second sweep tick, or a token collision
      // (astronomically unlikely at 18 random bytes) — either way, not this
      // booking's problem to report as a send failure.
      logger.warn({ bookingId: row.id, lodgeId: row.lodge_id, err }, 'Could not record a feedback request');
      failed += 1;
      continue;
    }
    if (inserted === 0) {
      // The WHERE EXISTS came back empty — row.lodge_id didn't match
      // dbo.bookings after all. Should never happen given the candidate
      // query joins the same two tables; not sending is the safe failure.
      logger.warn({ bookingId: row.id, lodgeId: row.lodge_id }, 'Booking/lodge mismatch — feedback request not recorded');
      failed += 1;
      continue;
    }

    const booking = { id: row.id, guestName: row.guest_name, guestPhone: row.guest_phone };
    const lodge = { name: row.lodge_name, phone: row.lodge_phone, whatsappNumber: row.lodge_whatsapp_number };
    const link = `${publicBaseUrl()}/public/feedback/${token}`;

    const outcome = await feedbackRequest.notifyFeedbackRequest(row.lodge_id, booking, lodge, link);
    if (outcome.status === 'sent') sent += 1;
    else if (outcome.status === 'failed') failed += 1;
    else skipped += 1;
  }

  logger.info({ checked: result.recordset.length, sent, skipped, failed }, 'Feedback request sweep finished');
  return { checked: result.recordset.length, sent, skipped, failed };
}

module.exports = {
  sendDueFeedbackRequests,
  newFeedbackToken,
};
