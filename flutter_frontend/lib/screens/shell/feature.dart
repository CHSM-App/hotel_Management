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

  /// Short enough for a bottom bar, where the sidebar's full title will not
  /// fit — "Bookings", not "Bookings & tape chart".
  final String tabLabel;

  final IconData icon;

  /// The permission that unlocks this section, or the first of several when
  /// more than one role can reach it (any-of, same as web's `permission: [...]`).
  final String permission;

  /// Extra permissions that also unlock this section, beyond [permission].
  final List<String> altPermissions;

  /// The lodge flag this section needs, or null for the universal ones.
  final String? capability;

  /// Clusters this section under a collapsible header in the "More" list —
  /// mirrors the web sidebar's own grouping (propertyProfile.js's `group`,
  /// SIDEBAR_GROUP_ORDER). Null for a section that lists on its own.
  final String? group;

  const Feature({
    required this.key,
    required this.title,
    required this.tabLabel,
    required this.icon,
    required this.permission,
    this.altPermissions = const [],
    this.capability,
    this.group,
  });

  bool availableTo(Me me) {
    if (!me.user.canAny([permission, ...altPermissions])) return false;
    switch (capability) {
      case null:
        return true;
      case 'hasRooms':
        return me.lodge.hasRooms;
      case 'servesFood':
        return me.lodge.servesFood;
      case 'hasEvents':
        return me.lodge.hasEvents;
      case 'hasAssets':
        return me.lodge.hasAssets;
      case 'hasExpenses':
        return me.lodge.hasExpenses;
      default:
        return true;
    }
  }
}

const kFeatures = <Feature>[
  // ── Front desk ───────────────────────────────────────────────────────────
  Feature(
    key: 'bookings',
    // Not "& tape chart": the chart is the one thing this app deliberately
    // does not carry. Thirty columns of nights across five categories is a
    // wall-screen artefact — on a phone it is a grid nobody can read or tap.
    // The same job is done here by choosing dates and being shown what is
    // free, which is what the desk actually asks the chart.
    title: 'Bookings',
    tabLabel: 'Bookings',
    icon: Icons.calendar_month_rounded,
    permission: 'bookings.manage',
    capability: 'hasRooms',
  ),
  // The web's own Guest register — every stay's booking details in one
  // searchable, filterable list, with the same summary tiles that page opens
  // on. Placed right beside Bookings, which only ever shows the phone's own
  // take-a-booking flow and one stay at a time.
  Feature(
    key: 'register',
    title: 'Booking Details',
    tabLabel: 'Register',
    icon: Icons.fact_check_outlined,
    permission: 'bookings.manage',
    capability: 'hasRooms',
  ),
  Feature(
    key: 'billing',
    title: 'Billing & GST',
    tabLabel: 'Billing',
    icon: Icons.receipt_long_rounded,
    permission: 'billing.manage',
  ),
  // Guest register ('guests', permission 'guests.view') is deliberately not
  // listed: it has no phone screen, and Rooms & rates now does (see
  // dashboard_shell.dart), so that tab took its primary-bar slot instead.
  //
  // Same web module (Events.jsx): diary, list and venue/add-on setup for
  // halls and functions. Given Food's old primary-bar slot — a banquet
  // enquiry is taken often enough at this desk to warrant its own tab.
  Feature(
    key: 'events',
    title: 'Events & functions',
    tabLabel: 'Events',
    icon: Icons.celebration_rounded,
    permission: 'events.manage',
    capability: 'hasEvents',
  ),
  // ── Setup ────────────────────────────────────────────────────────────────
  // Rooms and Menu & QR codes are both setup screens touched far less often
  // than the four above once a property's rooms and menu exist, so both fold
  // into "More" — each under its own collapsible header (Rooms, Restaurant)
  // rather than as flat rows.
  Feature(
    key: 'rooms',
    title: 'Rooms & rates',
    tabLabel: 'Rooms',
    icon: Icons.bed_rounded,
    permission: 'rooms.manage',
    capability: 'hasRooms',
    group: 'Rooms',
  ),
  // Same web sidebar group (propertyProfile.js's 'Restaurant'): Menu & QR
  // codes and Food orders sit together under one collapsible "Restaurant"
  // header in the More list — tapping the header expands it in place to
  // show both rows, rather than the desk having to open one to reach the
  // other.
  Feature(
    key: 'menu',
    title: 'Menu & QR codes',
    tabLabel: 'Menu',
    icon: Icons.restaurant_menu_rounded,
    permission: 'food.manage',
    capability: 'servesFood',
    group: 'Restaurant',
  ),
  Feature(
    key: 'food',
    title: 'Food orders',
    tabLabel: 'Food',
    icon: Icons.room_service_rounded,
    permission: 'orders.manage',
    altPermissions: ['orders.take'],
    capability: 'servesFood',
    group: 'Restaurant',
  ),
  // Same web sidebar row (propertyProfile.js's 'restaurantBilling'): table
  // and takeaway bills, and adding a staying guest's food to their room
  // bill — kept apart from Billing & GST's own room queue the same way the
  // web keeps <Billing stream="restaurant" /> apart from the plain one.
  Feature(
    key: 'restaurantBilling',
    title: 'Restaurant billing',
    tabLabel: 'Restaurant billing',
    icon: Icons.point_of_sale_rounded,
    permission: 'billing.manage',
    capability: 'servesFood',
    group: 'Restaurant',
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
    tabLabel: 'Assets',
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
    tabLabel: 'Expenses',
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
    tabLabel: 'Income',
    icon: Icons.savings_rounded,
    permission: 'income.manage',
    capability: 'hasExpenses',
    group: 'Finance & Management',
  ),
  // Feature(
  //   key: 'staff',
  //   title: 'Staff & roles',
  //   tabLabel: 'Staff',
  //   icon: Icons.badge_rounded,
  //   permission: 'staff.manage',
  // ),

  // ── Insights ─────────────────────────────────────────────────────────────
  // Same web module (ReportsPanel.jsx): Overview, Room Bookings, Events &
  // functions, Food orders, Tax & GST, Profit & Loss, Expenses, Other Income
  // and Assets, each tab further gated by its own capability/permission
  // inside the screen (see reports_screen.dart's kReportTabs) the same way
  // ReportsPanel.jsx's own ALL_TABS.filter() works. No capability gate here:
  // unlike the single-property-type screens above, Reports has tabs for
  // every kind of property, so a restaurant-only or rooms-only lodge still
  // has something to see (GST, Expenses, ...) even without every capability.
  // Folded into "More" — checked at day's end or month's end, not every shift.
  Feature(
    key: 'reports',
    title: 'Reports & Analytics',
    tabLabel: 'Reports',
    icon: Icons.bar_chart_rounded,
    permission: 'reports.view',
    group: 'Finance & Management',
  ),
];

/// How many sections get their own tab before the rest go behind "More".
///
/// Four plus More: Bookings, Register, Billing and Events are what the desk
/// opens every shift; Rooms & rates, Menu & QR codes and Food orders are
/// checked far less often, so all three fold into "More" rather than
/// crowding the bar.
const int kPrimaryTabs = 4;
