import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/event_booking.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'event_detail_screen.dart';
import 'event_form_screen.dart';

/// Events & functions > Diary — drawn the same way [TapeChart] draws rooms:
/// a pinned column of names down the left, days running sideways under one
/// drag-scrollable strip, a function filling its status colour across the
/// day it runs, "Today" snapping the strip back. The window grows as the
/// desk drags near either edge, exactly like [TapeChart]'s own room grid —
/// there is no fixed end to how far back or forward this can be scrolled.
class EventsDiaryPanel extends ConsumerStatefulWidget {
  const EventsDiaryPanel({super.key});

  @override
  ConsumerState<EventsDiaryPanel> createState() => _EventsDiaryPanelState();
}

class _EventsDiaryPanelState extends ConsumerState<EventsDiaryPanel> {
  static const _daysBefore = 5;
  static const _daysAfter = 40;
  static const _windowDays = _daysBefore + _daysAfter;

  /// How many more days are added each time the strip is dragged near an
  /// edge, and how close to that edge counts as "near it" — the same pair
  /// of numbers [TapeChart] calls WINDOW_DAYS/GROW_WITHIN_PX on the web.
  static const _growDays = 30;
  static const _growWithinTiles = 3;

  /// A window this wide costs almost nothing to hold in memory (it's a list
  /// of DateTimes and a handful of widgets, not rows of room data), so the
  /// cap exists only to stop a very long, very fast fling from growing the
  /// list without bound — a desk dragging for an hour straight is not a
  /// case worth optimising for.
  static const _maxDaysBefore = 1000;
  static const _maxDaysAfter = 1000;

  static const _tile = 32.0;
  static const _venueCol = 72.0;
  static const _rowHeight = 36.0;
  static const _dateHeadHeight = 32.0;

  final _hScroll = ScrollController();
  bool _showClosed = false;
  bool _scrolledToToday = false;
  bool _growingPast = false;
  bool _growingFuture = false;

  /// Whether today's own column is currently on screen — tracked the same
  /// way [TapeChart] tracks it, so the "Today" pill only ever shows once
  /// there is actually somewhere for it to take the desk back to, instead
  /// of sitting there permanently as a second, redundant label.
  bool _todayVisible = true;

  static DateTime _today() {
    final now = DateTime.now();
    return DateTime(now.year, now.month, now.day);
  }

  late DateTime _start = _today().subtract(const Duration(days: _daysBefore));
  int _daysBeforeGrown = _daysBefore;
  int _daysAfterGrown = _daysAfter;

  static String _dateKey(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  late List<DateTime> _dates = List.generate(_windowDays, (i) => _start.add(Duration(days: i)));

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
    _hScroll.addListener(_onScroll);
  }

  @override
  void dispose() {
    _hScroll.removeListener(_onScroll);
    _hScroll.dispose();
    super.dispose();
  }

  /// Whichever date sits at the left edge of the visible strip right now —
  /// the same reading [_DateHeaderState] takes in tape_chart.dart to decide
  /// what its own frozen corner label says.
  int _visibleIndex = 0;

  void _onScroll() {
    if (!_hScroll.hasClients || !_hScroll.position.haveDimensions) return;

    final near = _tile * _growWithinTiles;
    if (_hScroll.offset < near) {
      _growPast();
    } else if (_hScroll.position.maxScrollExtent - _hScroll.offset < near) {
      _growFuture();
    }

    final index = (_hScroll.offset / _tile).floor().clamp(0, _dates.length - 1);
    if (index != _visibleIndex) setState(() => _visibleIndex = index);

    final todayIndex = _dates.indexWhere((d) => d == _today());
    if (todayIndex < 0) return;
    final left = todayIndex * _tile;
    final right = left + _tile;
    final viewLeft = _hScroll.offset;
    final viewRight = viewLeft + _hScroll.position.viewportDimension;
    final visible = right > viewLeft && left < viewRight;
    if (visible != _todayVisible) setState(() => _todayVisible = visible);
  }

