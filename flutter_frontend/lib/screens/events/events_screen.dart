import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import '../theme.dart';
import 'events_diary_panel.dart';
import 'events_list_panel.dart';
import 'events_setup_panel.dart';

/// Events & functions — mirrors Events.jsx's shell: Diary, List and Setup.
/// Diary keeps the same idea the web tape-chart-style calendar has — one row
/// per venue, one column per day, a function in its status colour — but
/// pages a week at a time rather than dragging through an infinitely
/// growing window, the same simplification tape_chart.dart already makes
/// for the room chart on a phone.
class EventsScreen extends ConsumerStatefulWidget {
  const EventsScreen({super.key});

  @override
  ConsumerState<EventsScreen> createState() => _EventsScreenState();
}

class _EventsScreenState extends ConsumerState<EventsScreen> {
  String _tab = 'diary';

  @override
  void initState() {
    super.initState();
    // Both the Diary and the List tab read venue names off the catalogue,
    // so it is loaded once here rather than by whichever tab happens to be
    // opened first.
    Future.microtask(() => ref.read(eventsViewModelProvider.notifier).loadCatalogue());
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s8),
          child: Align(
            alignment: Alignment.centerLeft,
            child: _SubTabs(
              selected: _tab,
              onSelect: (t) => setState(() => _tab = t),
            ),
          ),
        ),
        Expanded(
          child: switch (_tab) {
            'list' => const EventsListPanel(),
            'setup' => const EventsSetupPanel(),
            _ => const EventsDiaryPanel(),
          },
        ),
      ],
    );
  }
}

class _SubTabs extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onSelect;

  const _SubTabs({required this.selected, required this.onSelect});

  static const _tabs = [
    ('diary', 'Diary'),
    ('list', 'List'),
    ('setup', 'Setup'),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppTheme.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final t in _tabs)
            GestureDetector(
              onTap: () => onSelect(t.$1),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 150),
                padding: const EdgeInsets.symmetric(horizontal: AppTheme.s16, vertical: AppTheme.s8),
                decoration: BoxDecoration(
                  color: t.$1 == selected ? AppTheme.accent : Colors.transparent,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  t.$2,
                  style: TextStyle(
                    color: t.$1 == selected ? Colors.white : AppTheme.text,
                    fontWeight: t.$1 == selected ? FontWeight.w600 : FontWeight.w500,
                    fontSize: 13,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
