const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');

// The document serials the property prints on its bills.
//
// Two series are settable, matching the two documents a guest is handed:
//
//   FINAL    the bill at checkout — a tax invoice at a GST-registered lodge,
//            a bill of supply at one that is not
//   ADVANCE  the receipt for money taken at booking
//
// They are deliberately separate runs. An advance taken today and a bill cut
// next week must not interleave in one sequence, or the tax-invoice numbering
// develops gaps that an auditor will ask about.
//
// The GST/non-GST split below is invisible to the owner on purpose: whether a
// lodge is registered is decided once at onboarding and stored on the lodge, so
// only one of the two rows is ever used. Presenting both would be offering a
// choice that has already been made.

const FINAL = 'FINAL';
const ADVANCE = 'ADVANCE';

// SQL Server INT. next_number is an INT column, so a serial set near the top of
// the range would overflow on the next allocation rather than on being saved.
const MAX_SERIAL = 2147483647;

async function getLodgeBillingSide(pool, lodgeId) {
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query('SELECT is_gst_registered FROM dbo.lodges WHERE id = @lodgeId');
  if (result.recordset.length === 0) {
    throw new ApiError('Lodge not found.', 404);
  }
  return result.recordset[0].is_gst_registered ? 'GST' : 'NON_GST';
}

// Maps the owner-facing name onto the row actually used to allocate.
async function resolveSeriesType(pool, lodgeId, series) {
  if (series === ADVANCE) return 'ADVANCE';
  if (series === FINAL) return getLodgeBillingSide(pool, lodgeId);
  throw new ApiError('Unknown document series.', 400);
}

// What this lodge has already printed.
//
// Two separate facts, because they answer different questions and a property
// mid-migration can have one without the other:
//
//   count    how many documents exist at all
//   highest  the largest PLAIN-INTEGER number among them
//
// TRY_CAST returns NULL for the legacy prefixed numbers ("INV-40"), so those
// raise the count but not the floor. That is correct for collision purposes —
// "INV-40" and "40" are different strings and cannot clash — but it means a
// zero highest does NOT mean nothing was ever billed. Reporting only the floor
// would tell a property holding forty bills that it had issued none.
async function issuedSummary(pool, lodgeId, series) {
  const table = series === ADVANCE ? 'dbo.advance_receipts' : 'dbo.invoices';
  const column = series === ADVANCE ? 'receipt_number' : 'invoice_number';

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT COUNT(*) AS issued_count,
             MAX(TRY_CAST(${column} AS INT)) AS highest
      FROM ${table}
      WHERE lodge_id = @lodgeId
    `);

  const row = result.recordset[0];
  return { count: row.issued_count || 0, highest: row.highest || 0 };
}

// Reads a series, creating its row on first look so the owner can choose a
// starting serial before the first bill rather than after it.
async function readSeries(pool, lodgeId, series) {
  const seriesType = await resolveSeriesType(pool, lodgeId, series);

  const existing = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('seriesType', sql.NVarChar, seriesType)
    .query('SELECT prefix, next_number FROM dbo.invoice_series WHERE lodge_id = @lodgeId AND series_type = @seriesType');

  let row = existing.recordset[0];
  if (!row) {
    await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('seriesType', sql.NVarChar, seriesType)
      .query(`
        INSERT INTO dbo.invoice_series (lodge_id, series_type, prefix, next_number)
        VALUES (@lodgeId, @seriesType, N'', 1)
      `);
    row = { prefix: '', next_number: 1 };
  }

  const issued = await issuedSummary(pool, lodgeId, series);

  return {
    series,
    nextNumber: row.next_number,
    // Empty for every lodge from this release on. Still returned so a property
    // that set one before the change can see what is on its bills.
    prefix: row.prefix || '',
    // What the next bill will actually read, so the owner is choosing against
    // the thing they will see rather than against a field name.
    nextDocumentNumber: `${row.prefix || ''}${row.next_number}`,
    // The largest plain number already printed. Zero at a property whose
    // history is entirely under the old prefixed scheme.
    highestIssued: issued.highest,
    // How many documents exist regardless of how they were numbered, so the
    // screen can tell "never billed" apart from "billed under the old prefix".
    issuedCount: issued.count,
    // Below this and the next document would reuse a number already printed.
    minimumAllowed: issued.highest + 1,
  };
}

async function listSeries(lodgeId) {
  const pool = await getPool();
  return {
    final: await readSeries(pool, lodgeId, FINAL),
    advance: await readSeries(pool, lodgeId, ADVANCE),
  };
}

// Sets where the series continues from.
//
// The one rule enforced here is that it cannot go back over ground already
// covered. Reusing a serial means two tax documents with the same number, which
// the unique index added in migration 038 would reject anyway — but as a
// constraint violation at checkout, in front of a waiting guest, rather than as
// a clear message on the settings screen where the mistake is being made.
async function updateSeries(lodgeId, series, nextNumber) {
  const pool = await getPool();
  const seriesType = await resolveSeriesType(pool, lodgeId, series);

  if (!Number.isInteger(nextNumber) || nextNumber < 1) {
    throw new ApiError('The starting number must be a whole number of 1 or more.', 400, 'nextNumber');
  }
  if (nextNumber > MAX_SERIAL) {
    throw new ApiError('That starting number is too large.', 400, 'nextNumber');
  }

  const { highest: issued } = await issuedSummary(pool, lodgeId, series);
  if (nextNumber <= issued) {
    const label = series === ADVANCE ? 'advance receipt' : 'bill';
    throw new ApiError(
      `This property has already issued ${label} number ${issued}. ` +
        `Start from ${issued + 1} or higher so no number is used twice.`,
      409,
      'nextNumber'
    );
  }

  // The floor is re-derived inside the write rather than trusted from the read
  // above: between the two, a colleague at another desk may have issued a bill
  // and taken the number this one is about to be set to. Doing it as one
  // statement makes the check and the write atomic without a transaction.
  //
  // The table and column are chosen from the series constant, never from
  // caller input — they are identifiers and so cannot be parameterised.
  const table = series === ADVANCE ? 'dbo.advance_receipts' : 'dbo.invoices';
  const column = series === ADVANCE ? 'receipt_number' : 'invoice_number';

  const updated = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('seriesType', sql.NVarChar, seriesType)
    .input('nextNumber', sql.Int, nextNumber)
    .query(`
      UPDATE s
      SET next_number = @nextNumber
      OUTPUT inserted.next_number
      FROM dbo.invoice_series s
      WHERE s.lodge_id = @lodgeId AND s.series_type = @seriesType
        AND @nextNumber > ISNULL((
          SELECT MAX(TRY_CAST(${column} AS INT))
          FROM ${table}
          WHERE lodge_id = @lodgeId
        ), 0)
    `);

  if (updated.recordset.length === 0) {
    throw new ApiError(
      'A document was issued while you were editing, so this number is no longer free. Reopen the settings and try again.',
      409,
      'nextNumber'
    );
  }

  return readSeries(pool, lodgeId, series);
}

module.exports = { listSeries, updateSeries, FINAL, ADVANCE };
