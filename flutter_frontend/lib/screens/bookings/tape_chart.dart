import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/tape_chart.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/booking_viewmodel.dart';
import '../theme.dart';
import 'booking_detail_screen.dart';
import 'take_booking_screen.dart';

/// The tape chart: every room down the side, the chosen nights across the
/// top, coloured tiles where a stay covers a night.
///
/// The web version draws thirty columns across every category at once, which
/// a phone has no room for. This one instead shows a short window — a week by
/// default — that pages left and right, and keeps the room column pinned so a
/// long scroll never loses track of which row is which.
class TapeChart extends ConsumerStatefulWidget {
  const TapeChart({super.key});

  @override
  ConsumerState<TapeChart> createState() => _TapeChartState();
}

class _TapeChartState extends ConsumerState<TapeChart> {
  final _vScroll = ScrollController();

  /// Guards against a single drag past an edge firing [growPast] or
  /// [growFuture] many times over — one continuous overscroll emits a
  /// notification per frame.
  bool _growingPast = false;
  bool _growingFuture = false;

  /// The date header and every category's grid all scroll horizontally
  /// together, but each room row is its own draggable surface — several
  /// interactive views cannot safely share one `ScrollController` (only one
  /// of them can actually be mid-drag at a time), so this mirrors one row's
  /// drag onto every other row and the header instead of attaching them all
  /// to the same controller.
  final _hSync = _HorizontalSync();

  /// The current tile width, kept from the last build's `LayoutBuilder` so
  /// [_growPast]'s scroll compensation can convert prepended days into
  /// pixels without a `LayoutBuilder` of its own.
  double _tile = 40;

  /// Set once the chart has auto-scrolled to today on this mount, so a
  /// later rebuild (a search hit, a chip tap, the chart quietly regrowing
  /// past an edge) never yanks the desk's own scroll position back to today
  /// a second time — this only ever fires the once, right after the chart
  /// first opens on the current month.
  bool _scrolledToToday = false;

  /// One key per category band, so a chip tap can scroll straight to it — the
  /// same jump the web tape chart's own category chips do.
  final Map<String, GlobalKey> _sectionKeys = {};

  GlobalKey _keyFor(String category) =>
      _sectionKeys.putIfAbsent(category, () => GlobalKey());

  void _jumpTo(String category) {
    final ctx = _sectionKeys[category]?.currentContext;
    if (ctx == null) return;
    Scrollable.ensureVisible(
      ctx,
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeOut,
      alignment: 0,
    );
  }

  @override
  void initState() {
    super.initState();
    Future.microtask(() async {
      final vm = ref.read(bookingViewModelProvider.notifier);
      await vm.resetChartToCurrentMonth();
    });
  }

  static const _growWithinPx = 90.0;