  /// Earlier days, prepended. The strip's own offset moves along with them
  /// so the desk's current view doesn't lurch forward the instant new
  /// columns appear to its left — the same compensation [TapeChart]'s own
  /// `growPast` does by measuring `scrollWidth` before and after; here the
  /// tile width is a fixed constant, so the shift is just `added * tile`.
  void _growPast() {
    if (_growingPast || _daysBeforeGrown >= _maxDaysBefore) return;
    _growingPast = true;
    setState(() {
      _start = _start.subtract(const Duration(days: _growDays));
      _daysBeforeGrown += _growDays;
      _dates = List.generate(_dates.length + _growDays, (i) => _start.add(Duration(days: i)));
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_hScroll.hasClients) {
        _hScroll.jumpTo((_hScroll.offset + _growDays * _tile).clamp(0.0, _hScroll.position.maxScrollExtent));
      }
      _growingPast = false;
    });
    _load();
  }

  /// Later days, appended — nothing already on screen has to move for this
  /// one, since the new columns land past the current right edge.
  void _growFuture() {
    if (_growingFuture || _daysAfterGrown >= _maxDaysAfter) return;
    _growingFuture = true;
    setState(() {
      _daysAfterGrown += _growDays;
      _dates = List.generate(_dates.length + _growDays, (i) => _start.add(Duration(days: i)));
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => _growingFuture = false);
    _load();
  }

  Future<void> _load() {
    return ref.read(eventsViewModelProvider.notifier).loadEvents(
      fromDate: _dateKey(_dates.first),
      toDate: _dateKey(_dates.last),
      includeClosed: true,
    );
  }

  void _scrollToToday({bool animate = true}) {
    if (!_hScroll.hasClients) return;
    // One tile of margin before today, the same "just landed, not flush
    // against the edge" spot TapeChart's own jump leaves.
    final target = (_tile * (_daysBeforeGrown - 1)).clamp(0.0, _hScroll.position.maxScrollExtent);
    if (animate) {
      _hScroll.animateTo(target, duration: const Duration(milliseconds: 300), curve: Curves.easeOut);
    } else {
      _hScroll.jumpTo(target);
    }
  }

  void _step(int days) {
    if (!_hScroll.hasClients) return;
    final target = (_hScroll.offset + days * _tile).clamp(0.0, _hScroll.position.maxScrollExtent);
    _hScroll.animateTo(target, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
  }

  static const _monthName = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  /// Every local day an event touches — mirrors eventDayKeys in
  /// eventFormat.js, so a reception running past midnight paints both cells.
  List<String> _dayKeys(EventBooking e) {
    final start = DateTime.tryParse(e.startAt)?.toLocal();
    if (start == null) return const [];
    final end = DateTime.tryParse(e.endAt)?.toLocal() ?? start;
    var last = DateTime(end.year, end.month, end.day);
    final first = DateTime(start.year, start.month, start.day);
    if (end.hour == 0 && end.minute == 0 && last.isAfter(first)) {
      last = last.subtract(const Duration(days: 1));
    }
    final keys = <String>[];
    var cursor = first;
    while (!cursor.isAfter(last) && keys.length < 31) {
      keys.add(_dateKey(cursor));
      cursor = cursor.add(const Duration(days: 1));
    }
    return keys;
  }

  /// The same status vocabulary the web diary's legend uses (see
  /// eventFormat.js's EVENT_STATUS_COLOR) — a stand-in for [TapeChart]'s own
  /// reserved/checkedIn/stayed, since a function has no equivalent theme
  /// token of its own yet.
  Color _statusColor(String status) => switch (status) {
    'ENQUIRY' => const Color(0xFF5A8FD0),
    'TENTATIVE' => AppTheme.draft,
    'CONFIRMED' => AppTheme.reserved,
    'SETTLED' => AppTheme.stayed,
    _ => AppTheme.border,
  };

  bool _isClosed(String status) => status == 'CANCELLED' || status == 'EXPIRED';

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(eventsViewModelProvider);
    final venues = state.venues.where((v) => v.isActive).toList();
    final today = _today();

    // venueId → dateKey → functions touching it, in start order.
    final cells = <int, Map<String, List<EventBooking>>>{};
    for (final ev in state.events) {
      if (!_showClosed && _isClosed(ev.status)) continue;
      final byDay = cells.putIfAbsent(ev.venueId, () => {});
      for (final key in _dayKeys(ev)) {
        byDay.putIfAbsent(key, () => []).add(ev);
      }
    }
    final rows = venues.where((v) => v.isActive || cells.containsKey(v.id)).toList();

    // The strip opens on today the first time it has something to scroll,
    // the same "land here once, then leave the desk's own drag alone" rule
    // TapeChart's _snapToToday follows.
    if (!_scrolledToToday && !state.isLoading) {
      _scrolledToToday = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _scrollToToday(animate: false);
        _onScroll();
      });
    }

    return Column(
      children: [
        const SizedBox(height: AppTheme.s8),
        Expanded(
          child: state.isLoading && state.events.isEmpty
              ? const Center(child: CircularProgressIndicator())
              : rows.isEmpty
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(24),
                    child: Text('Add a venue on the Setup tab first.', style: TextStyle(color: AppTheme.muted)),
                  ),
                )
              : Padding(
                  padding: const EdgeInsets.fromLTRB(AppTheme.s16, 0, AppTheme.s16, AppTheme.s16),
                  child: Stack(
                    alignment: Alignment.bottomCenter,
                    children: [
                      NeuCard(
                    padding: EdgeInsets.zero,
                    radius: AppTheme.rMedium,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Card head — mirrors the web card's own "Function
                        // diary" title and venue count.
                        Padding(
                          padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s12, AppTheme.s12, 2),
                          child: Row(
                            children: [
                              const Text('Function diary', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 15)),
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(color: AppTheme.bg, borderRadius: BorderRadius.circular(999), border: Border.all(color: AppTheme.border)),
                                child: Text(
                                  '${rows.length} venue${rows.length == 1 ? '' : 's'}',
                                  style: const TextStyle(color: AppTheme.text, fontSize: 10.5, fontWeight: FontWeight.w600),
                                  maxLines: 1,
                                ),
                              ),
                            ],
                          ),
                        ),
                        // The live tally and "Show cancelled" share their
                        // own row underneath, rather than crowding onto the
                        // title's — each gets room to sit beside the other
                        // without either having to ellipsize.
                        Padding(
                          padding: const EdgeInsets.fromLTRB(AppTheme.s12, 0, AppTheme.s12, AppTheme.s8),
                          child: Row(
                            children: [
                              Flexible(
                                child: Text(
                                  '${state.events.where((e) => !_isClosed(e.status)).length} function${state.events.where((e) => !_isClosed(e.status)).length == 1 ? '' : 's'} in view',
                                  style: const TextStyle(color: AppTheme.muted, fontSize: 11),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              const Spacer(),
                              GestureDetector(
                                onTap: () => setState(() => _showClosed = !_showClosed),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(
                                      _showClosed ? Icons.check_box_rounded : Icons.check_box_outline_blank_rounded,
                                      size: 15,
                                      color: AppTheme.muted,
                                    ),
                                    const SizedBox(width: 4),
                                    const Text('Show cancelled', style: TextStyle(color: AppTheme.muted, fontSize: 11)),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                        // The colour legend — mirrors the web diary's own
                        // tape-legend row, so a desk reading either surface
                        // sees the same status → colour vocabulary.
                        Padding(
                          padding: const EdgeInsets.fromLTRB(AppTheme.s12, 0, AppTheme.s12, AppTheme.s8),
                          child: Wrap(
                            spacing: 12,
                            runSpacing: 4,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: [
                              for (final status in const ['ENQUIRY', 'TENTATIVE', 'CONFIRMED', 'SETTLED'])
                                _LegendItem(color: _statusColor(status), label: kEventStatusLabel[status] ?? status),
                              const _LegendItem(color: AppTheme.vacant, label: 'Vacant', outlined: true),
                            ],
                          ),
                        ),
                        // The sticky month band — full width, never
                        // scrolls, "Today" riding its right edge exactly
                        // the way TapeChart's own date-header band carries
                        // it. Reads off [_visibleIndex], the date currently
                        // sitting at the grid's own left edge, so it always
                        // names whichever month is actually on screen.
                        Container(
                          height: _monthBandHeight,
                          padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
                          decoration: const BoxDecoration(
                            color: AppTheme.bg,
                            border: Border(bottom: BorderSide(color: AppTheme.border)),
                          ),
                          child: Row(
                            children: [
                              Text(
                                _visibleIndex < _dates.length
                                    ? '${_monthName[_dates[_visibleIndex].month - 1].toUpperCase()} ${_dates[_visibleIndex].year}'
                                    : '',
                                style: const TextStyle(color: AppTheme.heading, fontSize: 11.5, fontWeight: FontWeight.w700, letterSpacing: 0.3),
                              ),
                              const Spacer(),
                              // Only once today has actually scrolled out of
                              // view — the same rule TapeChart's own sticky
                              // "Today" pill follows, rather than a label
                              // sitting there doing nothing the rest of the
                              // time.
                              if (!_todayVisible)
                                GestureDetector(
                                  onTap: () => _scrollToToday(),
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                    decoration: BoxDecoration(
                                      color: AppTheme.accent.withValues(alpha: 0.12),
                                      borderRadius: BorderRadius.circular(999),
                                      border: Border.all(color: AppTheme.accent.withValues(alpha: 0.4)),
                                    ),
                                    child: const Text('Today', style: TextStyle(color: AppTheme.accent, fontSize: 10.5, fontWeight: FontWeight.w700)),
                                  ),
                                ),
                            ],
                          ),
                        ),
                        // The venue column pinned outside the scroll, the
                        // date grid the one thing that moves — same split
                        // TapeChart's own room column and night grid keep.
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SizedBox(
                              width: _venueCol,
                              child: Column(
                                children: [
                                  Container(
                                    height: _dateHeadHeight,
                                    alignment: Alignment.centerLeft,
                                    padding: const EdgeInsets.only(left: 8),
                                    child: const Text(
                                      'Venue',
                                      style: TextStyle(color: AppTheme.muted, fontSize: 10.5, fontWeight: FontWeight.w700),
                                    ),
                                  ),
                                  const Divider(height: 1, color: AppTheme.border),
                                  for (var i = 0; i < rows.length; i++) ...[
                                    if (i > 0) const Divider(height: 1, color: AppTheme.border),
                                    Container(
                                      height: _rowHeight,
                                      alignment: Alignment.centerLeft,
                                      padding: const EdgeInsets.symmetric(horizontal: 8),
                                      color: i.isOdd ? AppTheme.bg.withValues(alpha: 0.5) : null,
                                      child: Column(
                                        mainAxisAlignment: MainAxisAlignment.center,
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          Text(
                                            rows[i].name,
                                            style: const TextStyle(color: AppTheme.heading, fontSize: 11.5, fontWeight: FontWeight.w700),
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                          ),
                                          if (rows[i].capacityPax != null)
                                            Text(
                                              'up to ${rows[i].capacityPax}',
                                              style: const TextStyle(color: AppTheme.muted, fontSize: 9.5),
                                            ),
                                        ],
                                      ),
                                    ),
                                  ],
                                ],
                              ),
                            ),
                            Container(width: 1, color: AppTheme.border),
                            Expanded(
                              child: Scrollbar(
                                controller: _hScroll,
                                thumbVisibility: true,
                                trackVisibility: true,
                                child: SingleChildScrollView(
                                  controller: _hScroll,
                                  scrollDirection: Axis.horizontal,
                                  padding: const EdgeInsets.only(bottom: 10),
                                  child: Column(
                                    children: [
                                      SizedBox(
                                        height: _dateHeadHeight,
                                        child: Row(
                                          children: [
                                            for (final d in _dates) _DateHead(date: d, today: today, width: _tile),
                                          ],
                                        ),
                                      ),
                                      const Divider(height: 1, color: AppTheme.border),
                                      for (var i = 0; i < rows.length; i++) ...[
                                        if (i > 0) const Divider(height: 1, color: AppTheme.border),
                                        Container(
                                          height: _rowHeight,
                                          color: i.isOdd ? AppTheme.bg.withValues(alpha: 0.5) : null,
                                          child: Row(
                                            children: [
                                              for (final d in _dates)
                                                _cell(rows[i].id, d, d == today, cells[rows[i].id]?[_dateKey(d)] ?? const []),
                                            ],
                                          ),
                                        ),
                                      ],
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: AppTheme.s4),
                      ],
                    ),
                  ),
                      Positioned(
                        left: 4,
                        bottom: 4,
                        child: _ScrollArrow(icon: Icons.chevron_left_rounded, onTap: () => _step(-5)),
                      ),
                      Positioned(
                        right: 4,
                        bottom: 4,
                        child: _ScrollArrow(icon: Icons.chevron_right_rounded, onTap: () => _step(5)),
                      ),
                    ],
                  ),
                ),
        ),
      ],
    );
  }

  static const _monthBandHeight = 28.0;

  Widget _cell(int venueId, DateTime d, bool isToday, List<EventBooking> events) {
    if (events.isEmpty) {
      return GestureDetector(
        onTap: () async {
          await Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => EventFormScreen(initialDate: _dateKey(d), initialVenueId: venueId)),
          );
          _load();
        },
        child: Container(
          width: _tile,
          height: _rowHeight,
          padding: const EdgeInsets.all(3),
          child: Container(
            decoration: BoxDecoration(
              color: AppTheme.vacant.withValues(alpha: 0.16),
              borderRadius: BorderRadius.circular(6),
              border: Border.all(
                color: isToday ? AppTheme.accent : AppTheme.vacant.withValues(alpha: 0.35),
                width: isToday ? 1.4 : 1,
              ),
            ),
          ),
        ),
      );
    }
    final ev = events.first;
    final color = _statusColor(ev.status);
    // Same flat-fill vocabulary as TapeChart's own [_Tile]: one solid colour,
    // an initial when there's room, no gradient or shadow doing the work
    // colour and shape already do.
    return GestureDetector(
      onTap: () async {
        await Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => EventDetailScreen(eventId: ev.id)),
        );
        _load();
      },
      child: Container(
        width: _tile,
        height: _rowHeight,
        padding: const EdgeInsets.all(3),
        child: Container(
          decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(6)),
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(horizontal: 2),
          child: Text(
            ev.title.isEmpty ? '' : ev.title[0].toUpperCase(),
            style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w700),
          ),
        ),
      ),
    );
  }
}

