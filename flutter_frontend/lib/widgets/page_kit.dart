import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../screens/theme.dart';

/// Page title block shared by the tablet+ layouts: title and subtitle on the
/// left, the primary action on the right, an optional filter row underneath.
/// Below 560 px of *its own* width the action drops under the title.
class PageHeader extends StatelessWidget {
  final String title;
  final String? subtitle;
  final Widget? action;
  final Widget? filters;

  const PageHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.action,
    this.filters,
  });

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final heading = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: text.headlineMedium),
        if (subtitle != null) ...[
          const SizedBox(height: AppTheme.s4),
          Text(subtitle!, style: text.bodyMedium),
        ],
      ],
    );
    return LayoutBuilder(
      builder: (context, c) {
        final stacked = c.maxWidth < 560;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (stacked || action == null)
              heading
            else
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [Expanded(child: heading), const SizedBox(width: AppTheme.s16), action!],
              ),
            if (stacked && action != null) ...[
              const SizedBox(height: AppTheme.s12),
              Align(alignment: Alignment.centerLeft, child: action),
            ],
            if (filters != null) ...[const SizedBox(height: AppTheme.s16), filters!],
          ],
        );
      },
    );
  }
}

/// Loading / empty / error filler that stays centred and readable on a wide
/// window instead of a tiny line lost in a big blank area.
class StateView extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? message;
  final Widget? action;
  final bool busy;

  const StateView({
    super.key,
    this.icon = Icons.inbox_outlined,
    required this.title,
    this.message,
    this.action,
    this.busy = false,
  });

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Padding(
          padding: const EdgeInsets.all(AppTheme.s24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (busy)
                const SizedBox(width: 28, height: 28, child: CircularProgressIndicator(strokeWidth: 3))
              else
                Icon(icon, size: 40, color: AppTheme.muted),
              const SizedBox(height: AppTheme.s12),
              Text(title, style: text.titleMedium, textAlign: TextAlign.center),
              if (message != null) ...[
                const SizedBox(height: AppTheme.s8),
                Text(message!, style: text.bodyMedium, textAlign: TextAlign.center),
              ],
              if (action != null) ...[const SizedBox(height: AppTheme.s16), action!],
            ],
          ),
        ),
      ),
    );
  }
}

/// List on the left, detail on the right when the *pane* is wide enough
/// ([splitAt]); otherwise just the list, and the caller pushes the detail as a
/// route exactly as on a phone. [detail] null in split mode shows [empty].
class MasterDetail extends StatelessWidget {
  final Widget master;
  final Widget? detail;
  final Widget empty;
  final double masterWidth;
  final double splitAt;

  const MasterDetail({
    super.key,
    required this.master,
    required this.detail,
    this.empty = const StateView(title: 'Select an item to see its details'),
    this.masterWidth = 380,
    this.splitAt = 1100,
  });

  /// Whether a pane this wide shows both sides — lets a screen decide between
  /// "select in place" and "push a route".
  static bool splits(double paneWidth, {double splitAt = 1100}) => paneWidth >= splitAt;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, c) {
        if (!splits(c.maxWidth, splitAt: splitAt)) return master;
        return Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(width: masterWidth, child: master),
            const VerticalDivider(width: AppTheme.s24, thickness: 1, color: AppTheme.border),
            Expanded(child: detail ?? empty),
          ],
        );
      },
    );
  }
}

/// A "Filters" button opening a 300 px popover (the web's FilterPopover). Not
/// hover-dependent: tap/click, Esc closes. [activeCount] shows the badge.
class FilterPopover extends StatelessWidget {
  final int activeCount;
  final Widget Function(BuildContext) builder;
  final String label;

  const FilterPopover({
    super.key,
    required this.builder,
    this.activeCount = 0,
    this.label = 'Filters',
  });

  @override
  Widget build(BuildContext context) {
    return MenuAnchor(
      style: MenuStyle(
        backgroundColor: const WidgetStatePropertyAll(AppTheme.card),
        surfaceTintColor: const WidgetStatePropertyAll(Colors.transparent),
        shape: WidgetStatePropertyAll(
          RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: const BorderSide(color: AppTheme.border),
          ),
        ),
      ),
      menuChildren: [
        SizedBox(
          width: 300,
          child: Padding(padding: const EdgeInsets.all(AppTheme.s16), child: builder(context)),
        ),
      ],
      builder: (context, controller, _) => OutlinedButton.icon(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(0, 44),
          foregroundColor: AppTheme.heading,
          side: const BorderSide(color: AppTheme.fieldBorder),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
        onPressed: () => controller.isOpen ? controller.close() : controller.open(),
        icon: const Icon(Icons.tune_rounded, size: 18),
        label: Text(activeCount > 0 ? '$label · $activeCount' : label),
      ),
    );
  }
}

/// Ctrl+F focuses [focusNode] (a screen's search box) while this widget is on
/// screen. Listens at the keyboard level rather than through a Focus subtree,
/// so it works whichever part of the page last had focus.
class SearchShortcut extends StatefulWidget {
  final FocusNode focusNode;
  final Widget child;

  const SearchShortcut({super.key, required this.focusNode, required this.child});

  @override
  State<SearchShortcut> createState() => _SearchShortcutState();
}

class _SearchShortcutState extends State<SearchShortcut> {
  @override
  void initState() {
    super.initState();
    HardwareKeyboard.instance.addHandler(_onKey);
  }

  @override
  void dispose() {
    HardwareKeyboard.instance.removeHandler(_onKey);
    super.dispose();
  }

  bool _onKey(KeyEvent e) {
    if (e is! KeyDownEvent ||
        e.logicalKey != LogicalKeyboardKey.keyF ||
        !HardwareKeyboard.instance.isControlPressed ||
        HardwareKeyboard.instance.isShiftPressed) {
      return false;
    }
    // A page hidden under a pushed route must not grab the key.
    if (ModalRoute.of(context)?.isCurrent == false) return false;
    widget.focusNode.requestFocus();
    return true;
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