  void _handleNearEdge(ScrollMetrics metrics, bool towardEnd) {
    if (towardEnd) {
      if (_growingFuture) return;
      _growingFuture = true;
      ref
          .read(bookingViewModelProvider.notifier)
          .growFuture()
          .whenComplete(() => _growingFuture = false);
      return;
    }
    if (_growingPast) return;
    _growingPast = true;
    final beforeFrom = ref.read(bookingViewModelProvider).chartFrom;
    ref
        .read(bookingViewModelProvider.notifier)
        .growPast()
        .whenComplete(() => _growingPast = false);
    // The chart's own `chartFrom` moves synchronously, ahead of the network
    // fetch it kicks off — so by the next frame the header and every row
    // already carry the earlier nights. Nudging the scroll offset there,
    // rather than after the fetch resolves, keeps the nights the desk was
    // already looking at in place instead of letting them jump to the newly
    // opened start for the length of the fetch.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final afterFrom = ref.read(bookingViewModelProvider).chartFrom;
      final addedDays = beforeFrom.difference(afterFrom).inDays;
      if (addedDays > 0) _hSync.shiftAllBy(addedDays * _tile);
    });
  }

  @override
  void dispose() {
    _vScroll.dispose();
    _hSync.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(bookingViewModelProvider);
    final vm = ref.read(bookingViewModelProvider.notifier);
    final dates = state.chartDates;

    return LayoutBuilder(
      builder: (context, constraints) {
        // Compact on a phone, roomier on a tablet — the same breakpoint the
        // rest of the app uses for a two-column vs one-column body.
        final wide = constraints.maxWidth >= 700;
        final tile = wide ? 56.0 : 34.0;
        final roomCol = wide ? 96.0 : 64.0;
        final rowHeight = wide ? 52.0 : 38.0;
        _tile = tile;

        return _buildBody(state, vm, dates, tile, roomCol, rowHeight);
      },
    );
  }

  Widget _buildBody(
    BookingState state,
    BookingViewModel vm,
    List<DateTime> dates,
    double tile,
    double roomCol,
    double rowHeight,
  ) {
    // The date pill and legend are ordinary scrolling content above the
    // chart itself while it is still loading, erroring, or empty — there is
    // no grid underneath them yet for a pinned header to make sense against.
    // The category chips stay out of this section even here, so the loading
    // and error states don't flash them and then pin them a moment later.
    Widget topSection() => Column(
      children: [
        _ChartHeader(
          from: state.chartFrom,
          onPrev: () => vm.shiftChart(-1),
          onNext: () => vm.shiftChart(1),
        ),
        const SizedBox(height: AppTheme.s8),
        const _Legend(),
      ],
    );

    if (state.chart.isLoading) {
      return Column(
        children: [
          topSection(),
          const Expanded(child: Center(child: CircularProgressIndicator())),
        ],
      );
    }
    if (state.chart.hasError) {
      return Column(
        children: [
          topSection(),
          Expanded(
            child: Center(
              child: Text(
                BookingViewModel.messageFor(state.chart.error!),
                style: const TextStyle(color: AppTheme.muted),
              ),
            ),
          ),
        ],
      );
    }

    final sections = state.chartSections;
    if (sections.isEmpty) {
      return Column(
        children: [
          topSection(),
          const Expanded(
            child: Center(
              child: Text(
                'No active rooms yet.',
                style: TextStyle(color: AppTheme.muted),
              ),
            ),
          ),
        ],
      );
    }

    final today = DateTime.now();
    final todayDate = DateTime(today.year, today.month, today.day);

    // The chart opens on the current month, but a month drawn from day one
    // still leaves today off to the right of a phone-width screen on any
    // date past the first week — scrolling every strip to it once, the
    // first time it appears in a loaded window, means the desk lands on
    // today without having to drag there by hand, the same as opening a
    // calendar app. Guarded so this never fires again on this mount: a
    // search hit, a chip tap, or the window quietly regrowing past an edge
    // all rebuild this same method, and none of those should yank the
    // desk's own scroll position back to today mid-visit.
    if (!_scrolledToToday) {
      final todayIndex = dates.indexWhere(
        (d) =>
            d.year == todayDate.year &&
            d.month == todayDate.month &&
            d.day == todayDate.day,
      );
      if (todayIndex != -1) {
        _scrolledToToday = true;
        final offset = (todayIndex - 1).clamp(0, dates.length - 1) * tile;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) _hSync.jumpAllTo(offset);
        });
      }
    }

    final hitIds = state.chartSearchHits.map((b) => b.id).toSet();
    final activeHitId = state.chartActiveHit?.id;

    // The date band rides the same horizontal offset as every category's own
    // grid below it, via the shared controller — scrolling one moves them
    // all together, the way a single strip would, without actually being one.
    //
    // Whichever row's own `SingleChildScrollView` is actually being dragged
    // bubbles its scroll notifications up through here regardless — Flutter
    // notifications always climb to the nearest listener above them in the
    // tree, so this one `NotificationListener` sees every row's movement
    // without needing a controller of its own. [_handleNearEdge] fires the
    // moment any of them reads within a tile or so of an edge, the same way
    // the web tape chart's own onScroll grows the window before the desk
    // has scrolled all the way into the wall — waiting for an actual
    // overscroll never fires at all on a chart wide enough to fill the
    // screen with room to spare, and looks like scrolling has simply
    // stopped instead of continuing to open more nights.
    return NotificationListener<ScrollNotification>(
      onNotification: (notification) {
        final metrics = notification.metrics;
        if (metrics.axis != Axis.horizontal || metrics.maxScrollExtent <= 0) {
          return false;
        }
        if (metrics.extentAfter < _growWithinPx) {
          _handleNearEdge(metrics, true);
        } else if (metrics.extentBefore < _growWithinPx) {
          _handleNearEdge(metrics, false);
        }
        return false;
      },
      // The pill and legend scroll away like any other content above the
      // grid — the category chips and the date header pin together at the
      // top once the desk scrolls the room list up past them, the same way
      // a spreadsheet freezes its own column headings rather than
      // everything above the data.
      child: CustomScrollView(
        controller: _vScroll,
        slivers: [
          SliverToBoxAdapter(
            child: Column(
              children: [
                topSection(),
                const SizedBox(height: AppTheme.s12),
              ],
            ),
          ),
          SliverPersistentHeader(
            pinned: true,
            delegate: _DateHeaderDelegate(
              sections: sections.length > 1 ? sections : null,
              onTapChip: _jumpTo,
              dates: dates,
              today: todayDate,
              tile: tile,
              roomCol: roomCol,
              hSync: _hSync,
            ),
          ),
          SliverPadding(
            // Clears the floating New booking button — padding on the whole
            // chart would shrink the header and legend too and still leave
            // the last card's own scroll area squeezed against the button;
            // this instead gives only the trailing space the extra room.
            padding: const EdgeInsets.only(top: AppTheme.s12, bottom: 96),
            sliver: SliverList(
              delegate: SliverChildListDelegate([
                for (final section in sections) ...[
                  Container(
                    key: _keyFor(section.categoryName),
                    decoration: BoxDecoration(
                      color: AppTheme.card,
                      borderRadius: BorderRadius.circular(AppTheme.rMedium),
                      border: Border.all(color: AppTheme.border),
                      boxShadow: AppTheme.extruded,
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: _CategoryBand(
                      section: section,
                      dates: dates,
                      today: todayDate,
                      tile: tile,
                      roomCol: roomCol,
                      rowHeight: rowHeight,
                      hSync: _hSync,
                      onTapStay: (b, room) => _openBookingDetail(context, b),
                      onTapVacant: (roomId, day) =>
                          _takeBooking(context, roomId: roomId, checkIn: day),
                      hitIds: hitIds,
                      activeHitId: activeHitId,
                    ),
                  ),
                  const SizedBox(height: AppTheme.s12),
                ],
              ]),
            ),
          ),
        ],
      ),
    );
  }

  /// Tapping a stay opens its full detail directly — the same one click the
  /// web tape chart's own tile takes the desk to, rather than a quick-action
  /// sheet that only leads there itself on a second tap. The detail screen
  /// refreshes the chart itself once an action there actually changes
  /// anything, so nothing further is needed here on the way back.
  Future<void> _openBookingDetail(
    BuildContext context,
    TapeChartBooking booking,
  ) {
    return Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => BookingDetailScreen(bookingId: booking.id),
      ),
    );
  }

  Future<void> _takeBooking(
    BuildContext context, {
    int? roomId,
    DateTime? checkIn,
  }) async {
    final booked = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => TakeBookingScreen(
          presetRoomId: roomId,
          presetCheckIn: checkIn,
        ),
      ),
    );
    if (booked == true) {
      ref.read(bookingViewModelProvider.notifier).loadChart();
    }
  }
}