/// One swatch + label pair in the diary's colour legend. [outlined] draws a
/// hollow ring instead of a solid fill, matching the empty "Vacant" tile.
class _LegendItem extends StatelessWidget {
  final Color color;
  final String label;
  final bool outlined;

  const _LegendItem({required this.color, required this.label, this.outlined = false});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: outlined ? color.withValues(alpha: 0.16) : color,
            border: outlined ? Border.all(color: color.withValues(alpha: 0.6)) : null,
          ),
        ),
        const SizedBox(width: 4),
        Text(label, style: const TextStyle(color: AppTheme.muted, fontSize: 11)),
      ],
    );
  }
}

/// One of the two circular arrows riding the card's own bottom edge — the
/// same step-by-a-few-days control the web diary's stepper offers, sized to
/// sit over the scrollbar track rather than taking a row of its own.
class _ScrollArrow extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;

  const _ScrollArrow({required this.icon, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppTheme.card,
      shape: const CircleBorder(side: BorderSide(color: AppTheme.border)),
      elevation: 1,
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: SizedBox(
          width: 26,
          height: 26,
          child: Icon(icon, size: 16, color: AppTheme.heading),
        ),
      ),
    );
  }
}

class _DateHead extends StatelessWidget {
  final DateTime date;
  final DateTime today;
  final double width;

