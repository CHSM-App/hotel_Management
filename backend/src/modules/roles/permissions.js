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
    label: 'Reports',
    description: 'Occupancy and the GST filing summary.',
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
    label: 'Food orders',
    description: 'Work the live order queue, take orders at the counter and mark items unavailable.',
    capability: 'servesFood',
  },
];

const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

// Built-in role keys. These always exist (seeded with lodge_id NULL) and can be
// re-scoped per lodge, but never renamed or deleted.
const SYSTEM_ROLE_KEYS = ['OWNER', 'RECEPTION', 'KITCHEN'];

// What a property has to be for a built-in role to mean anything. A rooms-only
// lodge has no kitchen, so a Kitchen role there is a login that can reach one
// screen the dashboard already hides — worse than useless, because somebody
// will eventually be given it.
//
// The same idea as the `capability` field on FEATURES in the frontend's
// propertyProfile.js, which is what already hides the food sections.
const SYSTEM_ROLE_CAPABILITY = { KITCHEN: 'servesFood' };

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
