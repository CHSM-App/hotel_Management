import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/event_booking.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/compact_date_picker.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'event_detail_screen.dart';
import 'event_form_screen.dart';

/// Events & functions > List — mirrors EventList in Events.jsx: a search box,
/// a status and venue filter, and every function in the range, newest-first
/// on the day it starts.
class EventsListPanel extends ConsumerStatefulWidget {
  /// Pre-selects the status cut — how a colour clicked on the diary's own
  /// legend arrives here, mirroring `onShowList` in Events.jsx.
  final String initialStatus;

  const EventsListPanel({super.key, this.initialStatus = ''});

  @override
  ConsumerState<EventsListPanel> createState() => _EventsListPanelState();
}

class _EventsListPanelState extends ConsumerState<EventsListPanel> {
  final _search = TextEditingController();
  late String _status = widget.initialStatus;

  static String _iso(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  // Same default window EventList opens on: a month back to six months out —
  // the room register's own From/To pills let the desk narrow or widen it.
  late String _fromDate = _iso(DateTime.now().subtract(const Duration(days: 30)));
  late String _toDate = _iso(DateTime.now().add(const Duration(days: 182)));

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

  void _setRange(String from, String to) {
    setState(() {
      _fromDate = from;
      _toDate = to.compareTo(from) < 0 ? from : to;
    });
    _load();
  }

  /// The status cut's own door — folds open right under the search bar
  /// rather than in a menu, the same [_StatusChips] panel the room register
  /// opens off its own filter icon.
  bool _filterOpen = false;
  final LayerLink _filterLink = LayerLink();
  final OverlayPortalController _filterPortalController = OverlayPortalController();

  void _toggleFilterOpen() {
    setState(() => _filterOpen = !_filterOpen);
    if (_filterOpen) {
      _filterPortalController.show();
    } else {
      _filterPortalController.hide();
    }
  }

  void _selectStatus(String status) {
    setState(() => _status = status);
    _load();
    _toggleFilterOpen();
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
                children: [
                  Expanded(
                    child: _EventDateField(
                      label: 'From',
                      value: _fromDate,
                      onPick: (v) => _setRange(v, _toDate),
                    ),
                  ),
                  const SizedBox(width: AppTheme.s8),
                  Expanded(
                    child: _EventDateField(
                      label: 'To',
                      value: _toDate,
                      minDate: _fromDate,
                      onPick: (v) => _setRange(_fromDate, v),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppTheme.s12),
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Expanded(
                    child: Container(
                      height: 48,
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
                            width: 34,
                            height: 34,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              color: AppTheme.accent.withValues(alpha: 0.10),
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(Icons.search_rounded, size: 17, color: AppTheme.accent),
                          ),
                          const SizedBox(width: AppTheme.s8),
                          Expanded(
                            child: TextField(
                              controller: _search,
                              onChanged: (_) => setState(() {}),
                              style: const TextStyle(color: AppTheme.heading, fontSize: 14),
                              decoration: const InputDecoration(
                                hintText: 'Search title, organiser, phone',
                                hintStyle: TextStyle(color: AppTheme.muted, fontSize: 14),
                                border: InputBorder.none,
                                isDense: true,
                                contentPadding: EdgeInsets.symmetric(vertical: 13),
                              ),
                            ),
                          ),
                          if (_search.text.isNotEmpty)
                            GestureDetector(
                              onTap: () => setState(() => _search.clear()),
                              behavior: HitTestBehavior.opaque,
                              child: Container(
                                width: 30,
                                height: 30,
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
                  CompositedTransformTarget(
                    link: _filterLink,
                    child: OverlayPortal(
                      controller: _filterPortalController,
                      overlayChildBuilder: (context) => Stack(
                        children: [
                          Positioned.fill(
                            child: GestureDetector(
                              behavior: HitTestBehavior.translucent,
                              onTap: _toggleFilterOpen,
                            ),
                          ),
                          CompositedTransformFollower(
                            link: _filterLink,
                            showWhenUnlinked: false,
                            targetAnchor: Alignment.bottomRight,
                            followerAnchor: Alignment.topRight,
                            offset: const Offset(0, AppTheme.s8),
                            child: Align(
                              alignment: Alignment.topRight,
                              child: Material(
                                color: Colors.transparent,
                                child: _EventStatusChips(
                                  selected: _status,
                                  onSelect: _selectStatus,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                      child: _StatusFilterButton(
                        selected: _status,
                        open: _filterOpen,
                        onTap: _toggleFilterOpen,
                      ),
                    ),
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
                    padding: const EdgeInsets.only(bottom: AppTheme.s8 - 2),
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

/// One of the two From/To pills above the search bar — the same pill
/// RegisterScreen's own [_DateField] draws, so the room register and the
/// event register read as one design.
class _EventDateField extends StatelessWidget {
  final String label;
  final String value;
  final String? minDate;
  final ValueChanged<String> onPick;

  const _EventDateField({
    required this.label,
    required this.value,
    required this.onPick,
    this.minDate,
  });

  static const _months = [
    '',
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  static String _iso(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final parsed = DateTime.tryParse(value);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () async {
          final now = DateTime.now();
          final min = minDate != null ? DateTime.tryParse(minDate!) : null;
          final picked = await showAppDatePicker(
            context: context,
            initialDate: parsed ?? now,
            firstDate: min ?? DateTime(now.year - 5),
            lastDate: DateTime(now.year + 5),
          );
          if (picked == null) return;
          onPick(_iso(picked));
        },
        borderRadius: BorderRadius.circular(999),
        highlightColor: AppTheme.accent.withValues(alpha: 0.05),
        splashColor: AppTheme.accent.withValues(alpha: 0.08),
        child: Container(
          height: 50,
          padding: const EdgeInsets.symmetric(horizontal: AppTheme.s4),
          decoration: BoxDecoration(
            color: AppTheme.card,
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
              color: AppTheme.accent.withValues(alpha: 0.4),
              width: 1.3,
            ),
            boxShadow: AppTheme.subtle,
          ),
          child: Row(
            children: [
              Container(
                width: 32,
                height: 32,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppTheme.accent.withValues(alpha: 0.14),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.calendar_today_rounded,
                  size: 14,
                  color: AppTheme.accent,
                ),
              ),
              const SizedBox(width: AppTheme.s8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      label,
                      style: const TextStyle(
                        color: AppTheme.muted,
                        fontSize: 9.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    Text(
                      parsed == null
                          ? value
                          : '${parsed.day} ${_months[parsed.month]} ${parsed.year}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppTheme.heading,
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: AppTheme.s4),
            ],
          ),
        ),
      ),
    );
  }
}

/// The search bar's side filter — the exact round, badge-carrying button the
/// room register's own filter icon is drawn as, so the two registers' search
/// rows read as one design. Opens [_EventStatusChips] folded underneath it
/// rather than a menu, the same way the room register's own filter opens.
class _StatusFilterButton extends StatelessWidget {
  final String selected;
  final bool open;
  final VoidCallback onTap;

  const _StatusFilterButton({required this.selected, required this.open, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final on = selected.isNotEmpty || open;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 48,
        height: 48,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          gradient: on
              ? const LinearGradient(colors: [AppTheme.accent, AppTheme.sidebarBrand])
              : null,
          color: on ? null : AppTheme.card,
          shape: BoxShape.circle,
          border: on ? null : Border.all(color: AppTheme.shadowDark, width: 1.3),
          boxShadow: on
              ? [BoxShadow(color: AppTheme.accent.withValues(alpha: 0.3), blurRadius: 8, offset: const Offset(0, 2))]
              : AppTheme.subtle,
        ),
        child: Stack(
          clipBehavior: Clip.none,
          alignment: Alignment.center,
          children: [
            Icon(Icons.filter_alt_rounded, size: 19, color: on ? Colors.white : AppTheme.accent),
            if (selected.isNotEmpty)
              Positioned(
                top: -4,
                right: -6,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    shape: BoxShape.circle,
                    border: Border.all(color: AppTheme.accent, width: 1.2),
                  ),
                  constraints: const BoxConstraints(minWidth: 16, minHeight: 16),
                  child: const Text(
                    '1',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: AppTheme.accent, fontSize: 9, fontWeight: FontWeight.w800),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// One icon per status — a chip carries its type at a glance, the same way
/// the room register's own [_StatusChips] tell theirs apart by more than
/// a label.
const _kEventStatusIcon = <String, IconData>{
  'DRAFT': Icons.edit_note_rounded,
  'CONFIRMED': Icons.event_available_rounded,
  'SETTLED': Icons.receipt_long_rounded,
  'CANCELLED': Icons.cancel_rounded,
};

const _kEventStatusColor = <String, Color>{
  'DRAFT': AppTheme.draft,
  'CONFIRMED': Color(0xFFC0392B),
  'SETTLED': AppTheme.muted,
  'CANCELLED': AppTheme.danger,
};

/// The folded-open status panel — same card, same left-rule chips, as the
/// room register's own [_StatusChips], sized for a single pick (one status
/// or All) rather than a multi-select set.
class _EventStatusChips extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onSelect;

  const _EventStatusChips({required this.selected, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return NeuFilterPanel(
      children: [
        NeuFilterRow(
          label: 'All',
          on: selected.isEmpty,
          icon: Icons.apps_rounded,
          onTap: () => onSelect(''),
        ),
        for (final key in kEventStatusLabel.keys)
          NeuFilterRow(
            label: kEventStatusLabel[key]!,
            on: selected == key,
            color: _kEventStatusColor[key],
            icon: _kEventStatusIcon[key]!,
            onTap: () => onSelect(key),
          ),
      ],
    );
  }
}

/// One icon-and-colour pair per function type — gives each card a glance-able
/// identity beyond its title, the same way [_kEventStatusIcon] does for
/// status.
const _kEventTypeIcon = <String, IconData>{
  'BIRTHDAY': Icons.cake_rounded,
  'WEDDING': Icons.favorite_rounded,
  'RECEPTION': Icons.celebration_rounded,
  'ENGAGEMENT': Icons.diamond_rounded,
  'CORPORATE': Icons.business_center_rounded,
  'OTHER': Icons.event_rounded,
};

const _kEventTypeColor = <String, Color>{
  'BIRTHDAY': Color(0xFFE0A72E),
  'WEDDING': Color(0xFFC0392B),
  'RECEPTION': Color(0xFF9B59B6),
  'ENGAGEMENT': Color(0xFFD63384),
  'CORPORATE': Color(0xFF2F7FE4),
  'OTHER': AppTheme.accent,
};

class _EventCard extends StatelessWidget {
  final EventBooking event;
  final VoidCallback onTap;

  const _EventCard({required this.event, required this.onTap});

  Color get _statusColor => switch (event.status) {
    'DRAFT' => AppTheme.draft,
    'CONFIRMED' => const Color(0xFFC0392B),
    'SETTLED' => AppTheme.muted,
    _ => AppTheme.border,
  };

  Color get _typeColor => _kEventTypeColor[event.eventType] ?? AppTheme.accent;

  @override
  Widget build(BuildContext context) {
    final cancelled = event.status == 'CANCELLED';

    final card = NeuCard(
      onTap: onTap,
      radius: AppTheme.rMedium,
      padding: const EdgeInsets.fromLTRB(AppTheme.s8, AppTheme.s8, AppTheme.s12, AppTheme.s8),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              width: 36,
              height: 36,
              alignment: Alignment.center,
              margin: const EdgeInsets.only(top: 2),
              decoration: BoxDecoration(color: _typeColor.withValues(alpha: 0.12), shape: BoxShape.circle),
              child: Icon(_kEventTypeIcon[event.eventType] ?? Icons.event_rounded, size: 17, color: _typeColor),
            ),
            const SizedBox(width: AppTheme.s8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          event.title,
                          style: Theme.of(context).textTheme.titleSmall?.copyWith(fontSize: 13.5),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2.5),
                        decoration: BoxDecoration(color: _statusColor.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
                        child: Text(
                          kEventStatusLabel[event.status] ?? event.status,
                          style: TextStyle(color: _statusColor, fontSize: 9.5, fontWeight: FontWeight.w700),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    '${kEventTypeLabel[event.eventType] ?? event.eventType} · ${event.venueName}',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 11),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Icon(Icons.schedule_rounded, size: 11, color: AppTheme.muted),
                      const SizedBox(width: 3),
                      Flexible(
                        child: Text(
                          '${formatDateTime(event.startAt)} · ${event.organiserName}',
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppTheme.text, fontSize: 11),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Text(
                        formatPrice(event.totalAmount),
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(fontSize: 13),
                      ),
                      const Spacer(),
                      if (event.balanceDue > 0)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2.5),
                          decoration: BoxDecoration(
                            color: AppTheme.danger.withValues(alpha: 0.08),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            'Due ${formatPrice(event.balanceDue)}',
                            style: const TextStyle(color: AppTheme.danger, fontSize: 10, fontWeight: FontWeight.w700),
                          ),
                        )
                      else
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: const [
                            Icon(Icons.check_circle_rounded, size: 12, color: AppTheme.vacant),
                            SizedBox(width: 3),
                            Text('Paid', style: TextStyle(color: AppTheme.vacant, fontSize: 10, fontWeight: FontWeight.w700)),
                          ],
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );

    if (!cancelled) return card;
    return Opacity(opacity: 0.8, child: card);
  }
}