  const _DateHead({required this.date, required this.today, required this.width});

  @override
  Widget build(BuildContext context) {
    final isToday = date == today;
    final isWeekend = date.weekday == DateTime.saturday || date.weekday == DateTime.sunday;
    return Container(
      width: width,
      alignment: Alignment.center,
      // The same tinted background [TapeChart]'s own date header gives
      // today's column — the accent circle alone reads fine once you're
      // looking right at it, but a column-wide tint is what actually
      // catches the eye while scanning across the strip, which is the
      // whole point of a "where am I" marker.
      color: isToday ? AppTheme.accent.withValues(alpha: 0.08) : null,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            const ['M', 'T', 'W', 'T', 'F', 'S', 'S'][date.weekday - 1],
            style: TextStyle(
              color: isToday ? AppTheme.accent : (isWeekend ? const Color(0xFFC0392B) : AppTheme.muted),
              fontSize: 8,
              fontWeight: FontWeight.w700,
              height: 1,
            ),
          ),
          const SizedBox(height: 1),
          // Today's own number sits inside a filled accent circle — the same
          // pick-out the web diary's stepper gives it, rather than a tinted
          // rectangle behind the whole cell.
          Container(
            width: 18,
            height: 18,
            alignment: Alignment.center,
            decoration: isToday ? const BoxDecoration(color: AppTheme.accent, shape: BoxShape.circle) : null,
            child: Text(
              '${date.day}',
              style: TextStyle(
                color: isToday ? Colors.white : AppTheme.heading,
                fontWeight: FontWeight.w700,
                fontSize: 10.5,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

