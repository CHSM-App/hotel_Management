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
    title: 'Room Chart',
    description: 'The room chart, check-in and check-out.',
    permission: 'bookings.manage',
    capability: 'hasRooms',
    icon: 'calendar',
    group: 'Rooms',
  },
  {
    key: 'billing',
    title: 'Room billing',
    description: 'Stay bills, advance receipts and payments.',
    permission: 'billing.manage',
    // Stays only. Table and takeaway bills live in Restaurant billing and
    // function bills in Event billing; room-service food rides on the stay bill.
    capability: 'hasRooms',
    icon: 'receipt',
    group: 'Rooms',
  },
  {
    key: 'guests',
    title: 'Guest register',
    description: 'Occupants, ID records and vehicle numbers.',
    permission: 'guests.view',
    capability: 'hasRooms',
    icon: 'users',
    group: 'Rooms',
  },
  {
    key: 'food',
    title: 'Food orders & Billing',
    description: 'The live kitchen queue, taking orders, and table and takeaway bills.',
    permission: ['orders.manage', 'orders.take', 'billing.manage'],
    capability: 'servesFood',
    icon: 'coffee',
    group: 'Restaurant',
  },
  {
    key: 'events',
    title: 'Event Chart',
    description: 'The function diary — enquiries, holds, quotes and advances for halls and lawns.',
    permission: 'events.manage',
    // Its own bit rather than a property type: a rooms-only lodge with a
    // lawn and a restaurant with a party hall are both real.
    capability: 'hasEvents',
    icon: 'party',
    group: 'Events',
  },
  {
    key: 'eventBilling',
    title: 'Event billing',
    description: 'Function bills and advance receipts.',
    permission: 'billing.manage',
    capability: 'hasEvents',
    icon: 'receipt',
    group: 'Events',
  },
  {
    key: 'eventRegister',
    title: 'Event register',
    description: 'Every function as a list, filtered by status.',
    permission: 'events.manage',
    capability: 'hasEvents',
    icon: 'users',
    group: 'Events',
  },
  {
    key: 'eventSetup',
    title: 'Event setup',
    description: 'Venues and add-ons.',
    permission: 'events.manage',
    capability: 'hasEvents',
    icon: 'wrench',
    group: 'Events',
  },
  {
    key: 'rooms',
    title: 'Rooms & rates',
    description: 'Categories, booking extras and the price chart that computes every rate.',
    permission: 'rooms.manage',
    capability: 'hasRooms',
    icon: 'bed',
    group: 'Rooms',
  },
  {
    key: 'otherServices',
    title: 'Other services',
    description: 'Laundry, private pool, gaming and other services sold per use, billed like food.',
    // Front desk runs the uses; the owner prices them.
    permission: ['rooms.manage', 'bookings.manage', 'billing.manage'],
    // An add-on, switched on per property like events, assets and expenses.
    // (Needs rooms too, which the admin forms and the server both enforce.)
    capability: 'hasOtherServices',
    icon: 'wrench',
    group: 'Rooms',
  },
  {
    key: 'housekeeping',
    title: 'Housekeeping',
    description: 'Room cleaning status, hotel laundry and guests’ laundry.',
    // Reception and the owner already hold the first two; the Housekeeping role
    // holds only housekeeping.manage and sees nothing else.
    permission: ['housekeeping.manage', 'bookings.manage', 'rooms.manage'],
    // An add-on, switched on per property. (Needs rooms too, which the admin
    // forms and the server both enforce.)
    capability: 'hasHousekeeping',
    icon: 'bed',
    group: 'Rooms',
  },
  {
    key: 'menu',
    title: 'Menu & QR codes',
    description: 'The food menu, dining tables, and the QR codes guests scan to order.',
    permission: 'food.manage',
    capability: 'servesFood',
    icon: 'coffee',
    group: 'Restaurant',
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
    key: 'assets',
    title: 'Asset Inventory',
    description: 'Register equipment, track warranty/AMC, and log repairs.',
    permission: 'assets.manage',
    // An add-on, same as Events: off until switched on for the property.
    capability: 'hasAssets',
    icon: 'wrench',
    group: 'Finance & Management',
  },
  {
    key: 'expenses',
    title: 'Expenses',
    description: 'Log utility bills, salaries, repairs and other property costs.',
    permission: 'expenses.manage',
    capability: 'hasExpenses',
    icon: 'wallet',
    group: 'Finance & Management',
  },
  {
    key: 'income',
    title: 'Other Income',
    description: 'Log income outside room/food/function billing — interest, scrap sale, rent received.',
    permission: 'income.manage',
    // Rides on the same add-on toggle as Expenses — a property that logs
    // costs almost certainly wants to log this kind of income too, and a
    // second lodge-level switch just for this would be one more thing to
    // remember to turn on.
    capability: 'hasExpenses',
    icon: 'wallet',
    group: 'Finance & Management',
  },
  {
    key: 'report-overview',
    title: 'Overview',
    description: 'The headline numbers and trends for the property.',
    permission: 'reports.view',
    icon: 'barChart',
    group: 'Reports & Analytics',
  },
  {
    key: 'report-sales',
    title: 'Sales reports',
    description: 'Room bookings, restaurant orders and events — whichever this property sells.',
    permission: 'reports.view',
    // Any one earns the section; the tabs inside show only what the property has.
    capability: ['hasRooms', 'servesFood', 'hasEvents'],
    icon: 'barChart',
    group: 'Reports & Analytics',
  },
  {
    key: 'report-finance',
    title: 'Finance reports',
    description: 'Tax & GST, Profit & Loss, expenses and other income.',
    permission: 'reports.view',
    icon: 'wallet',
    group: 'Reports & Analytics',
  },
  {
    key: 'report-assets',
    title: 'Assets report',
    description: 'Equipment owned, its value and upkeep.',
    permission: 'reports.view',
    capability: 'hasAssets',
    icon: 'wrench',
    group: 'Reports & Analytics',
  },
];

export const SIDEBAR_GROUP_ORDER = ['Rooms', 'Restaurant', 'Events', 'Finance & Management', 'Reports & Analytics', 'Setup'];

// A section exists for a property if the property has the capability it needs
// — any one of them, when a feature (like Reports) is earned by more than
// one. Features with no `capability` (staff and roles) are universal.
export function featuresForCapabilities(capabilities) {
  return FEATURES.filter((f) => {
    if (!f.capability) return true;
    const keys = Array.isArray(f.capability) ? f.capability : [f.capability];
    return keys.some((key) => Boolean(capabilities[key]));
  });
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
