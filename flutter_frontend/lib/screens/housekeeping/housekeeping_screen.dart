import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/pill_tabs.dart';
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
    final lodge = ref.watch(authViewModelProvider).me?.lodge;
    // "Rooms", "Venues" or "Rooms & Venues" — mirrors the web tab's own label.
    final roomsLabel = lodge?.hasEvents ?? false ? (lodge?.hasRooms == false ? 'Venues' : 'Rooms & Venues') : 'Rooms';

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s12, AppTheme.s16, AppTheme.s8),
          child: _SubTabs(selected: _tab, issueCount: count, roomsLabel: roomsLabel, onSelect: (t) => setState(() => _tab = t)),
        ),
        Expanded(child: _tab == 'issues' ? const IssuesTab() : const RoomsTab()),
      ],
    );
  }
}

class _SubTabs extends StatelessWidget {
  final String selected;
  final int issueCount;
  final String roomsLabel;
  final ValueChanged<String> onSelect;

  const _SubTabs({required this.selected, required this.issueCount, required this.roomsLabel, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return PillTabs(
      selected: selected,
      onSelect: onSelect,
      tabs: [
        PillTab('rooms', roomsLabel, Icons.bed_rounded),
        PillTab('issues', 'Issues', Icons.report_problem_rounded, count: issueCount > 0 ? issueCount : null),
      ],
    );
  }
}