// ── Header: window label + pager ────────────────────────────────────────────

/// The month stepper — a whole calendar month at a time, opening on the
/// current month so the desk never has to scroll just to see today. Not a
/// date-range picker: the web chart has none, because a stay entered against
/// an arbitrary custom range is not a question the desk actually asks — the
/// question is "show me next month," repeatable either direction.
class _ChartHeader extends StatelessWidget {
  final DateTime from;
  final VoidCallback onPrev;
  final VoidCallback onNext;

  const _ChartHeader({
    required this.from,
    required this.onPrev,
    required this.onNext,
  });

  static const _months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  String _label(DateTime d) => '${d.day} ${_months[d.month - 1]}';

  @override
  Widget build(BuildContext context) {
    // Always `from`'s own calendar month, the same way the web tape chart's
    // own pill reads off its `month` anchor rather than the actual (possibly
    // scroll-grown) end of the fetched window — `to` moves every time the
    // desk drags near the far edge for more nights, and showing that here
    // would make the date pill visibly crawl forward on its own mid-drag
    // instead of only on a deliberate prev/next or a pull past the near
    // edge, which is the one direction the web pill does follow (it opens
    // on an earlier page, the same way prev does).
    final last = DateTime(
      from.year,
      from.month + 1,
      1,
    ).subtract(const Duration(days: 1));
    final sameYear = from.year == last.year;

    return Row(
      children: [
        _RoundIconButton(
          icon: Icons.chevron_left_rounded,
          onTap: onPrev,
          semanticLabel: 'Previous month',
          size: 32,
        ),
        const SizedBox(width: AppTheme.s8),
        Expanded(
          child: Container(
            padding: const EdgeInsets.symmetric(
              horizontal: AppTheme.s12,
              vertical: AppTheme.s8,
            ),
            decoration: BoxDecoration(
              color: AppTheme.card,
              borderRadius: BorderRadius.circular(AppTheme.rMedium),
              border: Border.all(color: AppTheme.border),
              boxShadow: AppTheme.subtle,
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Text(
                  '${_label(from)} – ${_label(last)}',
                  style: const TextStyle(
                    color: AppTheme.heading,
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                  ),
                ),
                const SizedBox(width: AppTheme.s4),
                Text(
                  sameYear ? '${from.year}' : '${from.year} – ${last.year}',
                  style: const TextStyle(color: AppTheme.muted, fontSize: 11),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: AppTheme.s8),
        _RoundIconButton(
          icon: Icons.chevron_right_rounded,
          onTap: onNext,
          semanticLabel: 'Next month',
          size: 32,
        ),
      ],
    );
  }
}

class _RoundIconButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;
  final String? semanticLabel;
  final double size;

  const _RoundIconButton({
    required this.icon,
    required this.onTap,
    this.semanticLabel,
    this.size = 40,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: semanticLabel,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            color: AppTheme.card,
            shape: BoxShape.circle,
            border: Border.all(color: AppTheme.border),
            boxShadow: AppTheme.subtle,
          ),
          child: Icon(icon, size: size * 0.5, color: AppTheme.heading),
        ),
      ),
    );
  }
}

// ── Search ───────────────────────────────────────────────────────────────────

/// Find a guest on the chart by name, phone, ID or invoice number — the same
/// fields and the same two-pass match (plain, then punctuation-stripped) the
/// web tape chart's own search box uses, so a guest answers to the same query
/// on either screen. The stepper moves between hits the way the web one does;
/// [_TapeChartState._jumpToActiveHit] is what actually scrolls to it.
class _SearchBar extends StatefulWidget {
  final String value;
  final int hitCount;
  final int hitIndex;
  final ValueChanged<String> onChanged;
  final VoidCallback onPrev;
  final VoidCallback onNext;

