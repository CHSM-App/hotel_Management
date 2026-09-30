import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import 'events_diary_panel.dart';
import 'events_list_panel.dart';
import 'events_setup_panel.dart';

/// Events & functions — Diary, List or Setup, one of the three per instance.
///
/// The web has these as three separate pages (Event Chart, Event register,
/// Event setup, each its own sidebar row); this mirrors that directly rather
/// than keeping the phone's old in-screen tab switcher — the sidebar is
/// already the way between them, so a second switcher on top of it would
/// just be the same choice offered twice. Diary itself keeps the same idea
/// the web tape-chart-style calendar has — one row per venue, one column per
/// day, a function in its status colour — but pages a week at a time rather
/// than dragging through an infinitely growing window, the same
/// simplification tape_chart.dart already makes for the room chart on a
/// phone.
class EventsScreen extends ConsumerStatefulWidget {
  /// 'diary', 'list' or 'setup' — which panel this instance is, fixed for
  /// its lifetime by the sidebar row that opened it.
  final String initialTab;

  const EventsScreen({super.key, this.initialTab = 'diary'});

  @override
  ConsumerState<EventsScreen> createState() => _EventsScreenState();
}

class _EventsScreenState extends ConsumerState<EventsScreen> {
  @override
  void initState() {
    super.initState();
    // Both the Diary and the List panel read venue names off the catalogue,
    // so it is loaded once here rather than by whichever one happens to be
    // opened first.
    Future.microtask(() => ref.read(eventsViewModelProvider.notifier).loadCatalogue());
  }

  @override
  Widget build(BuildContext context) {
    return switch (widget.initialTab) {
      'list' => const EventsListPanel(),
      'setup' => const EventsSetupPanel(),
      _ => const EventsDiaryPanel(),
    };
  }
}
