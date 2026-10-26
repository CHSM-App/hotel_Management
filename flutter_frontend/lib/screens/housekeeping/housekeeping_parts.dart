import '../../widgets/neu.dart';
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

/// "6:00 PM" — when a function starts or ends, mirrors timeLabel in
/// HousekeepingPanel.jsx.
String timeLabel(String? timestamp) {
  if (timestamp == null || timestamp.isEmpty) return '';
  final d = DateTime.tryParse(timestamp)?.toLocal();
  if (d == null) return '';
  final hour12 = d.hour % 12 == 0 ? 12 : d.hour % 12;
  final minute = d.minute.toString().padLeft(2, '0');
  return '$hour12:$minute ${d.hour < 12 ? 'AM' : 'PM'}';
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

/// A compact square icon button — tap opens the app's filter bottom sheet
/// with [options] as chips (and, when given, a second group such as
/// "Spaces"). The current filter's label shows as plain text next to it, so
/// the board still reads at a glance without opening the sheet.
class FilterDropdownButton extends StatefulWidget {
  final List<FilterOption> options;
  final String selected;
  final ValueChanged<String> onSelect;
  final String label;

  /// Optional second group in the same sheet (e.g. Rooms / Venues).
  final List<FilterOption>? extraOptions;
  final String? extraSelected;
  final ValueChanged<String>? onExtraSelect;
  final String extraLabel;

  /// Icon only (no current-filter text) for a search bar that already
  /// shares its row with the view toggle.
  final bool compact;

  const FilterDropdownButton({
    super.key,
    required this.options,
    required this.selected,
    required this.onSelect,
    this.label = 'Showing',
    this.extraOptions,
    this.extraSelected,
    this.onExtraSelect,
    this.extraLabel = 'Spaces',
    this.compact = false,
  });

  @override
  State<FilterDropdownButton> createState() => _FilterDropdownButtonState();
}

class _FilterDropdownButtonState extends State<FilterDropdownButton> {
  // The sheet outlives a parent rebuild only by its own state, so it keeps a
  // local copy of the picks and echoes each one up to the parent.
  late String _sel = widget.selected;
  late String? _extraSel = widget.extraSelected;

  @override
  void didUpdateWidget(FilterDropdownButton old) {
    super.didUpdateWidget(old);
    _sel = widget.selected;
    _extraSel = widget.extraSelected;
  }

  Widget _group(String title, List<FilterOption> opts, String sel, ValueChanged<String> pick) {
    return NeuFilterPanel(
      title: title,
      children: [
        for (final o in opts)
          NeuFilterRow(label: o.label, count: o.count, on: o.key == sel, icon: Icons.circle, onTap: () => pick(o.key)),
      ],
    );
  }

  void _open() {
    showNeuFilterSheet(
      context,
      multi: widget.extraOptions != null,
      onReset: () {
        setState(() {
          _sel = widget.options.first.key;
          _extraSel = widget.extraOptions?.first.key;
        });
        widget.onSelect(widget.options.first.key);
        if (widget.extraOptions != null) widget.onExtraSelect?.call(widget.extraOptions!.first.key);
      },
      (close) => StatefulBuilder(
        builder: (context, setSheet) {
          final extra = widget.extraOptions;
          return Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _group('SHOW', widget.options, _sel, (k) {
                setState(() => _sel = k);
                widget.onSelect(k);
                if (extra == null) {
                  close();
                } else {
                  setSheet(() {});
                }
              }),
              if (extra != null) ...[
                const SizedBox(height: AppTheme.s16),
                _group(widget.extraLabel.toUpperCase(), extra, _extraSel ?? extra.first.key, (k) {
                  setState(() => _extraSel = k);
                  widget.onExtraSelect?.call(k);
                  setSheet(() {});
                }),
              ],
            ],
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final options = widget.options;
    final current = options.firstWhere((o) => o.key == widget.selected, orElse: () => options.first);
    final extra = widget.extraOptions;
    final extraCurrent = extra == null || widget.extraSelected == null ? null : extra.firstWhere((o) => o.key == widget.extraSelected, orElse: () => extra.first);
    final active = (extra != null && widget.extraSelected != null && widget.extraSelected != extra.first.key) || (widget.compact && widget.selected != options.first.key);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        GestureDetector(
          onTap: _open,
          behavior: HitTestBehavior.opaque,
          child: Container(
            width: 38,
            height: 38,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: active ? AppTheme.accent : AppTheme.card,
              shape: BoxShape.circle,
              border: Border.all(color: active ? AppTheme.accent : AppTheme.shadowDark, width: 1.3),
              boxShadow: AppTheme.subtle,
            ),
            child: Icon(Icons.filter_alt_rounded, size: 17, color: active ? Colors.white : AppTheme.accent),
          ),
        ),
        if (!widget.compact) ...[
        const SizedBox(width: AppTheme.s8),
        Flexible(
          child: Text(
            active ? '${current.label} · ${extraCurrent!.label}' : '${current.label} · ${current.count}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: AppTheme.heading, fontSize: 13, fontWeight: FontWeight.w700),
          ),
        ),
        ],
      ],
    );
  }
}