  const _SearchBar({
    required this.value,
    required this.hitCount,
    required this.hitIndex,
    required this.onChanged,
    required this.onPrev,
    required this.onNext,
  });

  @override
  State<_SearchBar> createState() => _SearchBarState();
}

class _SearchBarState extends State<_SearchBar> {
  late final _controller = TextEditingController(text: widget.value);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final hasQuery = widget.value.trim().isNotEmpty;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
        boxShadow: AppTheme.subtle,
      ),
      child: Row(
        children: [
          const Icon(Icons.search_rounded, size: 18, color: AppTheme.muted),
          const SizedBox(width: AppTheme.s8),
          Expanded(
            child: TextField(
              controller: _controller,
              onChanged: widget.onChanged,
              style: const TextStyle(color: AppTheme.heading, fontSize: 14),
              decoration: const InputDecoration(
                isDense: true,
                border: InputBorder.none,
                hintText: 'Find a guest — name, phone, ID or invoice',
                hintStyle: TextStyle(color: AppTheme.muted, fontSize: 13),
              ),
            ),
          ),
          if (hasQuery) ...[
            Text(
              widget.hitCount == 0
                  ? 'No matches'
                  : '${widget.hitIndex + 1}/${widget.hitCount}',
              style: const TextStyle(color: AppTheme.muted, fontSize: 12),
            ),
            IconButton(
              icon: const Icon(Icons.keyboard_arrow_up_rounded, size: 20),
              color: AppTheme.text,
              visualDensity: VisualDensity.compact,
              onPressed: widget.hitCount == 0 ? null : widget.onPrev,
            ),
            IconButton(
              icon: const Icon(Icons.keyboard_arrow_down_rounded, size: 20),
              color: AppTheme.text,
              visualDensity: VisualDensity.compact,
              onPressed: widget.hitCount == 0 ? null : widget.onNext,
            ),
            IconButton(
              icon: const Icon(Icons.close_rounded, size: 18),
              color: AppTheme.muted,
              visualDensity: VisualDensity.compact,
              onPressed: () {
                _controller.clear();
                widget.onChanged('');
              },
            ),
          ],
        ],
      ),
    );
  }
}

// ── Legend ───────────────────────────────────────────────────────────────────

class _Legend extends StatelessWidget {
  const _Legend();

  static const _entries = [
    (AppTheme.vacant, 'Vacant'),
    (AppTheme.reserved, 'Reserved'),
    (AppTheme.checkedIn, 'Checked in'),
    (AppTheme.stayed, 'Stayed'),
  ];

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final e in _entries) ...[
            Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(
                color: e.$1,
                borderRadius: BorderRadius.circular(3),
              ),
            ),
            const SizedBox(width: 6),
            Text(
              e.$2,
              style: const TextStyle(color: AppTheme.muted, fontSize: 12),
            ),
            const SizedBox(width: AppTheme.s16),
          ],
        ],
      ),
    );
  }
}

// ── Category chips ───────────────────────────────────────────────────────────

/// One chip per category — a name, a room count and how full it is over the
/// visible nights — that scrolls the chart straight to that band. The web
/// tape chart offers the same jump, and for the same reason: a long list of
/// categories otherwise means scrolling past every one to reach the last.
class _CategoryChips extends StatelessWidget {
  final List<ChartSection> sections;
  final List<DateTime> dates;
  final ValueChanged<String> onTap;

  const _CategoryChips({
    required this.sections,
    required this.dates,
    required this.onTap,
  });

  /// Nights sold across every room in the section, over nights offered — the
  /// same occupancy figure the web chip badges with a percent.
  int _percentSold(ChartSection section) {
    final capacity = section.rooms.length * dates.length;
    if (capacity == 0) return 0;
    var sold = 0;
    for (final room in section.rooms) {
      for (final d in dates) {
        final stay = room.stayOn(d);
        if (stay != null && stay.status != 'CANCELLED') sold++;
      }
    }
    return ((sold / capacity) * 100).round();
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final section in sections) ...[
            GestureDetector(
              onTap: () => onTap(section.categoryName),
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppTheme.s12,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: AppTheme.card,
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(color: AppTheme.border),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      section.categoryName,
                      style: const TextStyle(
                        color: AppTheme.heading,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      '${section.rooms.length}',
                      style: const TextStyle(
                        color: AppTheme.muted,
                        fontSize: 11,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      '${_percentSold(section)}%',
                      style: const TextStyle(
                        color: AppTheme.accent,
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(width: AppTheme.s8),
          ],
        ],
      ),
    );
  }
}

// ── Keeping every horizontal strip in step ──────────────────────────────────

/// The date header and every category's room rows all draw the same nights
/// in the same columns, so dragging any one of them should carry the rest
/// along. Attaching one `ScrollController` to several views the user can
/// actually drag is the fragile way to do that — only one drag can be live at
/// a time, and Flutter has no rule for which view wins. This instead gives
/// every strip its own controller and mirrors one's offset onto all the
/// others whenever it moves, whether that move came from a drag or a jump.
class _HorizontalSync {
  final List<ScrollController> _controllers = [];
  bool _syncing = false;

