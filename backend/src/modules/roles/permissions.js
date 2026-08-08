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
    label: 'Guests & ID register',
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
];

const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

// Built-in role keys. These always exist (seeded with lodge_id NULL) and can be
// re-scoped per lodge, but never renamed or deleted.
const SYSTEM_ROLE_KEYS = ['OWNER', 'RECEPTION', 'KITCHEN'];

function isValidPermission(key) {
  return PERMISSION_KEYS.includes(key);
}

module.exports = { PERMISSIONS, PERMISSION_KEYS, SYSTEM_ROLE_KEYS, isValidPermission };
