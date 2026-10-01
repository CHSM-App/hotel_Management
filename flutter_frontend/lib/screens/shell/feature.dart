import 'package:flutter/material.dart';

import '../../domain/models/me.dart';

/// The same sections the web dashboard puts in its sidebar, gated the same way.
///
/// Kept as one list mirroring frontend/src/lib/propertyProfile.js so the two
/// clients cannot drift about who may see what: a section appears only if the
/// login carries its permission AND the property has the capability it needs.
/// A restaurant hides the rooms sections even for an owner who can reach
/// everything.
class Feature {
  final String key;
  final String title;
  final IconData icon;

  /// The permission that unlocks this section, or the first of several when
  /// more than one role can reach it (any-of, same as web's `permission: [...]`).
  final String permission;

  /// Extra permissions that also unlock this section, beyond [permission].
  final List<String> altPermissions;

  /// The lodge flag this section needs, or null for the universal ones.
  final String? capability;

  /// Alternative to [capability] for a section any one of several lodge
  /// flags unlocks (mirrors propertyProfile.js's `capability: [...]` on
  /// 'report-sales' — a property that sells rooms, food or events earns the
  /// row, not just one that has all three). Empty means "use [capability]
  /// instead".
  final List<String> anyCapabilities;

  /// Clusters this section under a collapsible header in the sidebar —
  /// mirrors the web sidebar's own grouping (propertyProfile.js's `group`,
  /// SIDEBAR_GROUP_ORDER). Null for a section that lists on its own.
  final String? group;

  const Feature({
    required this.key,
    required this.title,
    required this.icon,
    required this.permission,
    this.altPermissions = const [],
    this.capability,
    this.anyCapabilities = const [],
    this.group,
  });

  bool availableTo(Me me) {
    if (!me.user.canAny([permission, ...altPermissions])) return false;
    if (anyCapabilities.isNotEmpty) {
      return anyCapabilities.any((c) => _hasCapability(me, c));
    }
    if (capability == null) return true;
    return _hasCapability(me, capability!);
  }

  static bool _hasCapability(Me me, String capability) => switch (capability) {
    'hasRooms' => me.lodge.hasRooms,
    'servesFood' => me.lodge.servesFood,
    'hasEvents' => me.lodge.hasEvents,
    'hasAssets' => me.lodge.hasAssets,
    'hasExpenses' => me.lodge.hasExpenses,
    _ => true,
  };
}