/// The search pill + filter icon + cards/table toggle that top every
/// housekeeping list — the same bar Billing uses.
class HkSearchBar extends StatelessWidget {
  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final String hint;
  final Widget filter;
  final Widget viewToggle;

  const HkSearchBar({super.key, required this.controller, required this.onChanged, required this.hint, required this.filter, required this.viewToggle});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Container(
            height: 40,
            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s4),
            decoration: BoxDecoration(
              color: AppTheme.card,
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: AppTheme.shadowDark, width: 1.3),
              boxShadow: AppTheme.subtle,
            ),
            child: Row(
              children: [
                Container(
                  width: 28,
                  height: 28,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(color: AppTheme.accent.withValues(alpha: 0.10), shape: BoxShape.circle),
                  child: const Icon(Icons.search_rounded, size: 15, color: AppTheme.accent),
                ),
                const SizedBox(width: AppTheme.s8),
                Expanded(
                  child: TextField(
                    controller: controller,
                    onChanged: onChanged,
                    style: const TextStyle(color: AppTheme.heading, fontSize: 14),
                    decoration: InputDecoration(
                      hintText: hint,
                      hintStyle: const TextStyle(color: AppTheme.muted, fontSize: 14),
                      border: InputBorder.none,
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(vertical: 10),
                    ),
                  ),
                ),
                if (controller.text.isNotEmpty)
                  GestureDetector(
                    onTap: () {
                      controller.clear();
                      onChanged('');
                    },
                    behavior: HitTestBehavior.opaque,
                    child: Container(
                      width: 26,
                      height: 26,
                      margin: const EdgeInsets.only(right: 2),
                      alignment: Alignment.center,
                      decoration: const BoxDecoration(color: AppTheme.bg, shape: BoxShape.circle),
                      child: const Icon(Icons.close_rounded, size: 15, color: AppTheme.muted),
                    ),
                  ),
              ],
            ),
          ),
        ),
        const SizedBox(width: AppTheme.s8),
        filter,
        const SizedBox(width: AppTheme.s8),
        viewToggle,
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

  /// Overrides the 10%-alpha wash used behind the label when [primary] is
  /// false — e.g. [AppTheme.sidebarBrandWash] for the same solid-pill look
  /// [NeuButton]'s own `soft` gives "View bill", instead of a faint tint of
  /// [color].
  final Color? fillColor;

  const CompactActionButton({super.key, required this.label, required this.color, this.primary = false, required this.onTap, this.expand = false, this.fillColor});

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
          decoration: BoxDecoration(color: primary ? color : (fillColor ?? color.withValues(alpha: 0.10)), borderRadius: BorderRadius.circular(AppTheme.rSmall)),
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
