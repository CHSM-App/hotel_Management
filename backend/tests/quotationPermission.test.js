const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The Quotation tool lives on the Room Chart, so a user who only has
// bookings.manage must be able to reach the two reads it depends on. Reads the
// route source because requirePermission needs a database-backed session.
const route = (m, f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', m, f), 'utf8');

test('quotation reads accept bookings.manage', () => {
  assert.match(route('pricing', 'pricing.routes.js'), /router\.get\('\/simulate'.*'bookings\.manage'/);
  assert.match(route('rooms', 'rooms.routes.js'), /router\.get\('\/', authenticate.*'bookings\.manage'/);
});
