import 'package:flutter/material.dart';

import '../theme.dart';

/// A category/type icon in a colored circle — the same badge language
/// advance_receipt_screen.dart's app-bar icon uses (a solid circle behind a
/// white glyph), brought down onto list rows here so an asset/work-order/
/// vendor row reads at a glance instead of as a line of plain text.
class IconBadge extends StatelessWidget {
  final IconData icon;
  final Color color;
  final double size;

  const IconBadge({super.key, required this.icon, required this.color, this.size = 38});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      alignment: Alignment.center,
      child: Icon(icon, color: Colors.white, size: size * 0.52),
    );
  }
}

/// Best-guess icon for a category name — matched by keyword against the
/// suggested categories offered when registering an asset (see
/// _kSuggestedCategories in asset_form_sheet.dart), so the common cases get
/// a real glyph and anything else falls back to a plain box.
IconData categoryIcon(String categoryName) {
  final name = categoryName.toLowerCase();
  if (name.contains('air condition') || name.contains(' ac') || name == 'ac') return Icons.ac_unit_rounded;
  if (name.contains('lift') || name.contains('elevator')) return Icons.elevator_rounded;
  if (name.contains('bed')) return Icons.bed_rounded;
  if (name.contains('television') || name.contains(' tv') || name == 'tv') return Icons.tv_rounded;
  if (name.contains('geyser') || name.contains('water heater')) return Icons.hot_tub_rounded;
  if (name.contains('generator')) return Icons.bolt_rounded;
  if (name.contains('furniture')) return Icons.chair_rounded;
  if (name.contains('kitchen')) return Icons.kitchen_rounded;
  if (name.contains('plumbing')) return Icons.plumbing_rounded;
  if (name.contains('electrical')) return Icons.electrical_services_rounded;
  if (name.contains('fire')) return Icons.local_fire_department_rounded;
  if (name.contains('cctv') || name.contains('security')) return Icons.videocam_rounded;
  if (name.contains('laundry')) return Icons.local_laundry_service_rounded;
  if (name.contains('housekeeping') || name.contains('cleaning')) return Icons.cleaning_services_rounded;
  return Icons.inventory_2_rounded;
}

IconData issueTypeIcon(String issueType) => switch (issueType) {
  'ROUTINE_SERVICE' => Icons.event_repeat_rounded,
  _ => Icons.build_rounded,
};

/// A muted-accent circle with the vendor's initial — vendors are the one row
/// type here without a natural category/type icon, so the badge falls back
/// to an initial the way a contact list would.
class VendorInitialBadge extends StatelessWidget {
  final String name;
  final bool active;
  final double size;

  const VendorInitialBadge({super.key, required this.name, required this.active, this.size = 38});

  @override
  Widget build(BuildContext context) {
    final letter = name.trim().isEmpty ? '?' : name.trim()[0].toUpperCase();
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(color: active ? AppTheme.accent : AppTheme.muted, shape: BoxShape.circle),
      alignment: Alignment.center,
      child: Text(letter, style: TextStyle(color: Colors.white, fontSize: size * 0.42, fontWeight: FontWeight.w700)),
    );
  }
}
