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

  const Feature({
    required this.key,
    required this.title,
    required this.tabLabel,
    required this.icon,
    required this.permission,
    this.altPermissions = const [],
    this.capability,
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
  Feature(
    key: 'food',
    title: 'Food orders',
    tabLabel: 'Food',
    icon: Icons.room_service_rounded,
    permission: 'orders.manage',
    altPermissions: ['orders.take'],
    capability: 'servesFood',
  ),
  // ── Setup ────────────────────────────────────────────────────────────────
  // Rooms and Menu & QR codes are both setup screens touched far less often
  // than the four above once a property's rooms and menu exist, so both fold
  // into "More" — Rooms listed first, Menu & QR codes under it.
  Feature(
    key: 'rooms',
    title: 'Rooms & rates',
    tabLabel: 'Rooms',
    icon: Icons.bed_rounded,
    permission: 'rooms.manage',
    capability: 'hasRooms',
  ),
  Feature(
    key: 'menu',
    title: 'Menu & QR codes',
    tabLabel: 'Menu',
    icon: Icons.restaurant_menu_rounded,
    permission: 'food.manage',
    capability: 'servesFood',
  ),
  // Same web module (Events.jsx): diary, list and venue/add-on setup for
  // halls and functions. Folded into "More" beside Rooms and Menu — a
  // banquet enquiry is taken far less often than a walk-in booking.
  Feature(
    key: 'events',
    title: 'Events & functions',
    tabLabel: 'Events',
    icon: Icons.celebration_rounded,
    permission: 'events.manage',
    capability: 'hasEvents',
  ),
  // Same web module (AssetsPanel.jsx): register, work orders and warranty/AMC
  // coverage for the property's physical assets. No capability gate — every
  // property type has physical assets to track, same as the web sidebar entry.
  Feature(
    key: 'assets',
    title: 'Asset inventory',
    tabLabel: 'Assets',
    icon: Icons.inventory_2_rounded,
    permission: 'assets.manage',
  ),
  // Same web module (ExpensesPanel.jsx): log spends, recurring schedules and
  // the monthly/by-category summary. No capability gate — every property has
  // operating expenses, same as the web sidebar entry.
  Feature(
    key: 'expenses',
    title: 'Expenses',
    tabLabel: 'Expenses',
    icon: Icons.receipt_long_rounded,
    permission: 'expenses.manage',
  ),
  // Feature(
  //   key: 'staff',
  //   title: 'Staff & roles',
  //   tabLabel: 'Staff',
  //   icon: Icons.badge_rounded,
  //   permission: 'staff.manage',
  // ),

  // ── Insights ─────────────────────────────────────────────────────────────
  // Feature(
  //   key: 'reports',
  //   title: 'Reports',
  //   tabLabel: 'Reports',
  //   icon: Icons.bar_chart_rounded,
  //   permission: 'reports.view',
  //   capability: 'hasRooms',
  // ),
];

/// How many sections get their own tab before the rest go behind "More".
///
/// Four plus More: Bookings, Register, Billing and Food are what the desk
/// opens every shift; Rooms & rates and Menu & QR codes are setup screens
/// opened far less often, so both fold into "More" rather than crowding the
/// bar.
const int kPrimaryTabs = 4;
