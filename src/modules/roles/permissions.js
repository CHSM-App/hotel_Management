// The full set of things a lodge role can be granted. Anything not listed here
// is rejected when saving a role, so a typo can't silently create a permission
// that no route ever checks.
//
// Kept deliberately coarse — one entry per dashboard section — because that's
// the granularity an owner actually reasons about ("can reception touch the
// price chart?"), not per-endpoint CRUD flags they'd have to assemble.
const PERMISSIONS = [
  {
    key: 'bookings.manage',
    label: 'Bookings & tape chart',
    description: 'View the room chart, create bookings, check guests in and out.',
  },
  {
    key: 'billing.manage',
    label: 'Billing & GST',
    description: 'Issue and void bills, record payments.',
  },
  {
    key: 'guests.view',
    label: 'Guest register',
    description: 'Browse past and present guests, and open their ID proofs.',
  },
  {
    key: 'rooms.manage',
    label: 'Rooms & rates',
    description: 'Add rooms, categories, seasonal pricing and booking extras.',
  },
  {
    key: 'reports.view',
    label: 'Reports & Analytics',
    description:
      'Opens the Reports & Analytics section: room, restaurant, event, tax, profit & loss, expense, income and asset reports (each still shown only if the property has it). On by default for Owner and Accountant.',
  },
  {
    key: 'staff.manage',
    label: 'Staff & roles',
    description: 'Add staff logins and change what each role can reach.',
  },
  {
    key: 'food.manage',
    label: 'Menu & QR codes',
    description: 'Build the food menu, set up dining tables and print the ordering QR codes.',
    capability: 'servesFood',
  },
  {
    key: 'orders.manage',
    label: 'Kitchen queue',
    description: 'View the live order queue and accept guest QR orders.',
    capability: 'servesFood',
  },
  {
    key: 'orders.cook',
    label: 'Cook orders',
    description: 'Start cooking an accepted order, tick off dishes and mark it ready.',
    capability: 'servesFood',
  },
  {
    key: 'orders.take',
    label: 'Take orders',
    description: 'Place new orders from a table, a room or the counter, edit them until billed, and mark them delivered.',
    capability: 'servesFood',
  },
  {
    key: 'events.manage',
    label: 'Events & functions',
    description: 'Take hall and lawn bookings for functions, quote them, and set up venues and add-ons.',
    capability: 'hasEvents',
  },
  {
    key: 'assets.manage',
    label: 'Asset Inventory',
    description: 'Register equipment, track warranty/AMC, and manage maintenance work orders.',
    capability: 'hasAssets',
  },
  {
    key: 'expenses.manage',
    label: 'Expenses',
    description: 'Log and review property expenses, vendors and recurring bills.',
    capability: 'hasExpenses',
  },
  {
    key: 'income.manage',
    label: 'Other Income',
    description: 'Log and review income outside room/food/function billing — interest, scrap sale, rent received, and the like.',
    capability: 'hasExpenses',
  },
  {
    key: 'housekeeping.manage',
    label: 'Housekeeping',
    description: 'Clean rooms, track hotel linen and take guests’ laundry. No access to bills or payments.',
    capability: 'hasHousekeeping',
  },
  {
    key: 'profitLoss.view',
    label: 'Profit & Loss',
    description: 'View the combined revenue, expense, other-income and depreciation figures behind Profit & Loss.',
    capability: 'hasExpenses',
  },
];

const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

// Built-in role keys. These always exist (seeded with lodge_id NULL) and can be
// re-scoped per lodge, but never renamed or deleted.
const SYSTEM_ROLE_KEYS = ['OWNER', 'RECEPTION', 'KITCHEN', 'CAPTAIN', 'ACCOUNTANT', 'HOUSEKEEPING'];

// What a property has to be for a built-in role to mean anything. A rooms-only
// lodge has no kitchen, so a Kitchen role there is a login that can reach one
// screen the dashboard already hides — worse than useless, because somebody
// will eventually be given it.
//
// The same idea as the `capability` field on FEATURES in the frontend's
// propertyProfile.js, which is what already hides the food sections.
// ACCOUNTANT isn't listed: billing.manage has no capability gate, so that role
// is offered everywhere. This is about the role itself staying on the picker,
// not about every permission it carries: ACCOUNTANT also carries events.manage,
// expenses.manage and income.manage, which *are* gated (hasEvents, hasExpenses)
// at the individual-permission level in PERMISSIONS/permissionsFor below, so a
// property without those add-ons has an Accountant that simply comes without
// them rather than the whole role being hidden over a permission it can't use.
// requirePermission applies the same gate on every request, so a permission a
// property's add-ons don't cover grants nothing even if a role row still holds it.
const SYSTEM_ROLE_CAPABILITY = {
  KITCHEN: 'servesFood',
  CAPTAIN: 'servesFood',
  HOUSEKEEPING: 'hasHousekeeping',
};

function isValidPermission(key) {
  return PERMISSION_KEYS.includes(key);
}

// The permissions worth offering a property of this shape. Filtering here
// rather than in the UI means a rooms-only lodge can't be handed 'orders.manage'
// by a crafted request either.
function permissionsFor(capabilities) {
  return PERMISSIONS.filter((p) => !p.capability || Boolean(capabilities?.[p.capability]));
}

function permissionAvailableFor(key, capabilities) {
  const permission = PERMISSIONS.find((p) => p.key === key);
  return Boolean(permission) && (!permission.capability || Boolean(capabilities?.[permission.capability]));
}

function roleAvailableFor(roleKey, capabilities) {
  const needed = SYSTEM_ROLE_CAPABILITY[roleKey];
  return !needed || Boolean(capabilities?.[needed]);
}

module.exports = {
  PERMISSIONS,
  PERMISSION_KEYS,
  SYSTEM_ROLE_KEYS,
  SYSTEM_ROLE_CAPABILITY,
  isValidPermission,
  permissionsFor,
  permissionAvailableFor,
  roleAvailableFor,
};
