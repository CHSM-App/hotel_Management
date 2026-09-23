import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/event_booking.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'event_detail_screen.dart';
import 'event_form_screen.dart';

/// Events & functions > List — mirrors EventList in Events.jsx: a search box,
/// a status and venue filter, and every function in the range, newest-first
/// on the day it starts.
class EventsListPanel extends ConsumerStatefulWidget {
  const EventsListPanel({super.key});

  @override
  ConsumerState<EventsListPanel> createState() => _EventsListPanelState();
}

class _EventsListPanelState extends ConsumerState<EventsListPanel> {
  final _search = TextEditingController();
  String _status = '';

  static String _iso(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  // Same default window EventList opens on: a month back to six months out.
  late final String _fromDate = _iso(DateTime.now().subtract(const Duration(days: 30)));
  late final String _toDate = _iso(DateTime.now().add(const Duration(days: 182)));

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() {
    return ref.read(eventsViewModelProvider.notifier).loadEvents(
      fromDate: _fromDate,
      toDate: _toDate,
      status: _status.isEmpty ? null : _status,
      includeClosed: true,
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(eventsViewModelProvider);
    final needle = _search.text.trim().toLowerCase();
    final shown = [...state.events]
      ..removeWhere(
        (e) =>
            needle.isNotEmpty &&
            !e.title.toLowerCase().contains(needle) &&
            !e.organiserName.toLowerCase().contains(needle) &&
            !e.organiserPhone.contains(needle),
      )
      ..sort((a, b) => a.startAt.compareTo(b.startAt));

    return Stack(
      fit: StackFit.expand,
      children: [
        RefreshIndicator(
          onRefresh: _load,
          color: AppTheme.accent,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s4, AppTheme.s12, 88),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Expanded(
                    child: NeuField(
                      controller: _search,
                      label: '',
                      hint: 'Search title, organiser, phone',
                      onChanged: (_) => setState(() {}),
                    ),
                  ),
                  const SizedBox(width: AppTheme.s8),
                  _StatusFilterButton(
                    selected: _status,
                    onSelect: (s) {
                      setState(() => _status = s);
                      _load();
                    },
                  ),
                ],
              ),
              const SizedBox(height: AppTheme.s12),
              if (state.isLoading && state.events.isEmpty)
                const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()))
              else if (state.error != null && state.events.isEmpty)
                NeuNotice(icon: Icons.cloud_off_rounded, message: state.error!)
              else if (shown.isEmpty)
                const NeuNotice(
                  icon: Icons.celebration_outlined,
                  message: 'No functions match. Tap + to take a new enquiry.',
                )
              else
                for (final ev in shown)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppTheme.s8),
                    child: _EventCard(
                      event: ev,
                      onTap: () async {
                        await Navigator.of(context).push(
                          MaterialPageRoute(builder: (_) => EventDetailScreen(eventId: ev.id)),
                        );
                        _load();
                      },
                    ),
                  ),
            ],
          ),
        ),
        Positioned(
          right: AppTheme.s16,
          bottom: AppTheme.s16,
          child: FloatingActionButton(
            backgroundColor: AppTheme.accent,
            foregroundColor: Colors.white,
            onPressed: () async {
              await Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const EventFormScreen()),
              );
              _load();
            },
            child: const Icon(Icons.add_rounded),
          ),
        ),
      ],
    );
  }
}

/// The search bar's side filter — a single icon that pops a menu of
/// statuses (All + each of [kEventStatusLabel]) instead of a row of chips,
/// so the search bar keeps most of the width and the header stays compact.
class _StatusFilterButton extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onSelect;

  const _StatusFilterButton({required this.selected, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    final isFiltered = selected.isNotEmpty;
    return PopupMenuButton<String>(
      tooltip: 'Filter by status',
      initialValue: selected,
      onSelected: onSelect,
      offset: const Offset(0, 44),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.rSmall), side: const BorderSide(color: AppTheme.border)),
      itemBuilder: (context) => [
        _item('', 'All'),
        for (final s in kEventStatusLabel.keys) _item(s, kEventStatusLabel[s]!),
      ],
      child: NeuPressed(
        padding: const EdgeInsets.all(AppTheme.s12),
        focused: isFiltered,
        child: Icon(Icons.filter_list_rounded, size: 20, color: isFiltered ? AppTheme.accent : AppTheme.muted),
      ),
    );
  }

  PopupMenuItem<String> _item(String key, String label) {
    final isSelected = key == selected;
    return PopupMenuItem(
      value: key,
      child: Row(
        children: [
          Icon(
            isSelected ? Icons.radio_button_checked_rounded : Icons.radio_button_unchecked_rounded,
            size: 16,
            color: isSelected ? AppTheme.accent : AppTheme.muted,
          ),
          const SizedBox(width: 8),
          Text(label, style: TextStyle(color: AppTheme.text, fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500, fontSize: 13)),
        ],
      ),
    );
  }
}

class _EventCard extends StatelessWidget {
  final EventBooking event;
  final VoidCallback onTap;

  const _EventCard({required this.event, required this.onTap});

  Color get _statusColor => switch (event.status) {
    'ENQUIRY' => const Color(0xFF5A8FD0),
    'TENTATIVE' => AppTheme.draft,
    'CONFIRMED' => const Color(0xFFC0392B),
    'SETTLED' => AppTheme.muted,
    _ => AppTheme.border,
  };

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      onTap: onTap,
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(width: 4, height: 40, decoration: BoxDecoration(color: _statusColor, borderRadius: BorderRadius.circular(2))),
          const SizedBox(width: AppTheme.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        event.title,
                        style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 14.5),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(color: _statusColor.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
                      child: Text(
                        kEventStatusLabel[event.status] ?? event.status,
                        style: TextStyle(color: _statusColor, fontSize: 10.5, fontWeight: FontWeight.w700),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  '${kEventTypeLabel[event.eventType] ?? event.eventType} · ${event.venueName}',
                  style: const TextStyle(color: AppTheme.muted, fontSize: 12),
                ),
                const SizedBox(height: 2),
                Text(
                  '${formatDateTime(event.startAt)} · ${event.organiserName}',
                  style: const TextStyle(color: AppTheme.text, fontSize: 12),
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Text(formatPrice(event.totalAmount), style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 13)),
                    if (event.balanceDue > 0) ...[
                      const SizedBox(width: 8),
                      Text('Balance ${formatPrice(event.balanceDue)}', style: const TextStyle(color: AppTheme.danger, fontSize: 11)),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
