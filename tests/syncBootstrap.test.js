const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { shapeSeasons, shapeSlabs } = require('../src/modules/sync/sync.service');

test('seasons come back as plain dates and a numeric percent', () => {
  const [s] = shapeSeasons([
    { name: 'Diwali', adjustment_percent: '25.00', start_date: new Date('2026-11-08T00:00:00Z'), end_date: '2026-11-14' },
  ]);
  assert.deepEqual(s, { name: 'Diwali', percent: 25, startDate: '2026-11-08', endDate: '2026-11-14', isActive: true });
});

test('GST slabs keep the open-ended band null and the food premises flag tri-state', () => {
  const out = shapeSlabs([
    { supply_type: 'ACCOMMODATION', max_amount: '1000.00', rate_percent: '0', sac_code: '996311', applies_to_specified: null },
    { supply_type: 'ACCOMMODATION', max_amount: null, rate_percent: '18', sac_code: '996311', applies_to_specified: null },
    { supply_type: 'FOOD', max_amount: null, rate_percent: '18', sac_code: '996331', applies_to_specified: 1 },
    { supply_type: 'FOOD', max_amount: null, rate_percent: '5', sac_code: '996331', applies_to_specified: 0 },
  ]);
  assert.equal(out[0].maxAmount, 1000);
  assert.equal(out[1].maxAmount, null);
  assert.equal(out[0].appliesToSpecified, null);
  assert.equal(out[2].appliesToSpecified, true);
  assert.equal(out[3].appliesToSpecified, false);
});

test('the endpoint is mounted and gated on bookings.manage', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  assert.match(app, /\['\/sync', syncRoutes\]/);
  const routes = fs.readFileSync(path.join(__dirname, '../src/modules/sync/sync.routes.js'), 'utf8');
  assert.match(routes, /requirePermission\('bookings\.manage'\)/);
});