  ScrollController attach() {
    final controller = ScrollController();
    controller.addListener(() => _onMoved(controller));
    _controllers.add(controller);
    return controller;
  }

  void detach(ScrollController controller) {
    _controllers.remove(controller);
    controller.dispose();
  }

  void _onMoved(ScrollController source) {
    if (_syncing || !source.hasClients) return;
    _syncing = true;
    final offset = source.offset;
    for (final other in _controllers) {
      if (identical(other, source) || !other.hasClients) continue;
      if (other.offset != offset) other.jumpTo(offset);
    }
    _syncing = false;
  }

  /// Nudge every strip's offset by [delta] without touching what is on
  /// screen — used the moment more nights are prepended in front of what is
  /// currently visible, the same way the web tape chart adds the width it
  /// just prepended onto `scrollLeft` so the view does not leap back to the
  /// very start on every pull past the left edge.
  void shiftAllBy(double delta) {
    if (delta == 0) return;
    _syncing = true;
    for (final c in _controllers) {
      if (!c.hasClients) continue;
      final target = (c.offset + delta).clamp(0.0, c.position.maxScrollExtent);
      c.jumpTo(target);
    }
    _syncing = false;
  }

  /// Jump every strip straight to [offset] — used once, right after the
  /// chart opens, to land on today's column instead of the window's own
  /// start. Unlike [shiftAllBy] this is an absolute position, not a delta.
  void jumpAllTo(double offset) {
    _syncing = true;
    for (final c in _controllers) {
      if (!c.hasClients) continue;
      c.jumpTo(offset.clamp(0.0, c.position.maxScrollExtent));
    }
    _syncing = false;
  }

  void dispose() {
    for (final c in _controllers) {
      c.dispose();
    }
    _controllers.clear();
  }
}

/// One strip's controller, registered with [sync] for its whole life and
/// released the moment this widget leaves the tree — the alternative, an
/// owner that only ever adds controllers, would leak one per room every time
/// the chart window changed.
class _SyncedController extends StatefulWidget {
  final _HorizontalSync sync;
  final Widget Function(BuildContext context, ScrollController controller)
  builder;

  const _SyncedController({required this.sync, required this.builder});

  @override
  State<_SyncedController> createState() => _SyncedControllerState();
}

class _SyncedControllerState extends State<_SyncedController> {
  late final ScrollController _controller = widget.sync.attach();

  @override
  void dispose() {
    widget.sync.detach(_controller);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.builder(context, _controller);
}

// ── Date header row ──────────────────────────────────────────────────────────

/// Pins [_DateHeader] to the top of the chart's scroll view once the desk
/// scrolls the room list up past it — the one part of the chart that stays
/// put, the way a spreadsheet freezes its own column headings rather than
/// everything above the data.
class _DateHeaderDelegate extends SliverPersistentHeaderDelegate {
  /// Null (or a single section) when there is nothing worth a chip row for
  /// — the chip strip above the date header is skipped entirely rather than
  /// pinning an empty sliver of its own height.
  final List<ChartSection>? sections;
  final ValueChanged<String>? onTapChip;
  final List<DateTime> dates;
  final DateTime today;
  final double tile;
  final double roomCol;
  final _HorizontalSync hSync;

  _DateHeaderDelegate({
    required this.sections,
    required this.onTapChip,
    required this.dates,
    required this.today,
    required this.tile,
    required this.roomCol,
    required this.hSync,
  });

  // Both a little over the sum of `_DateHeader`'s own fixed row heights and
  // the chip pill's own natural height — extra headroom so a real device's
  // font metrics have room to differ from these numbers without visibly
  // clipping into the chip text or the date tiles; [build] backs this with
  // an `OverflowBox` regardless, so this only affects how much gets clipped
  // rather than whether an overflow warning shows.
  static const double _dateHeaderHeight = 78;
  static const double _chipsHeight = 44;

  bool get _hasChips => sections != null && sections!.isNotEmpty;

  double get _height =>
      _dateHeaderHeight + (_hasChips ? _chipsHeight + AppTheme.s8 : 0);

  @override
  double get minExtent => _height;

