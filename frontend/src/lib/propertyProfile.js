// What a property *is*, and what that entitles its account to.
//
// The database stores four independent capability bits (has_rooms, serves_food,
// food_room_service, food_table_service) because the combinations are real and
// an enum would grow a value for every pairing. But nobody onboarding a
// customer thinks in bits — they think "this is a lodge" or "this is a
// restaurant". PROPERTY_TYPES is that translation, and it lives here rather
// than in the registration form so the dashboard, the lodge list and the
// onboarding summary all describe a property the same way.

// `noun` / `Noun` let the onboarding form talk about the thing being registered
// in the customer's own words. Asking a restaurateur for their "lodge name" is
// the kind of small wrongness that makes software feel like it wasn't built for
// you — and it's the moment staff are most likely to wonder whether they picked
// the right option.
export const PROPERTY_TYPES = [
  {
    key: 'LODGE',
    label: 'Lodge',
    noun: 'lodge',
    Noun: 'Lodge',
    examples: { name: 'Sagar Kinara Residency', slug: 'sagar-kinara-residency' },
    tagline: 'Rooms only — no kitchen.',
    description:
      'Rooms, rates, bookings and billing. Nothing food-related appears anywhere in their dashboard.',
    flags: { hasRooms: true, servesFood: false, foodRoomService: false, foodTableService: false },
  },
  {
    key: 'LODGE_WITH_FOOD',
    label: 'Lodge with meals',
    noun: 'lodge',
    Noun: 'Lodge',
    examples: { name: 'Sagar Kinara Residency', slug: 'sagar-kinara-residency' },
    tagline: 'Rooms, plus food to order.',
    description:
      'Everything a lodge gets, plus a menu, ordering QR codes and a kitchen queue. Choose below whether guests order to their rooms, at dining tables, or both.',
    flags: { hasRooms: true, servesFood: true, foodRoomService: true, foodTableService: true },
  },
  {
    key: 'RESTAURANT',
    label: 'Restaurant',
    noun: 'restaurant',
    Noun: 'Restaurant',
    examples: { name: 'Malvan Katta', slug: 'malvan-katta' },
    tagline: 'Food only — no rooms to let.',
    description:
      'Menu, dining tables, QR ordering and the kitchen queue. Bookings, the tape chart, rates and the guest register are hidden entirely.',
    flags: { hasRooms: false, servesFood: true, foodRoomService: false, foodTableService: true },
  },
];

// How a lodge that serves meals takes them. Only meaningful for
// LODGE_WITH_FOOD — a restaurant has no rooms to serve, and a plain lodge has
// no food to take orders for.
export const FOOD_SERVICE_STYLES = [
  {
    key: 'BOTH',
    label: 'Rooms and tables',
    description: 'Guests can order to their room, and diners can order at a table.',
    flags: { foodRoomService: true, foodTableService: true },
  },
  {
    key: 'ROOMS',
    label: 'To rooms only',
    description: 'In-room dining. No dining tables are set up.',
    flags: { foodRoomService: true, foodTableService: false },
  },
  {
    key: 'TABLES',
    label: 'At tables only',
    description: 'A dining hall guests come down to. No ordering from rooms.',
    flags: { foodRoomService: false, foodTableService: true },
  },
];

// The dashboard's sections, and the two things that gate each one: a permission
// the signed-in user must hold, and a capability the property must have.
//
// Shared by OwnerDashboard (to build its sidebar) and by the onboarding form
// (to show exactly what the new account will contain). One list means the
// promise made at signup and the product delivered cannot drift apart.
export const FEATURES = [
  {
    key: 'bookings',
    title: 'Bookings & tape chart',
    description: 'The room chart, check-in and check-out.',
    permission: 'bookings.manage',
    capability: 'hasRooms',
    icon: 'calendar',
    group: 'Front desk',
  },
  {
    key: 'billing',
    title: 'Billing & GST',
    description: 'Tax invoices, bills of supply, cash receipts and payments.',
    permission: 'billing.manage',
    // No capability gate: every property type sells something. A lodge bills
    // stays, a restaurant bills closed tables, and a lodge with meals bills
    // both on one document. The screen itself adapts — see Billing.jsx.
    icon: 'receipt',
    group: 'Front desk',
  },
  {
    key: 'guests',
    title: 'Guest register',
    description: 'Occupants, ID records and vehicle numbers.',
    permission: 'guests.view',
    capability: 'hasRooms',
    icon: 'users',
    group: 'Front desk',
  },
  {
    key: 'food',
    title: 'Food orders',
    description: 'The live kitchen queue, and taking an order at the counter.',
    permission: 'orders.manage',
    capability: 'servesFood',
    icon: 'coffee',
    group: 'Front desk',
  },
  {
    key: 'rooms',
    title: 'Rooms & rates',
    description: 'Categories, booking extras and the price chart that computes every rate.',
    permission: 'rooms.manage',
    capability: 'hasRooms',
    icon: 'bed',
    group: 'Setup',
  },
  {
    key: 'menu',
    title: 'Menu & QR codes',
    description: 'The food menu, dining tables, and the QR codes guests scan to order.',
    permission: 'food.manage',
    capability: 'servesFood',
    icon: 'coffee',
    group: 'Setup',
  },
  {
    key: 'staff',
    title: 'Staff & roles',
    description: 'Staff logins, and what each role can reach.',
    permission: 'staff.manage',
    icon: 'userCheck',
    group: 'Setup',
  },
  {
    key: 'reports',
    title: 'Reports',
    description: 'Downloadable booking reports, occupancy and a GST filing summary.',
    permission: 'reports.view',
    capability: 'hasRooms',
    icon: 'barChart',
    group: 'Insights',
  },
];

export const SIDEBAR_GROUP_ORDER = ['Front desk', 'Setup', 'Insights'];

// A section exists for a property if the property has the capability it needs.
// Features with no `capability` (staff and roles) are universal.
export function featuresForCapabilities(capabilities) {
  return FEATURES.filter((f) => !f.capability || Boolean(capabilities[f.capability]));
}

// Reads a set of flags back as a property type, for describing lodges that
// already exist. Falls back to null for a combination no preset covers — an
// owner can switch food service off after signup, and that shouldn't render as
// a wrong label.
export function propertyTypeOf(capabilities) {
  if (!capabilities) return null;
  if (!capabilities.hasRooms) return capabilities.servesFood ? PROPERTY_TYPES[2] : null;
  if (capabilities.servesFood) return PROPERTY_TYPES[1];
  return PROPERTY_TYPES[0];
}
