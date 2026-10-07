import '../theme.dart';
import 'package:flutter/material.dart';

/// "12 min", "2 h 5 min", "3 days" — how long something has been going on.
/// Mirrors the `ago` helper in housekeepingFormat.js.
String ago(String? timestamp, DateTime now) {
  if (timestamp == null || timestamp.isEmpty) return '';
  final then = DateTime.tryParse(timestamp);
  if (then == null) return '';
  final minutes = now.difference(then).inMinutes;
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return '$minutes min';
  final hours = minutes ~/ 60;
  if (hours < 24) return minutes % 60 != 0 ? '$hours h ${minutes % 60} min' : '$hours h';
  final days = hours ~/ 24;
  return '$days ${days == 1 ? 'day' : 'days'}';
}

/// "Ground" stays "Ground"; a bare number becomes "Floor 2" — mirrors
/// floorLabel in HousekeepingPanel.jsx.
String floorLabel(String? floor) {
  final f = (floor ?? '').trim();
  if (f.isEmpty) return '';
  return RegExp(r'^\d+$').hasMatch(f) ? 'Floor $f' : f;
}

/// A calendar day from the server (YYYY-MM-DD) as "08 Oct" — mirrors
/// dayLabel in HousekeepingPanel.jsx.
String dayLabel(String iso) {
  final d = DateTime.tryParse(iso);
  if (d == null) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return '${d.day.toString().padLeft(2, '0')} ${months[d.month - 1]}';
}

/// The room board's five tones — mirrors each status's `tone` in
/// HousekeepingPanel.jsx's ROOM_STATUS.
const kRoomStatusTone = {
  'DIRTY': AppTheme.danger,
  'CLEANING': AppTheme.edit,
  'READY': AppTheme.vacant,
  'OCCUPIED': AppTheme.checkedIn,
  'OUT_OF_ORDER': AppTheme.muted,
};

class StatusPill extends StatelessWidget {
  final String label;
  final Color color;
  const StatusPill({super.key, required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
      child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: color, fontSize: 10.5, fontWeight: FontWeight.w700)),
    );
  }
}

/// One option in a [FilterDropdownButton] — a key, its label, and how many
/// rows it would leave, mirrored from the web's own "Show: label (n)"
/// `<select>` on the Rooms/Issues tab strip.
class FilterOption {
  final String key;
  final String label;
  final int count;
  const FilterOption(this.key, this.label, this.count);
}

/// A compact square icon button — tap opens a menu of options right beside
/// it (standard popup placement), rather than a boxed dropdown chip or a
/// full bottom sheet. The current filter's label shows as plain text next
/// to it, so the board still reads at a glance without opening the menu.
class FilterDropdownButton extends StatelessWidget {
  final List<FilterOption> options;
  final String selected;
  final ValueChanged<String> onSelect;
  final String label;

  const FilterDropdownButton({super.key, required this.options, required this.selected, required this.onSelect, this.label = 'Showing'});

  @override
  Widget build(BuildContext context) {
    final current = options.firstWhere((o) => o.key == selected, orElse: () => options.first);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        PopupMenuButton<String>(
          onSelected: onSelect,
          tooltip: 'Filter',
          padding: EdgeInsets.zero,
          elevation: 10,
          color: AppTheme.card,
          shadowColor: AppTheme.heading.withValues(alpha: 0.25),
          offset: const Offset(0, 44),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.rMedium), side: const BorderSide(color: AppTheme.border)),
          constraints: const BoxConstraints(minWidth: 200),
          itemBuilder: (context) => [
            for (final o in options)
              PopupMenuItem(
                value: o.key,
                height: 40,
                child: Row(
                  children: [
                    Expanded(
                      child: Text(o.label, style: TextStyle(color: o.key == selected ? AppTheme.accent : AppTheme.heading, fontSize: 13.5, fontWeight: o.key == selected ? FontWeight.w700 : FontWeight.w500)),
                    ),
                    const SizedBox(width: AppTheme.s12),
                    Text('${o.count}', style: const TextStyle(color: AppTheme.muted, fontSize: 12.5)),
                    const SizedBox(width: 6),
                    SizedBox(width: 16, child: o.key == selected ? const Icon(Icons.check_rounded, size: 16, color: AppTheme.accent) : null),
                  ],
                ),
              ),
          ],
          child: Container(
            width: 36,
            height: 36,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppTheme.card,
              borderRadius: BorderRadius.circular(AppTheme.rSmall),
              border: Border.all(color: AppTheme.border),
              boxShadow: AppTheme.subtle,
            ),
            child: const Icon(Icons.filter_list_rounded, size: 18, color: AppTheme.accent),
          ),
        ),
        const SizedBox(width: AppTheme.s8),
        Text('${current.label} · ${current.count}', style: const TextStyle(color: AppTheme.heading, fontSize: 13, fontWeight: FontWeight.w700)),
      ],
    );
  }
}