const kFeatures = <Feature>[
  // ── Rooms ────────────────────────────────────────────────────────────────
  // Same web sidebar group (propertyProfile.js's 'Rooms'): Room Chart, Room
  // billing, Guest Register and Rooms & rates sit together under one
  // collapsible header, same four rows and titles the web has.
  Feature(
    key: 'bookings',
    // Same title the web sidebar's own 'bookings' row carries
    // (propertyProfile.js) — not "& tape chart": the chart is the one thing
    // this app deliberately does not carry. Thirty columns of nights across
    // five categories is a wall-screen artefact — on a phone it is a grid
    // nobody can read or tap. The same job is done here by choosing dates
    // and being shown what is free, which is what the desk actually asks
    // the chart.
    title: 'Room Chart',
    icon: Icons.calendar_month_rounded,
    permission: 'bookings.manage',
    capability: 'hasRooms',
    group: 'Rooms',
  ),
  Feature(
    key: 'billing',
    title: 'Room billing',
    icon: Icons.receipt_long_rounded,
    permission: 'billing.manage',
    group: 'Rooms',
  ),
  // The web's own Guest register ('guests') — every stay's booking details
  // in one searchable, filterable list, with the same summary tiles that
  // page opens on.
  Feature(
    key: 'register',
    title: 'Guest Register',
    icon: Icons.fact_check_outlined,
    permission: 'bookings.manage',
    capability: 'hasRooms',
    group: 'Rooms',
  ),
  // Same web sidebar group (propertyProfile.js's 'Restaurant'): Menu & QR
  // codes and Food orders & Billing sit together under one collapsible
  // "Restaurant" header — tapping it expands in place to show both rows,
  // rather than the desk having to open one to reach the other. Declared
  // here, right after Guest Register, to match propertyProfile.js's own
  // FEATURES order — a KITCHEN login (orders.manage + food.manage, no
  // bookings.manage) has to land on this one and not on Menu & QR codes,
  // same as the web.
  //
  // One row for what used to be two ('food' and 'restaurantBilling'):
  // propertyProfile.js merged the kitchen queue and restaurant billing under
  // a single "Food orders & Billing" entry (FoodSection.jsx), so a login
  // with any one of orders.manage / orders.take / billing.manage reaches
  // this row — food_billing_screen.dart decides which half(ves) it actually
  // sees underneath.
  Feature(
    key: 'food',
    title: 'Food orders & Billing',
    icon: Icons.room_service_rounded,
    permission: 'orders.manage',
    altPermissions: ['orders.take', 'billing.manage'],
    capability: 'servesFood',
    group: 'Restaurant',
  ),
  // Same web sidebar group (propertyProfile.js's 'Events'): Event Chart,
  // Event billing, Event register and Event setup sit together under one
  // collapsible header, same four rows and titles the web has — Chart,
  // register and setup are the same EventsScreen underneath (Events.jsx's
  // own Diary/List/Setup switch), just landed on a different tab; billing
  // is its own screen (event_billing_screen.dart), the same way Restaurant
  // billing sits apart from the room queue.
  Feature(
    key: 'events',
    title: 'Event Chart',
    icon: Icons.celebration_rounded,
    permission: 'events.manage',
    capability: 'hasEvents',
    group: 'Events',
  ),
  Feature(
    key: 'eventBilling',
    title: 'Event billing',
    icon: Icons.receipt_long_rounded,
    permission: 'billing.manage',
    capability: 'hasEvents',
    group: 'Events',
  ),
  Feature(
    key: 'eventRegister',
    title: 'Event register',
    icon: Icons.people_alt_rounded,
    permission: 'events.manage',
    capability: 'hasEvents',
    group: 'Events',
  ),
  Feature(
    key: 'eventSetup',
    title: 'Event setup',
    icon: Icons.build_rounded,
    permission: 'events.manage',
    capability: 'hasEvents',
    group: 'Events',
  ),
  // ── Setup ────────────────────────────────────────────────────────────────
  // Rooms and Menu & QR codes are both setup screens touched far less often
  // than the four above once a property's rooms and menu exist, so both sit
  // under their own collapsible header (Rooms, Restaurant) in the sidebar
  // rather than as flat rows.
  Feature(
    key: 'rooms',
    title: 'Rooms & rates',
    icon: Icons.bed_rounded,
    permission: 'rooms.manage',
    capability: 'hasRooms',
    group: 'Rooms',
  ),
  // Same web sidebar group (propertyProfile.js's 'Restaurant'): Menu & QR
  // codes and Food orders sit together under one collapsible "Restaurant"
  // header — tapping it expands in place to show both rows, rather than the
  // desk having to open one to reach the other.
  Feature(
    key: 'menu',
    title: 'Menu & QR codes',
    icon: Icons.restaurant_menu_rounded,
    permission: 'food.manage',
    capability: 'servesFood',
    group: 'Restaurant',
  ),
  // Same web sidebar group (propertyProfile.js's 'Setup', SIDEBAR_GROUP_ORDER):
  // staff logins and what each role can reach — its own screen
  // (staff_roles_screen.dart), same two tabs (Staff, Roles & access) the web
  // carries. Declared here, right after Menu & QR codes, to match
  // propertyProfile.js's own FEATURES order.
  Feature(
    key: 'staff',
    title: 'Staff & roles',
    icon: Icons.badge_rounded,
    permission: 'staff.manage',
    group: 'Setup',
  ),
  // Same web sidebar group (propertyProfile.js's 'Finance & Management'):
  // Asset inventory, Expenses, Other Income and Reports sit together under
  // one collapsible header rather than as four flat rows.
  //
  // Same web module (AssetsPanel.jsx): register, work orders and warranty/AMC
  // coverage for the property's physical assets. An add-on, same as Events:
  // off until switched on for the property (frontend/src/lib/propertyProfile.js).
  Feature(
    key: 'assets',
    title: 'Asset Inventory',
    icon: Icons.inventory_2_rounded,
    permission: 'assets.manage',
    capability: 'hasAssets',
    group: 'Finance & Management',
  ),
  // Same web module (ExpensesPanel.jsx): log spends, recurring schedules and
  // the monthly/by-category summary. An add-on, same as Assets: off until
  // switched on for the property (frontend/src/lib/propertyProfile.js).
  Feature(
    key: 'expenses',
    title: 'Expenses',
    icon: Icons.receipt_long_rounded,
    permission: 'expenses.manage',
    capability: 'hasExpenses',
    group: 'Finance & Management',
  ),
  // Same web module (IncomePanel.jsx): log, recurring schedules and payers
  // for income outside room/food/function billing (interest, scrap sale,
  // rent received). Gated on the same hasExpenses flag as Expenses on the
  // web (frontend/src/lib/propertyProfile.js) — a property that logs
  // expenses almost certainly wants to log this kind of income too, and
  // there is no separate add-on toggle for it.
  Feature(
    key: 'income',
    title: 'Other Income',
    icon: Icons.savings_rounded,
    permission: 'income.manage',
    capability: 'hasExpenses',
    group: 'Finance & Management',
  ),
  // ── Reports & Analytics ──────────────────────────────────────────────────
  // Same web sidebar group (propertyProfile.js's 'Reports & Analytics'): four
  // rows — Overview, Sales reports, Finance reports, Assets report — each
  // opening reports_screen.dart scoped to one of REPORT_SECTIONS'
  // (reportSections.js) tab clusters, rather than one row dumping all nine
  // tabs on the desk at once the way this app used to.
  Feature(
    key: 'report-overview',
    title: 'Overview',
    icon: Icons.bar_chart_rounded,
    permission: 'reports.view',
    group: 'Reports & Analytics',
  ),
  // Room bookings, restaurant orders and events — whichever the property
  // sells. Any one capability earns the row; the tabs inside show only what
  // the property actually has (same as propertyProfile.js's
  // capability: ['hasRooms', 'servesFood', 'hasEvents']).
  Feature(
    key: 'report-sales',
    title: 'Sales reports',
    icon: Icons.bar_chart_rounded,
    permission: 'reports.view',
    anyCapabilities: ['hasRooms', 'servesFood', 'hasEvents'],
    group: 'Reports & Analytics',
  ),
  // Tax & GST, Profit & Loss, Expenses and Other Income — no capability gate
  // here, same as the web: GST applies to every property regardless of
  // which add-ons are switched on.
  Feature(
    key: 'report-finance',
    title: 'Finance reports',
    icon: Icons.account_balance_wallet_rounded,
    permission: 'reports.view',
    group: 'Reports & Analytics',
  ),
  Feature(
    key: 'report-assets',
    title: 'Assets report',
    icon: Icons.build_rounded,
    permission: 'reports.view',
    capability: 'hasAssets',
    group: 'Reports & Analytics',
  ),
];
