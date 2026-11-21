const { getPool, sql } = require('../../config/connection');
const { logger } = require('../../config/logger');
const whatsapp = require('../../config/whatsapp');
const eventReminder = require('../notifications/eventReminder');

// The daily sweep behind the "your event is coming up" WhatsApp reminder.
//
// Unlike stayReminders.service.js, there is only one moment here: the sweep
// fires exactly one day before the event, for every function confirmed to
// hold its venue. A DRAFT or CANCELLED function never took the venue in the
// first place, so it gets no reminder — same BLOCKING idea events.service.js
// already uses for the confirmation notice.
//
// Every lodge is in India — see todayIsoIST in bookings.service.js for why
// this goes by the IST calendar date rather than the server's UTC one.
function todayIsoIST() {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// A DATETIMEOFFSET's own calendar day, in IST — same shift eventReminder.js's
// eventDate uses, so "due tomorrow" here means the same day it will later
// print in the message.
function istDateOnly(value) {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(new Date(value).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// Runs once a day (see server.js for the cron trigger). Never throws — one
// bad row or one provider outage must not stop the rest of the sweep, and
// there is no desk waiting on this the way there is for a cancellation.
async function sendDueEventReminders() {
  if (!whatsapp.isEventReminderTemplateConfigured()) {
    return { checked: 0, sent: 0, skipped: 0, failed: 0 };
  }

  const pool = await getPool();
  const tomorrow = addDays(todayIsoIST(), 1);

  // A day-wide window in DATETIMEOFFSET rather than a CAST on start_at, so
  // the index on (lodge_id, status, start_at) stays usable.
  const result = await pool
    .request()
    .input('from', sql.DateTimeOffset, `${tomorrow}T00:00:00+05:30`)
    .input('to', sql.DateTimeOffset, `${tomorrow}T23:59:59.999+05:30`)
    .query(`
      SELECT e.id, e.lodge_id, e.organiser_name, e.organiser_phone, e.start_at,
             v.name AS venue_name,
             l.name AS lodge_name, l.phone AS lodge_phone, l.whatsapp_number AS lodge_whatsapp_number
      FROM dbo.event_bookings e
      JOIN dbo.event_venues v ON v.id = e.venue_id
      JOIN dbo.lodges l ON l.id = e.lodge_id
      WHERE e.status = 'CONFIRMED' AND e.reminder_sent_at IS NULL
        AND e.start_at >= @from AND e.start_at <= @to
    `);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of result.recordset) {
    // The window above is a DATETIMEOFFSET range on the server's own clock;
    // this is the actual check that the event's IST calendar day is tomorrow,
    // the same guard stayReminders.service.js's dueToday makes against its
    // own two-date window.
    if (istDateOnly(row.start_at) !== tomorrow) continue;

    const event = {
      id: row.id,
      organiserName: row.organiser_name,
      organiserPhone: row.organiser_phone,
      startAt: row.start_at,
      venueName: row.venue_name,
    };
    const lodge = { name: row.lodge_name, phone: row.lodge_phone, whatsappNumber: row.lodge_whatsapp_number };

    const outcome = await eventReminder.notifyUpcomingEvent(row.lodge_id, event, lodge);
    if (outcome.status === 'sent') sent += 1;
    else if (outcome.status === 'failed') failed += 1;
    else skipped += 1;

    // Marked regardless of outcome — a failed send and a skipped one (no
    // phone on file) are both never going to succeed by trying again
    // tomorrow with the same data, and "sent" obviously shouldn't repeat.
    await pool
      .request()
      .input('id', sql.BigInt, row.id)
      .input('lodgeId', sql.BigInt, row.lodge_id)
      .query('UPDATE dbo.event_bookings SET reminder_sent_at = SYSDATETIMEOFFSET() WHERE id = @id AND lodge_id = @lodgeId');
  }

  logger.info({ checked: result.recordset.length, sent, skipped, failed }, 'Event reminder sweep finished');
  return { checked: result.recordset.length, sent, skipped, failed };
}

module.exports = {
  sendDueEventReminders,
};
