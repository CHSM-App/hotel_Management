// Per-lodge switches that live in dbo.lodge_settings (one row per lodge). The
// older flags (has_rooms, can_edit_billed_stays, ...) stay on dbo.lodges.
//
// Reading costs no extra round trip: add SETTINGS_COLS to the SELECT and
// SETTINGS_JOIN to the FROM of a lodge query that already runs, aliased `l`.
// A lodge with no settings row still gets the defaults (ISNULL below).
const { getPool, sql } = require('./connection');

// Column -> default. The defaults equal how the app behaved before the table
// existed, so an untouched lodge behaves exactly as before.
const SETTING_DEFAULTS = {
  wa_auto_bill: 1,
  wa_auto_receipt: 0,
  wa_auto_booking: 1,
  wa_auto_walkin: 1,
  wa_auto_cancel: 1,
};

// API (camelCase) name -> column. The whitelist for anything written.
const SETTING_FIELDS = {
  waAutoBill: 'wa_auto_bill',
  waAutoReceipt: 'wa_auto_receipt',
  waAutoBooking: 'wa_auto_booking',
  waAutoWalkin: 'wa_auto_walkin',
  waAutoCancel: 'wa_auto_cancel',
};

const SETTINGS_JOIN = 'LEFT JOIN dbo.lodge_settings ls ON ls.lodge_id = l.id';
const SETTINGS_COLS = Object.entries(SETTING_DEFAULTS)
  .map(([col, d]) => `ISNULL(ls.${col}, ${d}) AS ${col}`)
  .join(', ');

// A flag off a row that carries the settings columns. A missing value (row from
// a query that did not join, or a test double) falls back to the default.
function settingOn(row, col) {
  const v = row?.[col];
  return v == null ? !!SETTING_DEFAULTS[col] : !!v;
}

// Row -> { waAutoBill: true, ... } for the API.
function settingsFromRow(row) {
  const out = {};
  for (const [field, col] of Object.entries(SETTING_FIELDS)) out[field] = settingOn(row, col);
  return out;
}

// Creates the row if missing, then applies only the fields given. `runner` is a
// pool or a transaction.
async function saveSettings(runner, lodgeId, patch = {}) {
  const sets = [];
  const req = runner.request().input('lodgeId', sql.BigInt, lodgeId);
  for (const [field, col] of Object.entries(SETTING_FIELDS)) {
    if (patch[field] === undefined) continue;
    req.input(col, sql.Bit, patch[field] ? 1 : 0);
    sets.push(`${col} = @${col}`);
  }
  await req.query(`
    IF NOT EXISTS (SELECT 1 FROM dbo.lodge_settings WHERE lodge_id = @lodgeId)
      INSERT INTO dbo.lodge_settings (lodge_id) VALUES (@lodgeId);
    ${sets.length ? `UPDATE dbo.lodge_settings SET ${sets.join(', ')}, updated_at = SYSDATETIMEOFFSET() WHERE lodge_id = @lodgeId;` : ''}
  `);
}

// Standalone read, for owner screens that need only the settings.
async function getSettings(lodgeId) {
  const pool = await getPool();
  const { recordset } = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`SELECT ${SETTINGS_COLS} FROM dbo.lodges l ${SETTINGS_JOIN} WHERE l.id = @lodgeId`);
  return settingsFromRow(recordset[0]);
}

module.exports = {
  SETTING_DEFAULTS,
  SETTING_FIELDS,
  SETTINGS_JOIN,
  SETTINGS_COLS,
  settingOn,
  settingsFromRow,
  saveSettings,
  getSettings,
};
