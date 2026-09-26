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
          child: _SubTabs(
            selected: _tab,
            onSelect: (t) => setState(() => _tab = t),
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

/// Same sliding-pill segmented control the Asset inventory / Rooms & Rates
/// screens use — one connected control with a moving highlight, rather than
/// a content-hugging pill row.
class _SubTabs extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onSelect;

  const _SubTabs({required this.selected, required this.onSelect});

  static const _tabs = {
    'diary': 'Diary',
    'list': 'List',
    'setup': 'Setup',
  };

  static const double _height = 44;

  @override
  Widget build(BuildContext context) {
    final keys = _tabs.keys.toList();
    final selectedIndex = keys.indexOf(selected).clamp(0, keys.length - 1);

    Widget segment(String key, String label) {
      final isSelected = key == selected;
      return Expanded(
        child: GestureDetector(
          onTap: () => onSelect(key),
          behavior: HitTestBehavior.opaque,
          child: SizedBox(
            height: _height,
            child: Center(
              child: AnimatedDefaultTextStyle(
                duration: const Duration(milliseconds: 200),
                curve: Curves.easeOut,
                style: TextStyle(
                  color: isSelected ? Colors.white : AppTheme.text,
                  fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
                  fontSize: 13,
                ),
                child: Text(label, overflow: TextOverflow.ellipsis),
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
            alignment: Alignment(
              -1 + (2 / (keys.length - 1)) * selectedIndex,
              0,
            ),
            child: FractionallySizedBox(
              widthFactor: 1 / keys.length,
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
              for (final entry in _tabs.entries) segment(entry.key, entry.value),
            ],
          ),
        ],
      ),
    );
  }
}