  @override
  double get maxExtent => _height;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) {
    // A pinned sliver's height is fixed the moment it's laid out — it can't
    // grow later the way a normal box can. The chip pills and the date
    // header's own tiles are all sized off fixed pixel heights assuming a
    // 1.0 text scale, so on a phone set to a larger system font size, that
    // text no longer fits and the whole header overflows. Pinning the
    // scale here keeps this one header legible-but-fixed rather than
    // fluid-but-broken; nothing else on the chart is pinned, so everywhere
    // else still respects the device's own text size.
    final content = MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: const TextScaler.linear(1.0)),
      // An opaque backdrop the full height of the pinned block — without
      // one, the chip row (which has no background of its own) lets the
      // room rows scrolling past underneath show straight through it,
      // which reads as the chips sinking into the list instead of sitting
      // fixed above it.
      child: Container(
        color: AppTheme.bg,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_hasChips) ...[
              SizedBox(
                height: _chipsHeight,
                child: ClipRect(
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: _CategoryChips(
                      sections: sections!,
                      dates: dates,
                      onTap: onTapChip!,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: AppTheme.s8),
            ],
            Container(
              decoration: BoxDecoration(
                color: AppTheme.card,
                borderRadius: BorderRadius.circular(AppTheme.rMedium),
                border: Border.all(color: AppTheme.border),
                boxShadow: AppTheme.extruded,
              ),
              clipBehavior: Clip.antiAlias,
              child: _DateHeader(
                dates: dates,
                today: today,
                tile: tile,
                roomCol: roomCol,
                hSync: hSync,
              ),
            ),
          ],
        ),
      ),
    );

    // However tall this actually wants to be, the sliver above it was told
    // exactly `_height` and won't ask again — an `OverflowBox` lets the
    // content size itself free of that constraint instead of fighting it,
    // and `ClipRect` trims anything past `_height` cleanly instead of the
    // usual yellow-and-black overflow banner painting over the chart.
    return ClipRect(
      child: OverflowBox(
        alignment: Alignment.topCenter,
        minHeight: 0,
        maxHeight: double.infinity,
        child: content,
      ),
    );
  }

  @override
  bool shouldRebuild(covariant _DateHeaderDelegate oldDelegate) {
    return oldDelegate.sections != sections ||
        oldDelegate.dates != dates ||
        oldDelegate.today != today ||
        oldDelegate.tile != tile ||
        oldDelegate.roomCol != roomCol ||
        oldDelegate.hSync != hSync;
  }
}

class _DateHeader extends StatelessWidget {
  final List<DateTime> dates;
  final DateTime today;
  final double tile;
  final double roomCol;
  final _HorizontalSync hSync;

  const _DateHeader({
    required this.dates,
    required this.today,
    required this.tile,
    required this.roomCol,
    required this.hSync,
  });

  static const _weekdayLetters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  static const _months = [
    'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
    'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
  ];

  bool _isWeekend(DateTime d) =>
      d.weekday == DateTime.saturday || d.weekday == DateTime.sunday;

