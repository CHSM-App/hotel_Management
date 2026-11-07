const crypto = require('crypto');
const { getPool, sql } = require('../../config/connection');
const { logger } = require('../../config/logger');
const whatsapp = require('../../config/whatsapp');
const { publicBaseUrl } = require('../../config/publicBaseUrl');
const feedbackRequest = require('../notifications/feedbackRequest');

// The event side of feedbackRequests.service.js — same sweep shape, same
// delay, same dedup idea, fired off a function's completed_at instead of a
// stay's actual_check_out_at. Reuses the same approved template as the stay
// sweep via notifications/feedbackRequest.js, passing 'event' as the `kind`
// so the one sentence that actually differs (the opening line) reads right
// for an organiser rather than a guest — see OPENING_LINE in that file.
//
// One ask per function, ever — dbo.feedback_requests' own filtered unique
// index on event_booking_id (see migration 141) is the whole of the dedup,
// the same way booking_id already was for a stay. The row is written before
// the WhatsApp send is even attempted, for the same reason the stay sweep
// does: an organiser reaching the link has to always find a page that
// matches it, never a 404 because the write happened after a send that then
// failed.

// Same shape as feedbackRequests.service.js's own newFeedbackToken.
function newFeedbackToken() {
  return crypto.randomBytes(18).toString('base64url');
}

// Same cadence as the stay sweep — nothing about an event asks for a
// different delay or a different cutoff, so there is no reason to invent one.
const DELAY_HOURS = 4;
const MAX_AGE_DAYS = 3;

// Runs every two hours (see server.js), alongside the stay sweep. Never
// throws — one bad row or one provider outage must not stop the rest of the
// sweep, and there is no desk waiting on this the way there is for a
// cancellation.
async function sendDueEventFeedbackRequests() {
  // Checked before the query, not just before the send — same reasoning as
  // feedbackRequests.service.js's own early return.
  if (!whatsapp.isFeedbackTemplateConfigured() || !process.env.PUBLIC_BASE_URL?.trim()) {
    return { checked: 0, sent: 0, skipped: 0, failed: 0 };
  }

  const pool = await getPool();

  const result = await pool
    .request()
    .input('delayHours', sql.Int, DELAY_HOURS)
    .input('maxAgeDays', sql.Int, MAX_AGE_DAYS)
    .query(`
      SELECT e.id, e.lodge_id, e.organiser_name, e.organiser_phone,
             l.name AS lodge_name, l.phone AS lodge_phone, l.whatsapp_number AS lodge_whatsapp_number
      FROM dbo.event_bookings e
      JOIN dbo.lodges l ON l.id = e.lodge_id
      WHERE e.completed_at IS NOT NULL
        AND e.completed_at <= DATEADD(hour, -@delayHours, SYSDATETIMEOFFSET())
        AND e.completed_at >= DATEADD(day, -@maxAgeDays, SYSDATETIMEOFFSET())
        AND NOT EXISTS (SELECT 1 FROM dbo.feedback_requests fr WHERE fr.event_booking_id = e.id)
    `);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of result.recordset) {
    const token = newFeedbackToken();

    // Written before the send, not after — see the file comment above. The
    // WHERE EXISTS re-confirms row.lodge_id against dbo.event_bookings in the
    // same statement that writes it, same belt-and-suspenders tenant-isolation
    // reasoning the stay sweep applies.
    let inserted = 0;
    try {
      const result2 = await pool
        .request()
        .input('lodgeId', sql.BigInt, row.lodge_id)
        .input('eventBookingId', sql.BigInt, row.id)
        .input('token', sql.NVarChar(32), token)
        .query(`
          INSERT INTO dbo.feedback_requests (lodge_id, event_booking_id, token)
          SELECT @lodgeId, @eventBookingId, @token
          WHERE EXISTS (SELECT 1 FROM dbo.event_bookings WHERE id = @eventBookingId AND lodge_id = @lodgeId)
        `);
      inserted = result2.rowsAffected[0];
    } catch (err) {
      // UNIQUE(event_booking_id) racing a second sweep tick, or a token
      // collision (astronomically unlikely at 18 random bytes) — either way,
      // not this function's problem to report as a send failure.
      logger.warn({ eventId: row.id, lodgeId: row.lodge_id, err }, 'Could not record an event feedback request');
      failed += 1;
      continue;
    }
    if (inserted === 0) {
      logger.warn({ eventId: row.id, lodgeId: row.lodge_id }, 'Event/lodge mismatch — feedback request not recorded');
      failed += 1;
      continue;
    }

    // Same shape notifyFeedbackRequest already expects from a stay's booking
    // — id/guestName/guestPhone — so the notifier needs no change of its own
    // to serve an organiser instead of a guest.
    const booking = { id: row.id, guestName: row.organiser_name, guestPhone: row.organiser_phone };
    const lodge = { name: row.lodge_name, phone: row.lodge_phone, whatsappNumber: row.lodge_whatsapp_number };
    const link = `${publicBaseUrl()}/feedback/${token}`;

    const outcome = await feedbackRequest.notifyFeedbackRequest(row.lodge_id, booking, lodge, link, 'event');
    if (outcome.status === 'sent') sent += 1;
    else if (outcome.status === 'failed') failed += 1;
    else skipped += 1;
  }

  logger.info({ checked: result.recordset.length, sent, skipped, failed }, 'Event feedback request sweep finished');
  return { checked: result.recordset.length, sent, skipped, failed };
}

module.exports = {
  sendDueEventFeedbackRequests,
  newFeedbackToken,
};
