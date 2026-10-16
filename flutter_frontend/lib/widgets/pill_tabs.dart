import 'package:flutter/material.dart';

import '../screens/theme.dart';

/// One tab in [PillTabs]; [count] renders as a small badge beside the label.
class PillTab {
  final String key;
  final String label;
  final IconData icon;
  final int? count;

  const PillTab(this.key, this.label, this.icon, {this.count});
}

/// Card-style segmented tab bar: icon + label per tab, a sliding gradient pill
/// behind the selected one, and an optional count badge. Shared by the
/// Customers and Income screens so both read as one language.
class PillTabs extends StatelessWidget {
  final List<PillTab> tabs;
  final String selected;
  final ValueChanged<String> onSelect;

  const PillTabs({super.key, required this.tabs, required this.selected, required this.onSelect});

  static const double _height = 44;

  @override
  Widget build(BuildContext context) {
    if (tabs.length > 2) return _ScrollTabs(tabs: tabs, selected: selected, onSelect: onSelect);
    final selectedIndex = tabs.indexWhere((t) => t.key == selected).clamp(0, tabs.length - 1);

    Widget segment(PillTab tab) {
      final isSelected = tab.key == selected;
      final fg = isSelected ? Colors.white : AppTheme.muted;
      return Expanded(
        child: GestureDetector(
          onTap: () => onSelect(tab.key),
          behavior: HitTestBehavior.opaque,
          child: SizedBox(
            height: _height,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                // With 3+ tabs a slot is too narrow for icon + label on every
                // tab (text gets cut) — only the selected one keeps its icon.
                if (tabs.length <= 2 || isSelected) ...[
                  Icon(tab.icon, size: 16, color: fg),
                  const SizedBox(width: 5),
                ],
                Flexible(
                  child: Text(
                    tab.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: isSelected ? Colors.white : AppTheme.text,
                      fontWeight: isSelected ? FontWeight.w700 : FontWeight.w600,
                      fontSize: 13,
                    ),
                  ),
                ),
                if (tab.count != null) ...[
                  const SizedBox(width: 5),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                    decoration: BoxDecoration(
                      color: isSelected
                          ? Colors.white.withValues(alpha: 0.25)
                          : AppTheme.accent.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      '${tab.count}',
                      style: TextStyle(
                        color: isSelected ? Colors.white : AppTheme.accent,
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      );
    }

    return Container(
      height: _height,
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
        boxShadow: AppTheme.subtle,
      ),
      child: Stack(
        children: [
          AnimatedAlign(
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
            alignment: Alignment(
              tabs.length == 1 ? 0 : -1 + (2 / (tabs.length - 1)) * selectedIndex,
              0,
            ),
            child: FractionallySizedBox(
              widthFactor: 1 / tabs.length,
              child: Container(
                height: _height - 8,
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [AppTheme.accent, AppTheme.accent.withValues(alpha: 0.82)],
                  ),
                  borderRadius: BorderRadius.circular(AppTheme.rMedium - 4),
                  boxShadow: [
                    BoxShadow(
                      color: AppTheme.accent.withValues(alpha: 0.35),
                      blurRadius: 8,
                      offset: const Offset(0, 3),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Row(children: [for (final t in tabs) segment(t)]),
        ],
      ),
    );
  }
}

/// 3+ tabs: content-width pills in a horizontal scroller (same idea as the
/// Billing screen's tab strip). The selected tab is scrolled into view when it
/// changes, and a fade shows on whichever edge still has tabs past it.
class _ScrollTabs extends StatefulWidget {
  final List<PillTab> tabs;
  final String selected;
  final ValueChanged<String> onSelect;

  const _ScrollTabs({required this.tabs, required this.selected, required this.onSelect});

  @override
  State<_ScrollTabs> createState() => _ScrollTabsState();
}

class _ScrollTabsState extends State<_ScrollTabs> {
  final _scroll = ScrollController();
  late final Map<String, GlobalKey> _keys = {for (final t in widget.tabs) t.key: GlobalKey()};
  bool _moreLeft = false;
  bool _moreRight = false;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_updateEdges);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _reveal(animate: false);
      _updateEdges();
    });
  }

  @override
  void didUpdateWidget(covariant _ScrollTabs old) {
    super.didUpdateWidget(old);
    if (old.selected != widget.selected) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _reveal());
    }
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  void _updateEdges() {
    if (!_scroll.hasClients) return;
    final p = _scroll.position;
    final left = p.pixels > 2;
    final right = p.pixels < p.maxScrollExtent - 2;
    if (left != _moreLeft || right != _moreRight) {
      setState(() {
        _moreLeft = left;
        _moreRight = right;
      });
    }
  }

  void _reveal({bool animate = true}) {
    final ctx = _keys[widget.selected]?.currentContext;
    if (ctx == null || !mounted) return;
    Scrollable.ensureVisible(
      ctx,
      alignment: 0.5,
      duration: animate ? const Duration(milliseconds: 250) : Duration.zero,
      curve: Curves.easeOut,
    );
  }

  @override
  Widget build(BuildContext context) {
    const height = PillTabs._height;
    return Container(
      height: height,
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
        boxShadow: AppTheme.subtle,
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppTheme.rMedium - 4),
        child: Stack(
          children: [
            NotificationListener<ScrollMetricsNotification>(
              onNotification: (_) {
                WidgetsBinding.instance.addPostFrameCallback((_) => _updateEdges());
                return false;
              },
              child: SingleChildScrollView(
                controller: _scroll,
                scrollDirection: Axis.horizontal,
                physics: const ClampingScrollPhysics(),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [for (final tab in widget.tabs) _segment(tab, height)],
                ),
              ),
            ),
            if (_moreLeft) const _Fade(left: true),
            if (_moreRight) const _Fade(left: false),
          ],
        ),
      ),
    );
  }

  Widget _segment(PillTab tab, double height) {
    final sel = tab.key == widget.selected;
    return Padding(
      key: _keys[tab.key],
      padding: const EdgeInsets.only(right: 4),
      child: GestureDetector(
        onTap: () => widget.onSelect(tab.key),
        behavior: HitTestBehavior.opaque,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
          height: height - 8,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(
            gradient: sel
                ? LinearGradient(colors: [AppTheme.accent, AppTheme.accent.withValues(alpha: 0.82)])
                : null,
            borderRadius: BorderRadius.circular(AppTheme.rMedium - 4),
            boxShadow: sel
                ? [BoxShadow(color: AppTheme.accent.withValues(alpha: 0.35), blurRadius: 8, offset: const Offset(0, 3))]
                : null,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(tab.icon, size: 16, color: sel ? Colors.white : AppTheme.muted),
              const SizedBox(width: 6),
              Text(
                tab.label,
                maxLines: 1,
                softWrap: false,
                style: TextStyle(
                  color: sel ? Colors.white : AppTheme.text,
                  fontWeight: sel ? FontWeight.w700 : FontWeight.w600,
                  fontSize: 13,
                ),
              ),
              if (tab.count != null) ...[
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                  decoration: BoxDecoration(
                    color: sel ? Colors.white.withValues(alpha: 0.25) : AppTheme.accent.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    '${tab.count}',
                    style: TextStyle(
                      color: sel ? Colors.white : AppTheme.accent,
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Edge fade — the cue that more tabs sit past this edge.
class _Fade extends StatelessWidget {
  final bool left;
  const _Fade({required this.left});

  @override
  Widget build(BuildContext context) {
    return Positioned(
      left: left ? 0 : null,
      right: left ? null : 0,
      top: 0,
      bottom: 0,
      child: IgnorePointer(
        child: Container(
          width: 22,
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: left ? Alignment.centerLeft : Alignment.centerRight,
              end: left ? Alignment.centerRight : Alignment.centerLeft,
              colors: [AppTheme.card, AppTheme.card.withValues(alpha: 0)],
            ),
          ),
        ),
      ),
    );
  }
}