  @override
  Widget build(BuildContext context) {
    // One label per distinct month in the window, spanning exactly the
    // dates that fall in it — the same banner the web tape chart draws over
    // its own header row, so a page that crosses a month boundary shows both.
    final monthSpans = <(String, int)>[];
    for (final d in dates) {
      final label = '${_months[d.month - 1]} ${d.year}';
      if (monthSpans.isNotEmpty && monthSpans.last.$1 == label) {
        monthSpans[monthSpans.length - 1] = (label, monthSpans.last.$2 + 1);
      } else {
        monthSpans.add((label, 1));
      }
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          children: [
            Container(width: roomCol, height: 26, color: AppTheme.bg),
            Expanded(
              child: _SyncedController(
                sync: hSync,
                builder: (context, controller) => SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  controller: controller,
                  physics: const NeverScrollableScrollPhysics(),
                  child: Row(
                    children: [
                      for (final span in monthSpans)
                        Container(
                          width: tile * span.$2,
                          height: 26,
                          alignment: Alignment.center,
                          decoration: const BoxDecoration(
                            color: AppTheme.bg,
                            border: Border(
                              bottom: BorderSide(color: AppTheme.border),
                            ),
                          ),
                          child: Text(
                            span.$1,
                            style: const TextStyle(
                              color: AppTheme.muted,
                              fontSize: 10,
                              fontWeight: FontWeight.w700,
                              letterSpacing: 0.4,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
        Row(
          children: [
            Container(
              width: roomCol,
              height: 44,
              alignment: Alignment.centerLeft,
              padding: const EdgeInsets.only(left: AppTheme.s12),
              decoration: const BoxDecoration(
                color: AppTheme.bg,
                border: Border(right: BorderSide(color: AppTheme.border)),
              ),
              child: const Text(
                'Room',
                style: TextStyle(
                  color: AppTheme.muted,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            Expanded(
              child: _SyncedController(
                sync: hSync,
                builder: (context, controller) => SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  controller: controller,
                  // The header follows whichever row the desk actually
                  // dragged — it does not itself need to be draggable.
                  physics: const NeverScrollableScrollPhysics(),
                  child: Row(
                    children: [
                      for (final d in dates)
                        Container(
                          width: tile,
                          height: 44,
                          color: _isSameDay(d, today)
                              ? AppTheme.accent.withValues(alpha: 0.08)
                              : _isWeekend(d)
                              ? AppTheme.muted.withValues(alpha: 0.06)
                              : AppTheme.bg,
                          alignment: Alignment.center,
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Text(
                                _weekdayLetters[d.weekday - 1],
                                style: TextStyle(
                                  color: _isWeekend(d)
                                      ? AppTheme.draft
                                      : AppTheme.muted,
                                  fontSize: 10,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              const SizedBox(height: 2),
                              _isSameDay(d, today)
                                  ? Container(
                                      width: 22,
                                      height: 22,
                                      alignment: Alignment.center,
                                      decoration: const BoxDecoration(
                                        color: AppTheme.accent,
                                        shape: BoxShape.circle,
                                      ),
                                      child: Text(
                                        '${d.day}',
                                        style: const TextStyle(
                                          color: Colors.white,
                                          fontSize: 12,
                                          fontWeight: FontWeight.w700,
                                        ),
                                      ),
                                    )
                                  : Text(
                                      '${d.day}',
                                      style: TextStyle(
                                        color: _isWeekend(d)
                                            ? AppTheme.draft
                                            : AppTheme.heading,
                                        fontSize: 13,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }

  bool _isSameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;
}

// ── One category's band ─────────────────────────────────────────────────────

class _CategoryBand extends StatelessWidget {
  final ChartSection section;
  final List<DateTime> dates;
  final DateTime today;
  final double tile;
  final double roomCol;
  final double rowHeight;
  final _HorizontalSync hSync;
  final void Function(TapeChartBooking booking, ChartRoom room) onTapStay;
  final void Function(int roomId, DateTime day) onTapVacant;
  final Set<int> hitIds;
  final int? activeHitId;

  const _CategoryBand({
    required this.section,
    required this.dates,
    required this.today,
    required this.tile,
    required this.roomCol,
    required this.rowHeight,
    required this.hSync,
    required this.hitIds,
    required this.activeHitId,
    required this.onTapStay,
    required this.onTapVacant,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(
            horizontal: AppTheme.s16,
            vertical: AppTheme.s12,
          ),
          decoration: const BoxDecoration(
            color: AppTheme.bg,
            border: Border(bottom: BorderSide(color: AppTheme.border)),
          ),
          child: Row(
            children: [
              Text(
                section.categoryName,
                style: const TextStyle(
                  color: AppTheme.heading,
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(width: AppTheme.s8),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 8,
                  vertical: 2,
                ),
                decoration: BoxDecoration(
                  color: AppTheme.accent.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  '${section.rooms.length} room${section.rooms.length == 1 ? '' : 's'}',
                  style: const TextStyle(
                    color: AppTheme.accent,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ),
        for (final room in section.rooms)
          _RoomRow(
            room: room,
            dates: dates,
            today: today,
            tile: tile,
            roomCol: roomCol,
            rowHeight: rowHeight,
            hSync: hSync,
            onTapStay: onTapStay,
            onTapVacant: onTapVacant,
            hitIds: hitIds,
            activeHitId: activeHitId,
          ),
        // The web tape chart's own scroller is a plain `overflow-x: auto`
        // div, so the browser draws its own thumb under it for free — there
        // is nothing else marking a card as horizontally scrollable there.
        // Flutter draws nothing on its own, so without this a card gave no
        // sign it had more nights off to the side at all. A dedicated strip
        // rather than a `Scrollbar` wrapped around a room row: the thumb
        // would otherwise sit on top of that row's own tiles instead of in
        // a lane of its own underneath them.
        Padding(
          padding: const EdgeInsets.only(
            left: AppTheme.s4,
            right: AppTheme.s4,
            bottom: AppTheme.s4,
          ),
          child: SizedBox(
            height: 14,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SizedBox(width: roomCol),
                Expanded(
                  child: _SyncedController(
                    sync: hSync,
                    builder: (context, controller) => Scrollbar(
                      controller: controller,
                      thumbVisibility: true,
                      trackVisibility: true,
                      thickness: 6,
                      radius: const Radius.circular(3),
                      child: SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        controller: controller,
                        // A track exactly `dates.length * tile` wide, the
                        // same width every row's own strip already scrolls
                        // — the scrollbar is what this exists to draw, not
                        // content of its own.
                        child: SizedBox(width: tile * dates.length),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _RoomRow extends StatelessWidget {
  final ChartRoom room;
  final List<DateTime> dates;
  final DateTime today;
  final double tile;
  final double roomCol;
  final double rowHeight;
  final _HorizontalSync hSync;
  final void Function(TapeChartBooking booking, ChartRoom room) onTapStay;
  final void Function(int roomId, DateTime day) onTapVacant;
  final Set<int> hitIds;
  final int? activeHitId;

  const _RoomRow({
    required this.room,
    required this.dates,
    required this.today,
    required this.tile,
    required this.roomCol,
    required this.rowHeight,
    required this.hSync,
    required this.onTapStay,
    required this.onTapVacant,
    required this.hitIds,
    required this.activeHitId,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppTheme.border, width: 0.6)),
      ),
      child: Row(
        children: [
          Container(
            width: roomCol,
            height: rowHeight,
            alignment: Alignment.centerLeft,
            padding: const EdgeInsets.only(left: AppTheme.s12),
            decoration: const BoxDecoration(
              border: Border(right: BorderSide(color: AppTheme.border)),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  room.room.roomNumber,
                  style: const TextStyle(
                    color: AppTheme.heading,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
                if ((room.room.floor ?? '').isNotEmpty)
                  Text(
                    'Floor ${room.room.floor}',
                    style: const TextStyle(
                      color: AppTheme.muted,
                      fontSize: 10,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
              ],
            ),
          ),
          Expanded(
            child: _SyncedController(
              sync: hSync,
              builder: (context, controller) => SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                controller: controller,
                child: Row(
                  children: [
                    for (final d in dates)
                      _Tile(
                        stay: room.stayOn(d),
                        // A run of nights on the same stay draws as one
                        // unbroken bar — rounded only where the bar itself
                        // starts or ends, square everywhere it butts against
                        // its own next or previous night — the same
                        // continuous block the web tape chart draws, rather
                        // than a row of separately rounded, gapped boxes.
                        isRunStart: room.stayOn(d.subtract(const Duration(days: 1)))?.id !=
                            room.stayOn(d)?.id,
                        isRunEnd: room.stayOn(d.add(const Duration(days: 1)))?.id !=
                            room.stayOn(d)?.id,
                        isToday: _isSameDay(d, today),
                        isPast: d.isBefore(today),
                        isWeekend: d.weekday == DateTime.saturday ||
                            d.weekday == DateTime.sunday,
                        isHit: hitIds.contains(room.stayOn(d)?.id),
                        isActiveHit: activeHitId != null &&
                            room.stayOn(d)?.id == activeHitId,
                        size: tile,
                        height: rowHeight,
                        onTapStay: (b) => onTapStay(b, room),
                        onTapVacant: () => onTapVacant(room.room.id, d),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  bool _isSameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;
}

// ── One night's tile ─────────────────────────────────────────────────────────

class _Tile extends StatelessWidget {
  final TapeChartBooking? stay;
  final bool isRunStart;
  final bool isRunEnd;
  final bool isToday;
  final bool isPast;
  final bool isWeekend;
  final bool isHit;
  final bool isActiveHit;
  final double size;
  final double height;
  final ValueChanged<TapeChartBooking> onTapStay;
  final VoidCallback onTapVacant;

  const _Tile({
    required this.stay,
    required this.isRunStart,
    required this.isRunEnd,
    required this.isToday,
    required this.isPast,
    required this.isWeekend,
    required this.isHit,
    required this.isActiveHit,
    required this.size,
    required this.height,
    required this.onTapStay,
    required this.onTapVacant,
  });

  Color get _fill {
    final s = stay;
    if (s == null) {
      if (isPast) return AppTheme.border;
      // A weekend night sells the same as any other, but the web tape chart
      // washes it a touch deeper so a run of Saturdays stands out at a
      // glance — the same cue this carries over.
      return isWeekend
          ? AppTheme.vacant.withValues(alpha: 0.28)
          : AppTheme.vacant.withValues(alpha: 0.16);
    }
    switch (s.status) {
      case 'CHECKED_IN':
        return AppTheme.checkedIn;
      case 'CHECKED_OUT':
        return AppTheme.stayed;
      default:
        return AppTheme.reserved;
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = stay;
    // A vacant night stands alone — each is its own small rounded box, the
    // way the web tape chart draws an empty grid. A stay's own nights are
    // never rounded or gapped except at the two ends of the run itself, so
    // they read as one continuous bar the whole length of the booking
    // rather than a row of separately boxed nights.
    final roundLeft = s == null || isRunStart;
    final roundRight = s == null || isRunEnd;
    // A vacant night in the past still opens a booking, exactly as the web
    // tape chart's own click does — a stay taken on paper over the weekend
    // has to be enterable against the nights it actually happened on. Past
    // only dims the tile; it never locks it.
    return GestureDetector(
      onTap: s == null ? onTapVacant : () => onTapStay(s),
      child: Container(
        width: size,
        height: height,
        padding: EdgeInsets.only(
          top: 3,
          bottom: 3,
          left: roundLeft ? 3 : 0,
          right: roundRight ? 3 : 0,
        ),
        child: Container(
          decoration: BoxDecoration(
            color: _fill,
            borderRadius: BorderRadius.horizontal(
              left: roundLeft ? const Radius.circular(6) : Radius.zero,
              right: roundRight ? const Radius.circular(6) : Radius.zero,
            ),
            // A search hit rings violet — a colour nothing else on the chart
            // uses, the same way the web tape chart marks it — brighter and
            // thicker on the one hit the stepper is actually on. Today's own
            // ring is skipped once a stay already fills the night: the fill
            // colour already says the room is taken, and a ring drawn on
            // just one night of a run would cut a notch into an otherwise
            // unbroken bar.
            border: isActiveHit
                ? Border.all(color: const Color(0xFF7C3AED), width: 2.2)
                : isHit
                ? Border.all(
                    color: const Color(0xFF7C3AED).withValues(alpha: 0.55),
                    width: 1.6,
                  )
                : (isToday && s == null)
                ? Border.all(color: AppTheme.accent, width: 1.4)
                : null,
          ),
          alignment: Alignment.center,
          child: s != null && size >= 48
              ? Text(
                  (s.guestName ?? '').isEmpty
                      ? ''
                      : s.guestName![0].toUpperCase(),
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                )
              : null,
        ),
      ),
    );
  }
}