/// Cards vs. spreadsheet — mirrors [_ViewToggleButton] in
/// expenses_list_panel.dart, the same toggle used across the app's own
/// registers (Expenses, Assets).
class HkViewToggle extends StatelessWidget {
  final String view;
  final ValueChanged<String> onSelect;

  const HkViewToggle({super.key, required this.view, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    Widget seg(String v, IconData icon) {
      final isSelected = v == view;
      return GestureDetector(
        onTap: () => onSelect(v),
        behavior: HitTestBehavior.opaque,
        child: Container(
          width: 36,
          height: 36,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: isSelected ? AppTheme.accent : Colors.transparent,
            borderRadius: BorderRadius.circular(AppTheme.rSmall - 2),
          ),
          child: Icon(icon, size: 17, color: isSelected ? Colors.white : AppTheme.muted),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
        border: Border.all(color: AppTheme.border),
        boxShadow: AppTheme.subtle,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          seg('cards', Icons.view_agenda_outlined),
          seg('table', Icons.table_rows_outlined),
        ],
      ),
    );
  }
}

/// A tinted spreadsheet-style header cell — shared by the Rooms and Issues
/// table views, same construction as `_HeaderCell` in linen_tab.dart /
/// `_ExpenseTable` in expenses_list_panel.dart.
class HkTableHeaderCell extends StatelessWidget {
  final String label;
  const HkTableHeaderCell(this.label, {super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 10),
      child: Text(
        label.toUpperCase(),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(color: AppTheme.sidebarBrandInk, fontSize: 10, fontWeight: FontWeight.w800, letterSpacing: 0.3),
      ),
    );
  }
}

/// A compact, pill-shaped action button — shorter than [NeuButton]'s 44px
/// touch-target floor, for a tight spot like a card's inline action or a
/// table row. Shared by Rooms and Issues cards/tables.
class CompactActionButton extends StatelessWidget {
  final String label;
  final Color color;
  final bool primary;
  final VoidCallback? onTap;
  final bool expand;

  const CompactActionButton({super.key, required this.label, required this.color, this.primary = false, required this.onTap, this.expand = false});

  @override
  Widget build(BuildContext context) {
    final button = Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
        child: Container(
          height: 34,
          padding: EdgeInsets.symmetric(horizontal: expand ? 0 : 14),
          alignment: Alignment.center,
          decoration: BoxDecoration(color: primary ? color : color.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(AppTheme.rSmall)),
          child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: primary ? Colors.white : color, fontSize: 12.5, fontWeight: FontWeight.w700)),
        ),
      ),
    );
    return Opacity(opacity: onTap == null ? 0.5 : 1, child: expand ? SizedBox(width: double.infinity, child: button) : button);
  }
}

class HkErrorBanner extends StatelessWidget {
  final String message;
  const HkErrorBanner(this.message, {super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppTheme.s12),
      decoration: BoxDecoration(color: AppTheme.danger.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(AppTheme.rSmall)),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: AppTheme.danger, size: 18),
          const SizedBox(width: AppTheme.s8),
          Expanded(child: Text(message, style: const TextStyle(color: AppTheme.danger, fontSize: 13))),
        ],
      ),
    );
  }
}
