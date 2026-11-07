const test = require('node:test');
const assert = require('node:assert/strict');
const { permissionAvailableFor, permissionsFor } = require('../src/modules/roles/permissions');

// Events, assets and expenses/income/P&L each belong to an add-on a property can
// have switched off; requirePermission uses permissionAvailableFor to ignore a
// permission the property's add-ons don't cover.
const cases = [
  ['events.manage', 'hasEvents'],
  ['assets.manage', 'hasAssets'],
  ['expenses.manage', 'hasExpenses'],
  ['income.manage', 'hasExpenses'],
  ['profitLoss.view', 'hasExpenses'],
];

for (const [permission, flag] of cases) {
  test(`${permission} needs ${flag}`, () => {
    assert.equal(permissionAvailableFor(permission, { [flag]: false }), false);
    assert.equal(permissionAvailableFor(permission, {}), false);
    assert.equal(permissionAvailableFor(permission, { [flag]: true }), true);
  });
}

test('ungated permissions work on any property', () => {
  assert.equal(permissionAvailableFor('billing.manage', {}), true);
  assert.equal(permissionAvailableFor('rooms.manage', {}), true);
});

test('a property with no add-ons is not offered their permissions', () => {
  const offered = permissionsFor({ hasRooms: true }).map((p) => p.key);
  for (const [permission] of cases) assert.ok(!offered.includes(permission), permission);
});
