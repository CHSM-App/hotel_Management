import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import '../theme.dart';
import 'issues_tab.dart';
import 'rooms_tab.dart';

/// Housekeeping — mirrors HousekeepingPanel.jsx: the room cleaning board,
/// and the problems/found items cleaners report from it, with a badge for
/// how many of those are still waiting.
class HousekeepingScreen extends ConsumerStatefulWidget {
  const HousekeepingScreen({super.key});

  @override
  ConsumerState<HousekeepingScreen> createState() => _HousekeepingScreenState();
}

class _HousekeepingScreenState extends ConsumerState<HousekeepingScreen> {
  String _tab = 'rooms';

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(housekeepingViewModelProvider.notifier).loadIssueSummary());
  }

  @override
  Widget build(BuildContext context) {
    final count = ref.watch(housekeepingViewModelProvider.select((s) => s.issueSummary.count));

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s12, AppTheme.s16, AppTheme.s8),
          child: _SubTabs(selected: _tab, issueCount: count, onSelect: (t) => setState(() => _tab = t)),
        ),
        Expanded(child: _tab == 'issues' ? const IssuesTab() : const RoomsTab()),
      ],
    );
  }
}

/// Same sliding-pill segmented control the Income / Expenses / Assets /
/// Rooms & Rates screens use — one connected control with a moving
/// highlight, rather than two separate pills.
class _SubTabs extends StatelessWidget {
  final String selected;
  final int issueCount;
  final ValueChanged<String> onSelect;

  const _SubTabs({required this.selected, required this.issueCount, required this.onSelect});

  static const double _height = 44;
  static const _tabs = ['rooms', 'issues'];

  @override
  Widget build(BuildContext context) {
    final selectedIndex = _tabs.indexOf(selected).clamp(0, _tabs.length - 1);

    Widget segment(String key, String label, {int badge = 0}) {
      final isSelected = key == selected;
      return Expanded(
        child: GestureDetector(
          onTap: () => onSelect(key),
          behavior: HitTestBehavior.opaque,
          child: SizedBox(
            height: _height,
            child: Center(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  AnimatedDefaultTextStyle(
                    duration: const Duration(milliseconds: 200),
                    curve: Curves.easeOut,
                    style: TextStyle(
                      color: isSelected ? Colors.white : AppTheme.heading,
                      fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
                      fontSize: 13,
                    ),
                    child: Text(label),
                  ),
                  if (badge > 0) ...[
                    const SizedBox(width: 6),
                    AnimatedContainer(
                      duration: const Duration(milliseconds: 200),
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                      decoration: BoxDecoration(
                        color: isSelected ? Colors.white : AppTheme.danger,
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        '$badge',
                        style: TextStyle(color: isSelected ? AppTheme.accent : Colors.white, fontSize: 10.5, fontWeight: FontWeight.w800),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      );
    }

    return Container(
      height: _height,
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
      ),
      child: Stack(
        children: [
          AnimatedAlign(
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
            alignment: Alignment(-1 + (2 / (_tabs.length - 1)) * selectedIndex, 0),
            child: FractionallySizedBox(
              widthFactor: 1 / _tabs.length,
              child: Container(
                height: _height - 8,
                decoration: BoxDecoration(
                  color: AppTheme.accent,
                  borderRadius: BorderRadius.circular(AppTheme.rMedium - 4),
                ),
              ),
            ),
          ),
          Row(
            children: [
              segment('rooms', 'Rooms'),
              segment('issues', 'Issues', badge: issueCount),
            ],
          ),
        ],
      ),
    );
  }
}
