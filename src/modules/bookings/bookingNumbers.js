const { sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');

// Reference numbers for stays and functions.
//
//   Stay (booking):  <HOTEL><YY><MM><SEQ>      e.g. SKR2610001
//   Function (event): E-<HOTEL><YY><MM><SEQ>   e.g. E-SKR2610001
//
//   HOTEL  dbo.lodges.booking_code — 3-4 LETTERS, unique across the platform.
//          Letters only on purpose: the digits that follow start where the
//          letters end, so a number reads back unambiguously as (hotel, month,
//          sequence) and two hotels can never produce the same string.
//   YYMM   the month it was CREATED, Indian time (not the check-in or function
//          date: creation never changes, so a number can't go stale when the
//          date is moved).
//   SEQ    that hotel's running number for that month, zero-padded to 3 digits.
//          It restarts at 001 every month, and simply grows to 4 digits past
//          999 rather than wrapping.
//
// Stays and functions each count on their own (booking_sequences vs
// event_sequences), so a hotel's bookings run 001, 002, 003 with no gaps where
// a function took a number. Because the counters are separate, a function
// carries an "E-" in front: a dash never appears in a stay's number, so the two
// kinds can never collide even if one hotel's code happens to start with E.
//
// Allocated inside the caller's transaction, so a record that rolls back gives
// its number back instead of leaving a gap, and written once on the row —
// never recalculated, so a later change to a hotel's code leaves issued numbers
// alone.

const CODE_RE = /^[A-Z]{3,4}$/;

// Table names come from this map, never from the caller, so interpolating them
// into the statement below is safe.
const KINDS = {
  booking: { table: 'dbo.booking_sequences', prefix: '' },
  event: { table: 'dbo.event_sequences', prefix: 'E-' },
};

// By the IST calendar date, not the server's UTC date — the same reasoning as
// todayIsoIST in bookings.service.js.
function istDateIso(now = Date.now()) {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// The counter row for a month is keyed on its first day, so a (lodge_id,
// seq_date DATE) table serves a monthly sequence without a new shape.
function monthStartIso(isoDate) {
  return `${isoDate.slice(0, 7)}-01`;
}

function formatNumber(kind, code, isoDate, sequence) {
  const yy = isoDate.slice(2, 4);
  const mm = isoDate.slice(5, 7);
  const seq = sequence < 1000 ? String(sequence).padStart(3, '0') : String(sequence);
  return `${KINDS[kind].prefix}${code}${yy}${mm}${seq}`;
}

async function allocateNumber(kind, transaction, lodgeId, { now } = {}) {
  const lodge = await new sql.Request(transaction)
    .input('lodgeId', sql.BigInt, lodgeId)
    .query('SELECT booking_code FROM dbo.lodges WHERE id = @lodgeId');
  const code = lodge.recordset[0]?.booking_code;
  if (!code || !CODE_RE.test(code)) {
    throw new ApiError(
      'This property has no booking code yet. Ask Vengurla Tech to set one before taking bookings.',
      409
    );
  }

  const isoDate = istDateIso(now);

  // Take the next number for (hotel, month) in one statement. UPDLOCK + HOLDLOCK
  // makes a second record for the same hotel and month wait for this one rather
  // than read the same counter — two shared range locks would instead deadlock
  // when both then tried to write. The first record of a month finds no row and
  // inserts it at 2, having taken 1.
  const { table } = KINDS[kind];
  const result = await new sql.Request(transaction)
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('seqDate', sql.Date, monthStartIso(isoDate))
    .query(`
      DECLARE @n INT;
      UPDATE ${table} WITH (UPDLOCK, HOLDLOCK)
      SET @n = next_number, next_number = next_number + 1
      WHERE lodge_id = @lodgeId AND seq_date = @seqDate;
      IF @@ROWCOUNT = 0
      BEGIN
        INSERT INTO ${table} (lodge_id, seq_date, next_number) VALUES (@lodgeId, @seqDate, 2);
        SET @n = 1;
      END;
      SELECT @n AS n;
    `);

  return formatNumber(kind, code, isoDate, result.recordset[0].n);
}

const allocateBookingNumber = (transaction, lodgeId, opts) => allocateNumber('booking', transaction, lodgeId, opts);
const allocateEventNumber = (transaction, lodgeId, opts) => allocateNumber('event', transaction, lodgeId, opts);

module.exports = {
  allocateBookingNumber,
  allocateEventNumber,
  formatNumber,
  istDateIso,
  monthStartIso,
  CODE_RE,
};
