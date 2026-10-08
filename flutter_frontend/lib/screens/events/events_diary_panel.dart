import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/event_booking.dart';
import '../../presentation/providers/usecase_provider.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'event_detail_screen.dart';
import 'event_form_screen.dart';
import 'events_list_panel.dart';

/// The neutral slate the web legend's own `.tape-legend__swatch.events-
/// legend__mark` chip is filled with — mirrors that CSS rule exactly, since
/// the in-progress/completed marks are white glyphs on this chip rather
/// than a status colour of their own.
const _markChipColor = Color(0xFF5B6875);

/// Mirrors [TapeChart]'s own `_kTapeNotReadyColor`/`_kNotReadyLabel` and the
/// web diary's `--tape-notready`/`NOT_READY` — the housekeeping statuses
/// that mean a venue isn't ready for its next function yet, and the one
/// brown both charts (room and event) share for them.
const _kTapeNotReadyColor = Color(0xFF8B5E3C);
const _kNotReadyLabel = {
  'DIRTY': 'Needs cleaning',
  'CLEANING': 'Being cleaned',
  'OUT_OF_ORDER': 'Under repair',
};

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

  // Square and responsive, computed in build() from the available width —
  // the same wide-breakpoint rule [TapeChart] scales its own room tiles by,
  // so a function's day box lands at the exact size a room's night tile does.
  double _tile = 32.0;
  static const _venueCol = 72.0;
  double _rowHeight = 32.0;
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

  /// Venues housekeeping says are not ready right now, by venue id — mirrors
  /// [TapeChart]'s own `_notReady` and the web diary's `notReady` state.
  /// Empty until the board answers, and for good at a property without
  /// Housekeeping, where the request fails and the chart shows nothing extra.
  Map<int, ({String label, String note})> _notReady = const {};
  /// Whether the housekeeping board has answered at all yet — distinct from
  /// `_notReady` being empty, which just means nothing is unready right now.
  /// The legend's own "Not ready" chip only shows once this is true, the
  /// same way the web legend's `{notReady && (...)}` only renders once its
  /// `notReady` state has gone from null to a (possibly empty) Map.
  bool _notReadyLoaded = false;
  Timer? _hkTimer;

  Future<void> _loadNotReady() async {
    try {
      final venues = await ref.read(housekeepingUsecaseProvider).venues();
      if (!mounted) return;
      setState(() {
        _notReadyLoaded = true;
        _notReady = {
          for (final v in venues)
            if (_kNotReadyLabel[v.status] != null)
              v.id: (
                label: _kNotReadyLabel[v.status]!,
                note: v.status == 'OUT_OF_ORDER' ? (v.outOfOrderNote ?? '') : '',
              ),
        };
      });
    } catch (_) {
      // Silent, same as the web: a property without Housekeeping simply
      // shows nothing extra on the chart.
    }
  }

  static DateTime _today() {
    final now = DateTime.now();
    return DateTime(now.year, now.month, now.day);
  }

  late DateTime _start = _today().subtract(const Duration(days: _daysBefore));
  int _daysBeforeGrown = _daysBefore;
  int _daysAfterGrown = _daysAfter;

  static String _dateKey(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  late List<DateTime> _dates = List.generate(
    _windowDays,
    (i) => _start.add(Duration(days: i)),
  );

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
    _hScroll.addListener(_onScroll);
    _loadNotReady();
    _hkTimer = Timer.periodic(const Duration(seconds: 30), (_) => _loadNotReady());
  }

  @override
  void dispose() {
    _hkTimer?.cancel();
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
      _dates = List.generate(
        _dates.length + _growDays,
        (i) => _start.add(Duration(days: i)),
      );
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_hScroll.hasClients) {
        _hScroll.jumpTo(
          (_hScroll.offset + _growDays * _tile).clamp(
            0.0,
            _hScroll.position.maxScrollExtent,
          ),
        );
      }
      _growingPast = false;
    });
    _load(silent: true);
  }

  /// Later days, appended — nothing already on screen has to move for this
  /// one, since the new columns land past the current right edge.
  void _growFuture() {
    if (_growingFuture || _daysAfterGrown >= _maxDaysAfter) return;
    _growingFuture = true;
    setState(() {
      _daysAfterGrown += _growDays;
      _dates = List.generate(
        _dates.length + _growDays,
        (i) => _start.add(Duration(days: i)),
      );
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => _growingFuture = false);
    _load(silent: true);
  }

  Future<void> _load({bool silent = false}) {
    return ref
        .read(eventsViewModelProvider.notifier)
        .loadEvents(
          fromDate: _dateKey(_dates.first),
          toDate: _dateKey(_dates.last),
          includeClosed: true,
          silent: silent,
        );
  }

  void _scrollToToday({bool animate = true}) {
    if (!_hScroll.hasClients) return;
    // One tile of margin before today, the same "just landed, not flush
    // against the edge" spot TapeChart's own jump leaves.
    final target = (_tile * (_daysBeforeGrown - 1)).clamp(
      0.0,
      _hScroll.position.maxScrollExtent,
    );
    if (animate) {
      _hScroll.animateTo(
        target,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOut,
      );
    } else {
      _hScroll.jumpTo(target);
    }
  }

  void _step(int days) {
    if (!_hScroll.hasClients) return;
    final target = (_hScroll.offset + days * _tile).clamp(
      0.0,
      _hScroll.position.maxScrollExtent,
    );
    _hScroll.animateTo(
      target,
      duration: const Duration(milliseconds: 250),
      curve: Curves.easeOut,
    );
  }

  static const _monthName = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
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

  /// The exact EVENT_STATUS_COLOR palette from eventFormat.js on the
  /// website, so a function reads the same colour on both surfaces. DRAFT,
  /// CONFIRMED and SETTLED already match [AppTheme]'s own draft/reserved/
  /// stayed tokens hex-for-hex; CANCELLED has no equivalent app token (the
  /// app's own `border` is a near-white divider colour, not a status one),
  /// so it is spelled out here instead.
  static const _cancelledColor = Color(0xFFCFD6DD);

  Color _statusColor(String status) => switch (status) {
    'DRAFT' => AppTheme.draft,
    'CONFIRMED' => AppTheme.reserved,
    'SETTLED' => AppTheme.stayed,
    'CANCELLED' => _cancelledColor,
    _ => _cancelledColor,
  };

  bool _isClosed(String status) => status == 'CANCELLED';

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(eventsViewModelProvider);
    final venues = state.venues.where((v) => v.isActive).toList();
    final today = _today();

    // Compact on a phone, roomier on a tablet — the same breakpoint
    // [TapeChart] scales its own room tiles by, so a function's day box
    // comes out the same size as a room's night tile at every width.
    final wide = MediaQuery.sizeOf(context).width >= 700;
    _rowHeight = wide ? 41.6 : 32.0;
    _tile = _rowHeight;

    // venueId → dateKey → functions touching it, in start order.
    final cells = <int, Map<String, List<EventBooking>>>{};
    for (final ev in state.events) {
      if (!_showClosed && _isClosed(ev.status)) continue;
      final byDay = cells.putIfAbsent(ev.venueId, () => {});
      for (final key in _dayKeys(ev)) {
        byDay.putIfAbsent(key, () => []).add(ev);
      }
    }
    final rows = venues
        .where((v) => v.isActive || cells.containsKey(v.id))
        .toList();

    // The function a not-ready venue is waiting to be cleaned after — mirrors
    // Events.jsx's own `awaitingClean`: the last CONFIRMED/SETTLED function at
    // a not-ready venue to have ended today or yesterday, by its booked end or
    // by the desk marking it completed. Its tile keeps its status colour
    // nowhere else; this is the one spot it gives way to the not-ready brown.
    final awaitingClean = <int>{};
    if (_notReady.isNotEmpty) {
      final now = DateTime.now();
      final since = today.subtract(const Duration(days: 1));
      final last = <int, ({int eventId, DateTime over})>{};
      for (final ev in state.events) {
        if ((ev.status != 'CONFIRMED' && ev.status != 'SETTLED') || !_notReady.containsKey(ev.venueId)) continue;
        final end = DateTime.tryParse(ev.endAt)?.toLocal();
        if (end == null) continue;
        final completed = ev.completedAt != null ? DateTime.tryParse(ev.completedAt!)?.toLocal() : null;
        final over = (completed != null && completed.isBefore(end)) ? completed : end;
        if (over.isAfter(now)) continue;
        final overDay = DateTime(over.year, over.month, over.day);
        if (overDay.isBefore(since)) continue;
        final seen = last[ev.venueId];
        if (seen == null || over.isAfter(seen.over)) {
          last[ev.venueId] = (eventId: ev.id, over: over);
        }
      }
      for (final v in last.values) {
        awaitingClean.add(v.eventId);
      }
    }

    // Matches the grid's own content height exactly — date head, its
    // divider, every venue row and the dividers between them, plus the 10px
    // the scrollbar's thumb sits in below — so an arrow pinned to the
    // bottom of a box this tall lands right beside that thumb rather than
    // at some hand-tuned pixel guess.
    final gridContentHeight =
        _dateHeadHeight + 1 + rows.length * _rowHeight + (rows.isEmpty ? 0 : (rows.length - 1)) + 10;

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

    return Stack(
      fit: StackFit.expand,
      children: [
        Column(
          children: [
            const SizedBox(height: AppTheme.s8),
            Expanded(
              child: state.isLoading && state.events.isEmpty
                  ? const Center(child: CircularProgressIndicator())
                  : rows.isEmpty
                  ? const Center(
                      child: Padding(
                        padding: EdgeInsets.all(24),
                        child: Text(
                          'Add a venue on the Setup tab first.',
                          style: TextStyle(color: AppTheme.muted),
                        ),
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      color: AppTheme.accent,
                      child: SingleChildScrollView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.fromLTRB(
                          AppTheme.s16,
                          0,
                          AppTheme.s16,
                          AppTheme.s16,
                        ),
                        child: NeuCard(
                              padding: EdgeInsets.zero,
                              radius: AppTheme.rMedium,
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  // Card head — mirrors the web card's own "Function
                                  // diary" title and venue count.
                                  Padding(
                                    padding: const EdgeInsets.fromLTRB(
                                      AppTheme.s12,
                                      AppTheme.s12,
                                      AppTheme.s12,
                                      2,
                                    ),
                                    child: Row(
                                      children: [
                                        const Text(
                                          'Function diary',
                                          style: TextStyle(
                                            color: AppTheme.heading,
                                            fontWeight: FontWeight.w700,
                                            fontSize: 15,
                                          ),
                                        ),
                                        const SizedBox(width: 8),
                                        Container(
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 8,
                                            vertical: 2,
                                          ),
                                          decoration: BoxDecoration(
                                            color: AppTheme.bg,
                                            borderRadius: BorderRadius.circular(
                                              999,
                                            ),
                                            border: Border.all(
                                              color: AppTheme.border,
                                            ),
                                          ),
                                          child: Text(
                                            '${rows.length} venue${rows.length == 1 ? '' : 's'}',
                                            style: const TextStyle(
                                              color: AppTheme.text,
                                              fontSize: 10.5,
                                              fontWeight: FontWeight.w600,
                                            ),
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
                                    padding: const EdgeInsets.fromLTRB(
                                      AppTheme.s12,
                                      0,
                                      AppTheme.s12,
                                      AppTheme.s8,
                                    ),
                                    child: Row(
                                      children: [
                                        Flexible(
                                          child: Text(
                                            '${state.events.where((e) => !_isClosed(e.status)).length} function${state.events.where((e) => !_isClosed(e.status)).length == 1 ? '' : 's'} in view',
                                            style: Theme.of(
                                              context,
                                            ).textTheme.labelSmall,
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                          ),
                                        ),
                                        const Spacer(),
                                        GestureDetector(
                                          onTap: () => setState(
                                            () => _showClosed = !_showClosed,
                                          ),
                                          child: Row(
                                            mainAxisSize: MainAxisSize.min,
                                            children: [
                                              Icon(
                                                _showClosed
                                                    ? Icons.check_box_rounded
                                                    : Icons
                                                          .check_box_outline_blank_rounded,
                                                size: 15,
                                                color: AppTheme.muted,
                                              ),
                                              const SizedBox(width: 4),
                                              Text(
                                                'Show cancelled',
                                                style: Theme.of(
                                                  context,
                                                ).textTheme.labelSmall,
                                              ),
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
                                    padding: const EdgeInsets.fromLTRB(
                                      AppTheme.s12,
                                      0,
                                      AppTheme.s12,
                                      AppTheme.s8,
                                    ),
                                    child: Wrap(
                                      spacing: 8,
                                      runSpacing: 6,
                                      crossAxisAlignment:
                                          WrapCrossAlignment.center,
                                      children: [
                                        const _LegendChip(
                                          color: AppTheme.vacant,
                                          label: 'Vacant',
                                          outlined: true,
                                        ),
                                        // Only where Housekeeping is on, and so
                                        // has something to say — mirrors the web
                                        // legend's own `{notReady && (...)}`.
                                        if (_notReadyLoaded)
                                          const _LegendChip(
                                            color: _kTapeNotReadyColor,
                                            label: 'Not ready',
                                          ),
                                        // Same walk a function takes as the web
                                        // diary's own DIARY_STATUSES — each is a
                                        // button that opens that status's cut of
                                        // the List tab, the touch equivalent of
                                        // Events.jsx's onShowList.
                                        for (final status in const [
                                          'CONFIRMED',
                                          'SETTLED',
                                          'DRAFT',
                                          'CANCELLED',
                                        ])
                                          _LegendChip(
                                            color: _statusColor(status),
                                            label:
                                                kEventStatusLabel[status] ??
                                                status,
                                            onTap: () => Navigator.of(
                                              context,
                                            ).push(
                                              MaterialPageRoute(
                                                builder: (_) => Scaffold(
                                                  appBar: AppBar(
                                                    title: const Text(
                                                      'Event register',
                                                    ),
                                                  ),
                                                  body: EventsListPanel(
                                                    initialStatus: status,
                                                  ),
                                                ),
                                              ),
                                            ),
                                          ),
                                        // The two marks a tile can carry on top
                                        // of its status colour — static, since
                                        // neither is itself a filter. Drawn on
                                        // the same neutral slate chip the web
                                        // legend's own events-legend__mark
                                        // uses, rather than a status colour,
                                        // since the mark (not the chip) is
                                        // what carries the meaning here.
                                        const _LegendChip(
                                          color: _markChipColor,
                                          label: 'In progress',
                                        ),
                                        const _LegendChip(
                                          color: _markChipColor,
                                          label: 'Completed',
                                        ),
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
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: AppTheme.s12,
                                    ),
                                    decoration: const BoxDecoration(
                                      color: AppTheme.bg,
                                      border: Border(
                                        bottom: BorderSide(
                                          color: AppTheme.border,
                                        ),
                                      ),
                                    ),
                                    child: Row(
                                      children: [
                                        Text(
                                          _visibleIndex < _dates.length
                                              ? '${_monthName[_dates[_visibleIndex].month - 1].toUpperCase()} ${_dates[_visibleIndex].year}'
                                              : '',
                                          style: const TextStyle(
                                            color: AppTheme.heading,
                                            fontSize: 11.5,
                                            fontWeight: FontWeight.w700,
                                            letterSpacing: 0.3,
                                          ),
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
                                              padding:
                                                  const EdgeInsets.symmetric(
                                                    horizontal: 8,
                                                    vertical: 3,
                                                  ),
                                              decoration: BoxDecoration(
                                                color: AppTheme.accent
                                                    .withValues(alpha: 0.12),
                                                borderRadius:
                                                    BorderRadius.circular(999),
                                                border: Border.all(
                                                  color: AppTheme.accent
                                                      .withValues(alpha: 0.4),
                                                ),
                                              ),
                                              child: const Text(
                                                'Today',
                                                style: TextStyle(
                                                  color: AppTheme.accent,
                                                  fontSize: 10.5,
                                                  fontWeight: FontWeight.w700,
                                                ),
                                              ),
                                            ),
                                          ),
                                      ],
                                    ),
                                  ),
                                  // The venue column pinned outside the scroll, the
                                  // date grid the one thing that moves — same split
                                  // TapeChart's own room column and night grid keep.
                                  Row(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      SizedBox(
                                        width: _venueCol,
                                        child: Column(
                                          children: [
                                            Container(
                                              height: _dateHeadHeight,
                                              alignment: Alignment.centerLeft,
                                              padding: const EdgeInsets.only(
                                                left: 8,
                                              ),
                                              child: const Text(
                                                'Venue',
                                                style: TextStyle(
                                                  color: AppTheme.muted,
                                                  fontSize: 10.5,
                                                  fontWeight: FontWeight.w700,
                                                ),
                                              ),
                                            ),
                                            const Divider(
                                              height: 1,
                                              color: AppTheme.border,
                                            ),
                                            for (
                                              var i = 0;
                                              i < rows.length;
                                              i++
                                            ) ...[
                                              if (i > 0)
                                                const Divider(
                                                  height: 1,
                                                  color: AppTheme.border,
                                                ),
                                              Container(
                                                height: _rowHeight,
                                                alignment: Alignment.centerLeft,
                                                padding:
                                                    const EdgeInsets.symmetric(
                                                      horizontal: 8,
                                                    ),
                                                color: i.isOdd
                                                    ? AppTheme.bg.withValues(
                                                        alpha: 0.5,
                                                      )
                                                    : null,
                                                child: Column(
                                                  mainAxisAlignment:
                                                      MainAxisAlignment.center,
                                                  crossAxisAlignment:
                                                      CrossAxisAlignment.start,
                                                  mainAxisSize:
                                                      MainAxisSize.min,
                                                  children: [
                                                    Text(
                                                      rows[i].name,
                                                      style: const TextStyle(
                                                        color: AppTheme.heading,
                                                        fontSize: 11.5,
                                                        fontWeight:
                                                            FontWeight.w700,
                                                        height: 1.0,
                                                      ),
                                                      maxLines: 1,
                                                      overflow:
                                                          TextOverflow.ellipsis,
                                                    ),
                                                    if (rows[i].capacityPax !=
                                                        null)
                                                      Text(
                                                        'up to ${rows[i].capacityPax}',
                                                        style: const TextStyle(
                                                          color: AppTheme.muted,
                                                          fontSize: 9.5,
                                                          height: 1.0,
                                                        ),
                                                      ),
                                                  ],
                                                ),
                                              ),
                                            ],
                                          ],
                                        ),
                                      ),
                                      Container(
                                        width: 1,
                                        color: AppTheme.border,
                                      ),
                                      SizedBox(
                                        height: gridContentHeight,
                                        child: Align(
                                          alignment: Alignment.bottomLeft,
                                          child: _ScrollArrow(
                                            icon: Icons.chevron_left_rounded,
                                            onTap: () => _step(-5),
                                          ),
                                        ),
                                      ),
                                      Expanded(
                                        child: Scrollbar(
                                          controller: _hScroll,
                                          thumbVisibility: true,
                                          trackVisibility: true,
                                          child: SingleChildScrollView(
                                            controller: _hScroll,
                                            scrollDirection: Axis.horizontal,
                                            padding: const EdgeInsets.only(
                                              bottom: 10,
                                            ),
                                            child: Column(
                                              children: [
                                                SizedBox(
                                                  height: _dateHeadHeight,
                                                  child: Row(
                                                    children: [
                                                      for (final d in _dates)
                                                        _DateHead(
                                                          date: d,
                                                          today: today,
                                                          width: _tile,
                                                        ),
                                                    ],
                                                  ),
                                                ),
                                                const Divider(
                                                  height: 1,
                                                  color: AppTheme.border,
                                                ),
                                                for (
                                                  var i = 0;
                                                  i < rows.length;
                                                  i++
                                                ) ...[
                                                  if (i > 0)
                                                    const Divider(
                                                      height: 1,
                                                      color: AppTheme.border,
                                                    ),
                                                  Container(
                                                    height: _rowHeight,
                                                    color: i.isOdd
                                                        ? AppTheme.bg
                                                              .withValues(
                                                                alpha: 0.5,
                                                              )
                                                        : null,
                                                    child: Row(
                                                      children: [
                                                        for (final d in _dates)
                                                          _cell(
                                                            rows[i].id,
                                                            rows[i].name,
                                                            d,
                                                            d == today,
                                                            cells[rows[i]
                                                                    .id]?[_dateKey(
                                                                  d,
                                                                )] ??
                                                                const [],
                                                            cells[rows[i].id],
                                                            awaitingClean,
                                                          ),
                                                      ],
                                                    ),
                                                  ),
                                                ],
                                              ],
                                            ),
                                          ),
                                        ),
                                      ),
                                      SizedBox(
                                        height: gridContentHeight,
                                        child: Align(
                                          alignment: Alignment.bottomRight,
                                          child: _ScrollArrow(
                                            icon: Icons.chevron_right_rounded,
                                            onTap: () => _step(5),
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                      ),
                    ),
            ),
          ],
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

  static const _monthBandHeight = 28.0;

  Widget _cell(
    int venueId,
    String venueName,
    DateTime d,
    bool isToday,
    List<EventBooking> events,
    Map<String, List<EventBooking>>? venueDays,
    Set<int> awaitingClean,
  ) {
    // A fact about now, so it colours today's column and no other day — same
    // rule the web diary's own `d === today && notReady?.has(...)` follows.
    final notReadyHere = isToday && _notReady.containsKey(venueId);
    if (events.isEmpty) {
      return _DiaryTile(
        tile: _tile,
        rowHeight: _rowHeight,
        onTap: () async {
          await Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => EventFormScreen(
                initialDate: _dateKey(d),
                initialVenueId: venueId,
              ),
            ),
          );
          _load();
        },
        onLongPress: () => _showVacantInfo(d, venueName, notReadyHere ? _notReady[venueId] : null),
        child: Container(
          decoration: BoxDecoration(
            color: notReadyHere ? _kTapeNotReadyColor : AppTheme.vacant.withValues(alpha: 0.16),
            borderRadius: BorderRadius.circular(6),
            border: Border.all(
              color: notReadyHere
                  ? _kTapeNotReadyColor
                  : isToday
                  ? AppTheme.accent
                  : AppTheme.vacant.withValues(alpha: 0.35),
              width: isToday ? 1.4 : 1,
            ),
          ),
        ),
      );
    }
    final ev = events.first;
    final notReadyTile = awaitingClean.contains(ev.id);
    final color = notReadyTile ? _kTapeNotReadyColor : _statusColor(ev.status);

    // A function's own nights are never rounded or gapped except at the two
    // ends of its run, so a multi-day function reads as one continuous bar
    // across the days it spans — the same rule [TapeChart]'s own [_Tile]
    // applies to a stay's nights.
    bool sameEvent(List<EventBooking>? day) =>
        day != null && day.any((e) => e.id == ev.id);
    final isRunStart = !sameEvent(venueDays?[_dateKey(d.subtract(const Duration(days: 1)))]);
    final isRunEnd = !sameEvent(venueDays?[_dateKey(d.add(const Duration(days: 1)))]);

    // Same flat-fill vocabulary as TapeChart's own [_Tile]: one solid colour,
    // an initial when there's room, no gradient or shadow doing the work
    // colour and shape already do.
    return _DiaryTile(
      tile: _tile,
      rowHeight: _rowHeight,
      padding: EdgeInsets.only(
        top: 3,
        bottom: 3,
        left: isRunStart ? 3 : 0,
        right: isRunEnd ? 3 : 0,
      ),
      onTap: () async {
        await Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => EventDetailScreen(eventId: ev.id)),
        );
        _load();
      },
      onLongPress: () => _showEventInfo(ev, notReady: notReadyTile),
      child: Container(
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.horizontal(
            left: isRunStart ? const Radius.circular(6) : Radius.zero,
            right: isRunEnd ? const Radius.circular(6) : Radius.zero,
          ),
        ),
        alignment: Alignment.center,
        padding: const EdgeInsets.symmetric(horizontal: 2),
        child: isRunStart
            ? Text(
                ev.title.isEmpty ? '' : ev.title[0].toUpperCase(),
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
              )
            : null,
      ),
    );
  }

  /// The touch equivalent of the web diary's own hover tooltip for an empty
  /// day — mirrors [TapeChart]'s own `_showNightInfo`, so a long-press on
  /// either chart opens the same family of dialog.
  void _showVacantInfo(DateTime d, String venueName, ({String label, String note})? notReady) {
    final color = notReady != null ? _kTapeNotReadyColor : AppTheme.vacant;
    showDialog<void>(
      context: context,
      builder: (_) => Dialog(
        backgroundColor: AppTheme.bg,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.rLarge)),
        insetPadding: const EdgeInsets.symmetric(horizontal: AppTheme.s16, vertical: AppTheme.s24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Padding(
            padding: const EdgeInsets.all(AppTheme.s16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(width: 8, height: 8, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
                    const SizedBox(width: AppTheme.s8),
                    Text(
                      notReady != null ? 'Vacant · ${notReady.label}' : 'Vacant',
                      style: TextStyle(color: color, fontSize: 11.5, fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(venueName, style: const TextStyle(color: AppTheme.heading, fontSize: 17, fontWeight: FontWeight.w700)),
                const SizedBox(height: 2),
                Text(formatDate(d), style: const TextStyle(color: AppTheme.text, fontSize: 13, fontWeight: FontWeight.w600)),
                if (notReady != null && notReady.note.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(notReady.note, style: const TextStyle(color: AppTheme.muted, fontSize: 12.5)),
                ],
                const SizedBox(height: AppTheme.s16),
                const Text('Tap to book a function on this day', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// A booked function's long-press peek — title, venue, status and time,
  /// the touch equivalent of the web diary's own hover tooltip over a
  /// coloured segment.
  void _showEventInfo(EventBooking ev, {bool notReady = false}) {
    final color = notReady ? _kTapeNotReadyColor : _statusColor(ev.status);
    showDialog<void>(
      context: context,
      builder: (_) => Dialog(
        backgroundColor: AppTheme.bg,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.rLarge)),
        insetPadding: const EdgeInsets.symmetric(horizontal: AppTheme.s16, vertical: AppTheme.s24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Padding(
            padding: const EdgeInsets.all(AppTheme.s16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(width: 8, height: 8, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
                    const SizedBox(width: AppTheme.s8),
                    Text(
                      kEventStatusLabel[ev.status] ?? ev.status,
                      style: TextStyle(color: color, fontSize: 11.5, fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  ev.title.isEmpty ? (kEventTypeLabel[ev.eventType] ?? ev.eventType) : ev.title,
                  style: const TextStyle(color: AppTheme.heading, fontSize: 17, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 2),
                Text(
                  '${ev.venueName}${ev.venueCapacity != null ? ' (up to ${ev.venueCapacity})' : ''}${notReady ? ' · venue not ready' : ''}',
                  style: const TextStyle(color: AppTheme.muted, fontSize: 12.5),
                ),
                const SizedBox(height: 6),
                Text(
                  '${formatDateTime(ev.startAt)} – ${formatTimeOfDay(ev.endAt)}',
                  style: const TextStyle(color: AppTheme.text, fontSize: 13, fontWeight: FontWeight.w600),
                ),
                if (ev.organiserName.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(ev.organiserName, style: const TextStyle(color: AppTheme.muted, fontSize: 12.5)),
                ],
                const SizedBox(height: AppTheme.s16),
                const Text('Tap to open the full function detail', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// One diary cell — vacant or booked. Long press has to survive sitting
/// inside the diary's own horizontal [SingleChildScrollView] the same way a
/// [TapeChart] night tile does: [GestureDetector]'s built-in long-press
/// recognizer and the scroll view's drag recognizer share one gesture
/// arena, and the drag recognizer routinely wins first on the tiniest
/// finger wobble, silently swallowing the press. [Listener] sits outside
/// that arena — it sees every raw pointer event regardless of who wins it —
/// so the long press is timed by hand here instead, mirroring
/// [TapeChart]'s own `_TileState`.
class _DiaryTile extends StatefulWidget {
  final double tile;
  final double rowHeight;
  final EdgeInsets padding;
  final VoidCallback onTap;
  final VoidCallback onLongPress;
  final Widget child;

  const _DiaryTile({
    required this.tile,
    required this.rowHeight,
    this.padding = const EdgeInsets.all(3),
    required this.onTap,
    required this.onLongPress,
    required this.child,
  });

  @override
  State<_DiaryTile> createState() => _DiaryTileState();
}

class _DiaryTileState extends State<_DiaryTile> {
  static const _longPressDuration = Duration(milliseconds: 500);
  static const _moveSlop = 20.0;

  Offset? _downPosition;
  Timer? _longPressTimer;
  bool _longPressFired = false;

  @override
  void dispose() {
    _longPressTimer?.cancel();
    super.dispose();
  }

  void _onPointerDown(PointerDownEvent event) {
    _downPosition = event.position;
    _longPressFired = false;
    _longPressTimer?.cancel();
    _longPressTimer = Timer(_longPressDuration, () {
      _longPressTimer = null;
      _longPressFired = true;
      widget.onLongPress();
    });
  }

  void _onPointerMove(PointerMoveEvent event) {
    final start = _downPosition;
    if (start == null || _longPressTimer == null) return;
    if ((event.position - start).distance > _moveSlop) {
      _longPressTimer?.cancel();
      _longPressTimer = null;
    }
  }

  void _onPointerUp(PointerUpEvent event) {
    _longPressTimer?.cancel();
    _longPressTimer = null;
  }

  void _onPointerCancel(PointerCancelEvent event) {
    _longPressTimer?.cancel();
    _longPressTimer = null;
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      onPointerDown: _onPointerDown,
      onPointerMove: _onPointerMove,
      onPointerUp: _onPointerUp,
      onPointerCancel: _onPointerCancel,
      child: GestureDetector(
        onTap: () {
          // A long press that just fired must not also register as the tap
          // its own pointer-up otherwise completes.
          if (_longPressFired) {
            _longPressFired = false;
            return;
          }
          widget.onTap();
        },
        child: Container(
          width: widget.tile,
          height: widget.rowHeight,
          padding: widget.padding,
          child: widget.child,
        ),
      ),
    );
  }
}

/// One pill in the diary's colour legend — mirrors the web diary's own
/// `tape-legend__item`: a soft colour-tinted pill with a dot, [onTap]
/// turning it into the same kind of button `tape-legend__item--link` is,
/// opening that status's cut of the List tab. [outlined] draws a hollow
/// ring instead of a filled dot, matching the empty "Vacant" tile.
class _LegendChip extends StatelessWidget {
  final Color color;
  final String label;
  final bool outlined;
  final VoidCallback? onTap;

  const _LegendChip({
    required this.color,
    required this.label,
    this.outlined = false,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final pill = Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: outlined ? color.withValues(alpha: 0.16) : color,
              border: outlined
                  ? Border.all(color: color.withValues(alpha: 0.6))
                  : null,
            ),
          ),
          const SizedBox(width: 5),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 10.5,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
    if (onTap == null) return pill;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(999),
      child: pill,
    );
  }
}

/// One of the two arrows riding the card's own bottom edge — the same
/// step-by-a-few-days control the web diary's stepper offers. A bare icon,
/// no circle chrome or elevation behind it, so it reads as part of the
/// scrollbar track rather than a button floating in a little box on top of it.
class _ScrollArrow extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;

  const _ScrollArrow({required this.icon, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(2),
        child: Icon(icon, size: 14, color: AppTheme.muted),
      ),
    );
  }
}

class _DateHead extends StatelessWidget {
  final DateTime date;
  final DateTime today;
  final double width;

  const _DateHead({
    required this.date,
    required this.today,
    required this.width,
  });

  @override
  Widget build(BuildContext context) {
    final isToday = date == today;
    final isWeekend =
        date.weekday == DateTime.saturday || date.weekday == DateTime.sunday;
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
              color: isToday
                  ? AppTheme.accent
                  : (isWeekend ? const Color(0xFFC0392B) : AppTheme.muted),
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
            decoration: isToday
                ? const BoxDecoration(
                    color: AppTheme.accent,
                    shape: BoxShape.circle,
                  )
                : null,
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
