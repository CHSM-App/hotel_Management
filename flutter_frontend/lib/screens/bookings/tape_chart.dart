import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/tape_chart.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/booking_viewmodel.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'booking_actions.dart';
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

  /// Guards against a single drag past the left edge firing [growPast] many
  /// times over — one continuous overscroll emits a notification per frame.
  bool _growingPast = false;

  /// The date header and every category's grid all scroll horizontally
  /// together, but each room row is its own draggable surface — several
  /// interactive views cannot safely share one `ScrollController` (only one
  /// of them can actually be mid-drag at a time), so this mirrors one row's
  /// drag onto every other row and the header instead of attaching them all
  /// to the same controller.
  final _hSync = _HorizontalSync();

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
    Future.microtask(
      () => ref.read(bookingViewModelProvider.notifier).loadChart(),
    );
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
        final tile = wide ? 56.0 : 40.0;
        final roomCol = wide ? 96.0 : 72.0;
        final rowHeight = wide ? 52.0 : 44.0;

        return Column(
          children: [
            _ChartHeader(
              from: state.chartFrom,
              to: state.chartTo,
              onPrev: () => vm.shiftChart(-1),
              onNext: () => vm.shiftChart(1),
            ),
            const SizedBox(height: AppTheme.s8),
            const _Legend(),
            if (state.chartSections.length > 1) ...[
              const SizedBox(height: AppTheme.s8),
              _CategoryChips(
                sections: state.chartSections,
                dates: dates,
                onTap: _jumpTo,
              ),
            ],
            const SizedBox(height: AppTheme.s12),
            Expanded(child: _buildBody(state, dates, tile, roomCol, rowHeight)),
          ],
        );
      },
    );
  }

  Widget _buildBody(
    BookingState state,
    List<DateTime> dates,
    double tile,
    double roomCol,
    double rowHeight,
  ) {
    if (state.chart.isLoading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (state.chart.hasError) {
      return Center(
        child: Text(
          BookingViewModel.messageFor(state.chart.error!),
          style: const TextStyle(color: AppTheme.muted),
        ),
      );
    }

    final sections = state.chartSections;
    if (sections.isEmpty) {
      return const Center(
        child: Text(
          'No active rooms yet.',
          style: TextStyle(color: AppTheme.muted),
        ),
      );
    }

    final today = DateTime.now();
    final todayDate = DateTime(today.year, today.month, today.day);
    final hitIds = state.chartSearchHits.map((b) => b.id).toSet();
    final activeHitId = state.chartActiveHit?.id;

    // The date band rides the same horizontal offset as every category's own
    // grid below it, via the shared controller — scrolling one moves them
    // all together, the way a single strip would, without actually being one.
    //
    // Pulling any room row past its own left edge (a negative, horizontal
    // overscroll) reaches all the way up here as a bubbled notification,
    // regardless of which row's own ScrollController it came from — the same
    // way the web tape chart prepends earlier nights once scrolled hard
    // against its own start, for a stay entered against a night further back
    // than the window opened on.
    return NotificationListener<OverscrollNotification>(
      onNotification: (notification) {
        if (notification.metrics.axis == Axis.horizontal &&
            notification.overscroll < 0 &&
            !_growingPast) {
          _growingPast = true;
          ref
              .read(bookingViewModelProvider.notifier)
              .growPast()
              .whenComplete(() => _growingPast = false);
        }
        return false;
      },
      child: Column(
        children: [
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
            today: todayDate,
            tile: tile,
            roomCol: roomCol,
            hSync: _hSync,
          ),
        ),
        const SizedBox(height: AppTheme.s12),
        Expanded(
          child: SingleChildScrollView(
            controller: _vScroll,
            // Clears the floating New booking button — padding on the whole
            // chart would shrink the header and legend too and still leave
            // the last card's own scroll area squeezed against the button;
            // this instead gives only the trailing space the extra room.
            padding: const EdgeInsets.only(bottom: 96),
            child: Column(
              children: [
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
                      onTapStay: (b, room) => _openStaySheet(context, b, room),
                      onTapVacant: (roomId, day) =>
                          _takeBooking(context, roomId: roomId, checkIn: day),
                      hitIds: hitIds,
                      activeHitId: activeHitId,
                    ),
                  ),
                  const SizedBox(height: AppTheme.s12),
                ],
              ],
            ),
          ),
        ),
      ],
      ),
    );
  }

  /// A quick-actions sheet over the chart itself — check in, check out or
  /// cancel right where the stay was tapped, the way the web tape chart's own
  /// hover card leads straight into the same actions.
  Future<void> _openStaySheet(
    BuildContext context,
    TapeChartBooking booking,
    ChartRoom room,
  ) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (_) => _StaySheet(booking: booking, room: room),
    );
    if (changed == true) {
      ref.read(bookingViewModelProvider.notifier).loadChart();
    }
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

