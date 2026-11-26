const { getPool, sql } = require('../../config/connection');
const { logger } = require('../../config/logger');
const whatsapp = require('../../config/whatsapp');
const stayReminder = require('../notifications/stayReminder');

// The daily sweep behind the "your stay is coming up" WhatsApp reminder.
//
// One reminder per booking, never two — which of the two moments it gets
// depends on how far ahead of the stay it was actually booked:
//
//   booked more than 3 days before check-in  -> reminder 3 days before
//   booked 3 days or fewer before check-in    -> reminder the day before
//
// A booking made two days out could never truthfully get a "3 days away"
// notice in the first place — that moment had already passed before the
// booking existed — so the day-before reminder is the only one that could
// ever fire for it. A booking made weeks out gets only the 3-day one, by
// the same choice the feature was asked for: not both.
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

function toIsoDate(value) {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  return Math.round((new Date(`${toIso}T00:00:00Z`) - new Date(`${fromIso}T00:00:00Z`)) / 86400000);
}

// Pure, so the lead-time rule can be checked without a database. createdAt
// is whatever dbo.bookings.created_at comes back as (a Date, with a time
// component the calendar-day lead time doesn't care about); checkInDate is
// the plain DATE column.
function reminderKind(createdAt, checkInDate) {
  const leadDays = daysBetween(toIsoDate(createdAt), toIsoDate(checkInDate));
  return leadDays > 3 ? 'THREE_DAY' : 'ONE_DAY';
}

// Runs once a day (see server.js for the cron trigger). Never throws — one
// bad row or one provider outage must not stop the rest of the sweep, and
// there is no desk waiting on this the way there is for a cancellation.
async function sendDueStayReminders() {
  if (!whatsapp.isReminderTemplateConfigured()) {
    return { checked: 0, sent: 0, skipped: 0, failed: 0 };
  }

  const pool = await getPool();
  const today = todayIsoIST();
  const threeDayDate = addDays(today, 3);
  const oneDayDate = addDays(today, 1);

  // Both candidate dates in one query — check_in_date can only be one or the
  // other for a row to be worth looking at today at all. Which of the two
  // actually applies (and so whether a given row is sent) is decided in JS
  // below, by reminderKind, not by which date it matched here.
  const result = await pool
    .request()
    .input('threeDayDate', sql.Date, threeDayDate)
    .input('oneDayDate', sql.Date, oneDayDate)
    .query(`
      SELECT b.id, b.lodge_id, b.guest_name, b.guest_phone, b.check_in_date, b.check_out_date, b.created_at,
             l.name AS lodge_name, l.phone AS lodge_phone, l.whatsapp_number AS lodge_whatsapp_number,
             (
               SELECT STRING_AGG(r.room_number, ', ') FROM dbo.booking_rooms br
               JOIN dbo.rooms r ON r.id = br.room_id
               WHERE br.booking_id = b.id AND br.status <> 'CANCELLED'
             ) AS room_numbers
      FROM dbo.bookings b
      JOIN dbo.lodges l ON l.id = b.lodge_id
      WHERE b.status = 'BOOKED' AND b.reminder_sent_at IS NULL
        AND b.check_in_date IN (@threeDayDate, @oneDayDate)
    `);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of result.recordset) {
    const checkInIso = toIsoDate(row.check_in_date);
    const kind = reminderKind(row.created_at, checkInIso);
    // The row matched one of the two dates in the WHERE clause, but only
    // because both were fetched in one query — this is the actual check
    // for whether *today* is the day this particular booking's rule says
    // to fire on.
    const dueToday = (kind === 'THREE_DAY' && checkInIso === threeDayDate) || (kind === 'ONE_DAY' && checkInIso === oneDayDate);
    if (!dueToday) continue;

    const booking = {
      id: row.id,
      guestName: row.guest_name,
      guestPhone: row.guest_phone,
      checkInDate: row.check_in_date,
      checkOutDate: row.check_out_date,
      roomNumbers: row.room_numbers || '-',
    };
    const lodge = { name: row.lodge_name, phone: row.lodge_phone, whatsappNumber: row.lodge_whatsapp_number };

    const result2 = await stayReminder.notifyUpcomingStay(row.lodge_id, booking, lodge, kind);
    if (result2.status === 'sent') sent += 1;
    else if (result2.status === 'failed') failed += 1;
    else skipped += 1;

    // Marked regardless of outcome — a failed send and a skipped one (no
    // phone on file) are both never going to succeed by trying again
    // tomorrow with the same data, and "sent" obviously shouldn't repeat.
    // lodge_id is redundant with id here (every row already came from a
    // lodge-joined SELECT), but every write in this codebase carries it
    // anyway — see tenantIsolation.test.js.
    await pool
      .request()
      .input('id', sql.BigInt, row.id)
      .input('lodgeId', sql.BigInt, row.lodge_id)
      .query('UPDATE dbo.bookings SET reminder_sent_at = SYSDATETIMEOFFSET() WHERE id = @id AND lodge_id = @lodgeId');
  }

  logger.info({ checked: result.recordset.length, sent, skipped, failed }, 'Stay reminder sweep finished');
  return { checked: result.recordset.length, sent, skipped, failed };
}

module.exports = {
  sendDueStayReminders,
  reminderKind,
};
