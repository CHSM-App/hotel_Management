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
  final String permission;

  /// The lodge flag this section needs, or null for the universal ones.
  final String? capability;

  const Feature({
    required this.key,
    required this.title,
    required this.tabLabel,
    required this.icon,
    required this.permission,
    this.capability,
  });

  bool availableTo(Me me) {
    if (!me.user.can(permission)) return false;
    switch (capability) {
      case null:
        return true;
      case 'hasRooms':
        return me.lodge.hasRooms;
      case 'servesFood':
        return me.lodge.servesFood;
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
    capability: 'servesFood',
  ),
  Feature(
    key: 'rooms',
    title: 'Rooms & rates',
    tabLabel: 'Rooms',
    icon: Icons.bed_rounded,
    permission: 'rooms.manage',
    capability: 'hasRooms',
  ),

  // ── Setup ────────────────────────────────────────────────────────────────
  Feature(
    key: 'menu',
    title: 'Menu & QR codes',
    tabLabel: 'Menu',
    icon: Icons.restaurant_menu_rounded,
    permission: 'food.manage',
    capability: 'servesFood',
  ),
  Feature(
    key: 'staff',
    title: 'Staff & roles',
    tabLabel: 'Staff',
    icon: Icons.badge_rounded,
    permission: 'staff.manage',
  ),

  // ── Insights ─────────────────────────────────────────────────────────────
  Feature(
    key: 'reports',
    title: 'Reports',
    tabLabel: 'Reports',
    icon: Icons.bar_chart_rounded,
    permission: 'reports.view',
    capability: 'hasRooms',
  ),
];

/// How many sections get their own tab before the rest go behind "More".
///
/// Four plus More. Five is the practical ceiling for a bottom bar — past that
/// the labels truncate and the targets fall under the 44px a thumb needs — and
/// the web sidebar has eight sections, so something has to fold.
const int kPrimaryTabs = 4;