/// The month stepper — a fixed 30-day page that moves a whole page at a time,
/// the same way the web tape chart's own prev/next does. Not a date-range
/// picker: the web chart has none, because a stay entered against an
/// arbitrary custom range is not a question the desk actually asks — the
/// question is "show me the next 30 days," repeatable either direction.
class _ChartHeader extends StatelessWidget {
  final DateTime from;
  final DateTime to;
  final VoidCallback onPrev;
  final VoidCallback onNext;

  const _ChartHeader({
    required this.from,
    required this.to,
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
    final last = to.subtract(const Duration(days: 1));
    final sameYear = from.year == last.year;

    return Row(
      children: [
        _RoundIconButton(
          icon: Icons.chevron_left_rounded,
          onTap: onPrev,
          semanticLabel: 'Previous ${BookingViewModel.chartWindowDays} days',
        ),
        const SizedBox(width: AppTheme.s8),
        Expanded(
          child: Container(
            padding: const EdgeInsets.symmetric(
              horizontal: AppTheme.s12,
              vertical: AppTheme.s12,
            ),
            decoration: BoxDecoration(
              color: AppTheme.card,
              borderRadius: BorderRadius.circular(AppTheme.rMedium),
              border: Border.all(color: AppTheme.border),
              boxShadow: AppTheme.subtle,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '${_label(from)} – ${_label(last)}',
                  style: const TextStyle(
                    color: AppTheme.heading,
                    fontWeight: FontWeight.w600,
                    fontSize: 14,
                  ),
                ),
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
          semanticLabel: 'Next ${BookingViewModel.chartWindowDays} days',
        ),
      ],
    );
  }
}

class _RoundIconButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;
  final String? semanticLabel;

  const _RoundIconButton({
    required this.icon,
    required this.onTap,
    this.semanticLabel,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: semanticLabel,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: AppTheme.card,
            shape: BoxShape.circle,
            border: Border.all(color: AppTheme.border),
            boxShadow: AppTheme.subtle,
          ),
          child: Icon(icon, size: 20, color: AppTheme.heading),
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

  static const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  @override
  Widget build(BuildContext context) {
    return Row(
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
              // The header follows whichever row the desk actually dragged —
              // it does not itself need to be draggable.
              physics: const NeverScrollableScrollPhysics(),
              child: Row(
                children: [
                  for (final d in dates)
                    Container(
                      width: tile,
                      height: 44,
                      color: _isSameDay(d, today)
                          ? AppTheme.accent.withValues(alpha: 0.08)
                          : (d.weekday == DateTime.saturday ||
                                d.weekday == DateTime.sunday)
                          ? AppTheme.muted.withValues(alpha: 0.06)
                          : AppTheme.bg,
                      alignment: Alignment.center,
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            _weekdays[d.weekday - 1],
                            style: const TextStyle(
                              color: AppTheme.muted,
                              fontSize: 9,
                            ),
                          ),
                          Text(
                            '${d.day}',
                            style: TextStyle(
                              color: _isSameDay(d, today)
                                  ? AppTheme.accent
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
            child: Text(
              room.room.roomNumber,
              style: const TextStyle(
                color: AppTheme.heading,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
              overflow: TextOverflow.ellipsis,
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
    // A vacant night in the past still opens a booking, exactly as the web
    // tape chart's own click does — a stay taken on paper over the weekend
    // has to be enterable against the nights it actually happened on. Past
    // only dims the tile; it never locks it.
    return GestureDetector(
      onTap: s == null ? onTapVacant : () => onTapStay(s),
      child: Container(
        width: size,
        height: height,
        padding: const EdgeInsets.all(3),
        child: Container(
          decoration: BoxDecoration(
            color: _fill,
            borderRadius: BorderRadius.circular(6),
            // A search hit rings violet — a colour nothing else on the chart
            // uses, the same way the web tape chart marks it — brighter and
            // thicker on the one hit the stepper is actually on.
            border: isActiveHit
                ? Border.all(color: const Color(0xFF7C3AED), width: 2.2)
                : isHit
                ? Border.all(
                    color: const Color(0xFF7C3AED).withValues(alpha: 0.55),
                    width: 1.6,
                  )
                : isToday
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

// ── The stay, tapped off the chart ──────────────────────────────────────────

/// What a tapped tile opens: the stay's own numbers, and whichever of
/// check-in, check-out or cancel applies to it right now — the same three
/// moves the register's list view used to be the only way to reach.
class _StaySheet extends ConsumerStatefulWidget {
  final TapeChartBooking booking;
  final ChartRoom room;

  const _StaySheet({required this.booking, required this.room});

  @override
  ConsumerState<_StaySheet> createState() => _StaySheetState();
}

class _StaySheetState extends ConsumerState<_StaySheet> {
  bool _busy = false;

  Future<void> _run(Future<bool> Function(BookingActions) action) async {
    setState(() => _busy = true);
    final changed = await action(BookingActions(context, ref));
    if (!mounted) return;
    setState(() => _busy = false);
    if (changed) Navigator.of(context).pop(true);
  }

  Future<bool> _cancel(BookingActions actions) => actions.cancel(
    widget.booking.id,
    roomNumber: widget.room.room.roomNumber,
    checkInDate: widget.booking.checkInDate,
  );

  /// A stay's nights — the last night before checkout, not checkout itself,
  /// the same count the web tooltip's own "N nights" line gives.
  int _nights(TapeChartBooking booking) {
    final inD = DateTime.tryParse(booking.checkInDate ?? '');
    final outD = DateTime.tryParse(booking.checkOutDate ?? '');
    if (inD == null || outD == null) return 0;
    return outD.difference(inD).inDays;
  }

  @override
  Widget build(BuildContext context) {
    final booking = widget.booking;
    final room = widget.room.room;
    final checkInOpen = BookingActions.checkInOpen(booking.checkInDate);
    final nights = _nights(booking);

    return Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.symmetric(
        horizontal: AppTheme.s16,
        vertical: AppTheme.s24,
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Container(
          decoration: BoxDecoration(
            color: AppTheme.card,
            borderRadius: BorderRadius.circular(AppTheme.rLarge),
            boxShadow: AppTheme.elevated,
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // The stay's own identity card, styled exactly as the web tape
              // chart's hover tooltip is: a deep violet-ink surface rather
              // than a neutral dark, because this floats over a chart whose
              // every other colour is either the brand violet or a status
              // hue — a plain black card would read as a system popup rather
              // than a surface belonging to this screen.
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppTheme.s16,
                  AppTheme.s16,
                  AppTheme.s16,
                  AppTheme.s12,
                ),
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(AppTheme.s16),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1B1436),
                    borderRadius: BorderRadius.circular(AppTheme.rMedium),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Container(
                            width: 8,
                            height: 8,
                            margin: const EdgeInsets.only(right: 6),
                            decoration: BoxDecoration(
                              color: BookingActions.statusColor(booking.status),
                              shape: BoxShape.circle,
                            ),
                          ),
                          Text(
                            BookingActions.statusLabel(booking.status)
                                .toUpperCase(),
                            style: const TextStyle(
                              color: Colors.white70,
                              fontSize: 9.5,
                              fontWeight: FontWeight.w700,
                              letterSpacing: 1.1,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        booking.guestName ?? 'Guest',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Room ${room.roomNumber} · ${room.categoryName}',
                        style: const TextStyle(
                          color: Colors.white70,
                          fontSize: 12,
                        ),
                      ),
                      Container(
                        margin: const EdgeInsets.only(top: 6),
                        padding: const EdgeInsets.only(top: 6),
                        decoration: const BoxDecoration(
                          border: Border(
                            top: BorderSide(color: Colors.white24),
                          ),
                        ),
                        child: Row(
                          children: [
                            Text(
                              formatIsoDate(booking.checkInDate),
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 12,
                                fontFeatures: [FontFeature.tabularFigures()],
                              ),
                            ),
                            const Text(
                              '  →  ',
                              style: TextStyle(color: Colors.white54, fontSize: 12),
                            ),
                            Text(
                              formatIsoDate(booking.checkOutDate),
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 12,
                                fontFeatures: [FontFeature.tabularFigures()],
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${nightsLabel(nights)}'
                        '${booking.guestPhone != null ? ' · ${booking.guestPhone}' : ''}',
                        style: const TextStyle(
                          color: Colors.white70,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppTheme.s16,
                  0,
                  AppTheme.s16,
                  AppTheme.s16,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
              // Advance and balance aren't on the chart's own lean fetch —
              // only the total is. "View full details" below is where the
              // rest of the money (and everything else the register knows)
              // actually lives.
              _Money(label: 'Total', value: booking.totalPrice),
              const SizedBox(height: AppTheme.s16),
              if (booking.status == 'BOOKED') ...[
                if (checkInOpen)
                  Row(
                    children: [
                      Expanded(
                        child: NeuButton(
                          primary: true,
                          expand: true,
                          onPressed: _busy
                              ? null
                              : () => _run(
                                  (a) => a.checkIn(
                                    booking.id,
                                    guestName: booking.guestName,
                                  ),
                                ),
                          child: const Text('Check in'),
                        ),
                      ),
                      const SizedBox(width: AppTheme.s8),
                      Expanded(
                        child: NeuButton(
                          expand: true,
                          onPressed: _busy ? null : () => _run(_cancel),
                          child: const Text('Cancel'),
                        ),
                      ),
                    ],
                  )
                else ...[
                  Text(
                    'Check-in opens ${formatIsoDate(booking.checkInDate)}.',
                    style: const TextStyle(color: AppTheme.muted, fontSize: 12),
                  ),
                  const SizedBox(height: AppTheme.s8),
                  NeuButton(
                    expand: true,
                    onPressed: _busy ? null : () => _run(_cancel),
                    child: const Text('Cancel booking'),
                  ),
                ],
              ] else if (booking.status == 'CHECKED_IN') ...[
                NeuButton(
                  expand: true,
                  onPressed: _busy
                      ? null
                      : () => _run((a) => a.checkOut(booking.id)),
                  child: const Text('Check out'),
                ),
              ],
              const SizedBox(height: AppTheme.s8),
              Center(
                child: TextButton(
                  onPressed: () async {
                    final changed = await Navigator.of(context).push<bool>(
                      MaterialPageRoute(
                        builder: (_) =>
                            BookingDetailScreen(bookingId: booking.id),
                      ),
                    );
                    if (changed == true && context.mounted) {
                      Navigator.of(context).pop(true);
                    }
                  },
                  child: const Text('View full details'),
                ),
              ),
                ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Money extends StatelessWidget {
  final String label;
  final num? value;
  final String? note;
  final bool strong;

  const _Money({
    required this.label,
    required this.value,
    this.note,
    this.strong = false,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(label, style: Theme.of(context).textTheme.bodySmall),
        Text(
          formatPrice(value),
          style: TextStyle(
            color: strong ? AppTheme.heading : AppTheme.text,
            fontSize: strong ? 16 : 14,
            fontWeight: strong ? FontWeight.w500 : FontWeight.w400,
          ),
        ),
        if (note != null && note!.isNotEmpty)
          Text(
            note!,
            style: const TextStyle(color: AppTheme.muted, fontSize: 11),
          ),
      ],
    );
  }
}
