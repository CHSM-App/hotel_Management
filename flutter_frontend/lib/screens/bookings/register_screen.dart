import 'package:flutter/material.dart';
import '../../widgets/compact_date_picker.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/booking.dart';
import '../../domain/models/draft.dart';
import '../../presentation/providers/usecase_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../reports/report_widgets.dart';
import '../theme.dart';
import 'booking_actions.dart';
import 'booking_detail_screen.dart';
import 'take_booking_screen.dart';
import '../../widgets/adaptive_grid.dart';
import '../../widgets/h_scroll_table.dart';

/// The guest register: every stay whose dates overlap a range, searchable and
/// cut by status, with the same summary strip the web's own Guest register
/// page opens on. See frontend/src/pages/lodge/GuestRegister.jsx — this is
/// its list and its stat tiles, laid out as cards rather than a wide table (a
/// phone has no room for eight columns), with sorting, drafts and the deep
/// ID-proof viewer left to the web desk that already has them.
class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  late String _fromDate = _startOfMonth();
  late String _toDate = _today();
  String _search = '';
  final _searchController = TextEditingController();

  /// Empty means "no cut" — the same meaning 'ALL' carries on the web page.
  final Set<String> _statuses = {};

  /// Desktop only: the register as a table (default) or as cards.
  bool _asTable = true;

  List<Booking>? _bookings;
  List<BookingDraft> _drafts = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
    _stretchToDateForFutureBookings();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  static String _iso(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-'
      '${d.month.toString().padLeft(2, '0')}-'
      '${d.day.toString().padLeft(2, '0')}';

  static String _today() => _iso(DateTime.now());

  static String _startOfMonth() {
    final now = DateTime.now();
    return _iso(DateTime(now.year, now.month, 1));
  }

  /// The default range's end is "today", but a lodge with reservations
  /// further out than that would open this screen already hiding them — and
  /// showing fewer rows than the web register, whose own page does this same
  /// stretch. Asks once, unfiltered, for the latest checkout on file and
  /// pulls the opening 'To' out to meet it. Only stretches forward, and only
  /// while 'To' is still the default: a range the desk has since chosen by
  /// hand is left alone.
  Future<void> _stretchToDateForFutureBookings() async {
    try {
      final all = await ref.read(bookingUsecaseProvider).bookings();
      if (!mounted) return;
      var latest = '';
      for (final b in all) {
        final co = b.checkOutDate;
        if (co != null && co.compareTo(latest) > 0) latest = co;
      }
      final today = _today();
      if (latest.compareTo(today) > 0 && _toDate == today) {
        setState(() => _toDate = latest);
        await _load();
      }
    } catch (_) {
      // Best-effort widening — a failed probe leaves the default range in
      // place rather than blocking the register the desk actually asked for.
    }
  }

  /// [silent] skips the full-list spinner — used coming back from a stay's
  /// own detail screen, where the list underneath is already on the right
  /// range and losing it to a blank loader for the moment a refetch takes
  /// would read as the whole register reloading rather than one row
  /// quietly catching up.
  Future<void> _load({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final rows = await ref
          .read(bookingUsecaseProvider)
          .bookings(fromDate: _fromDate, toDate: _toDate);
      // Drafts have no date range: some are parked before room or dates are
      // chosen. Keep them available to the register's Draft filter.
      final drafts = await ref
          .read(bookingUsecaseProvider)
          .drafts()
          .catchError((_) => <BookingDraft>[]);
      if (!mounted) return;
      setState(() {
        _bookings = rows;
        _drafts = drafts;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      // A silent refresh that fails leaves the list exactly as it was —
      // the desk didn't ask for this fetch, so it shouldn't lose the rows
      // it can already see over it failing quietly in the background.
      if (silent) return;
      setState(() {
        _loading = false;
        _error = 'Could not load the register.';
      });
    }
  }

  void _setRange(String from, String to) {
    setState(() {
      _fromDate = from;
      _toDate = to.compareTo(from) < 0 ? from : to;
    });
    _load();
  }

  void _toggleStatus(String key) {
    setState(() {
      if (_statuses.contains(key)) {
        _statuses.remove(key);
      } else {
        _statuses.add(key);
      }
    });
  }

  void _clearStatuses() => setState(_statuses.clear);

  /// Quick date ranges for the filter sheet: key, label, and the From/To
  /// they stand for as of today.
  static const _kRangePresets = [
    ('today', 'Today'),
    ('last7', 'Last 7 days'),
    ('month', 'This month'),
    ('lastMonth', 'Last month'),
  ];

  static (String, String) _presetRange(String key) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    return switch (key) {
      'today' => (_iso(today), _iso(today)),
      'last7' => (_iso(today.subtract(const Duration(days: 6))), _iso(today)),
      'lastMonth' => (
        _iso(DateTime(now.year, now.month - 1, 1)),
        _iso(DateTime(now.year, now.month, 0)),
      ),
      _ => (_iso(DateTime(now.year, now.month, 1)), _iso(today)),
    };
  }

  /// The date shortcuts and the status cut, in one bottom sheet behind the
  /// funnel icon. Statuses are multi-select, so the sheet stays open and
  /// rebuilds itself as they toggle; a date shortcut applies and closes.
  Future<void> _openFilter() {
    return showNeuFilterSheet(
      context,
      multi: true,
      (close) => StatefulBuilder(
        builder: (context, setSheet) {
          final counts = <String, int>{};
          for (final b in _searched) {
            counts[b.status ?? ''] = (counts[b.status ?? ''] ?? 0) + 1;
          }
          counts['DRAFT'] = _searchedDrafts.length;
          return NeuFilterPanel(
            title: 'DATE',
            children: [
              for (final (key, label) in _kRangePresets)
                NeuFilterRow(
                  label: label,
                  on: (_presetRange(key) == (_fromDate, _toDate)),
                  icon: Icons.event_rounded,
                  onTap: () {
                    final (from, to) = _presetRange(key);
                    _setRange(from, to);
                    close();
                  },
                ),
              const NeuFilterSection('STATUS'),
              NeuFilterRow(
                label: 'All',
                count: _searched.length + _searchedDrafts.length,
                on: _statuses.isEmpty,
                icon: Icons.apps_rounded,
                onTap: () {
                  _clearStatuses();
                  setSheet(() {});
                },
              ),
              for (final key in _kStatusOrder)
                NeuFilterRow(
                  label: kRegisterStatusLabel[key]!,
                  count: counts[key] ?? 0,
                  on: _statuses.contains(key),
                  color: BookingActions.statusColor(key),
                  icon: _kStatusIcon[key]!,
                  onTap: () {
                    _toggleStatus(key);
                    setSheet(() {});
                  },
                ),
              NeuFilterRow(
                label: 'Draft',
                count: counts['DRAFT'] ?? 0,
                on: _statuses.contains('DRAFT'),
                color: AppTheme.draft,
                icon: Icons.edit_note_rounded,
                onTap: () {
                  _toggleStatus('DRAFT');
                  setSheet(() {});
                },
              ),
            ],
          );
        },
      ),
      onReset: () {
        _clearStatuses();
        _setRange(_startOfMonth(), _today());
      },
    );
  }

  List<Booking> get _searched {
    final rows = _bookings;
    if (rows == null) return const [];
    final query = _search.trim().toLowerCase();
    if (query.isEmpty) return rows;
    return rows.where((b) {
      if ((b.guestName ?? '').toLowerCase().contains(query)) return true;
      if ((b.roomNumber ?? '').toLowerCase().contains(query)) return true;
      if ((b.invoiceNumber ?? '').toLowerCase().contains(query)) return true;
      if ((b.bookingNumber ?? '').toLowerCase().contains(query)) return true;
      if ((b.guestPhone ?? '').contains(query)) return true;
      return b.coGuestNames.any((n) => n.toLowerCase().contains(query));
    }).toList();
  }

  List<Booking> get _filtered {
    final rows = _searched;
    if (_statuses.isEmpty) return rows;
    return rows.where((b) => _statuses.contains(b.status)).toList();
  }

  List<BookingDraft> get _searchedDrafts {
    final query = _search.trim().toLowerCase();
    if (query.isEmpty) return _drafts;
    return _drafts.where((d) {
      final form = d.form;
      return (d.guestName ?? form.guestName).toLowerCase().contains(query) ||
          (d.roomNumber ?? '').toLowerCase().contains(query) ||
          form.guestPhone.toLowerCase().contains(query);
    }).toList();
  }

  List<BookingDraft> get _filteredDrafts =>
      _statuses.isEmpty || _statuses.contains('DRAFT')
      ? _searchedDrafts
      : const [];

  Future<void> _open(Booking b) async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => BookingDetailScreen(bookingId: b.id)),
    );
    _load(silent: true);
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _filtered;
    final showingStays =
        _statuses.isEmpty || _statuses.any((s) => s != 'DRAFT');
    final visibleBookings = showingStays ? filtered : const <Booking>[];
    final visibleDrafts = _filteredDrafts;

    return RefreshIndicator(
      onRefresh: _load,
      color: AppTheme.accent,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          AppTheme.s16,
          AppTheme.s12,
          AppTheme.s16,
          AppTheme.s32,
        ),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          _RangeAndSearch(
            fromDate: _fromDate,
            toDate: _toDate,
            searchController: _searchController,
            searchNotEmpty: _search.isNotEmpty,
            activeFilterCount: _statuses.length,
            onFromTo: _setRange,
            onSearch: (v) => setState(() => _search = v),
            onToggleFilter: _openFilter,
          ),
          const SizedBox(height: AppTheme.s16),
          if (_loading)
            const ReportLoading()
          else if (_error != null)
            ReportError(message: _error!)
          else ...[
            if (visibleBookings.isEmpty && visibleDrafts.isEmpty)
              const NeuNotice(
                icon: Icons.groups_outlined,
                message: 'No guests match this range and filter.',
              )
            else ...[
              if (AppTheme.isDesktop(context))
                _RegisterHeader(
                  count: visibleBookings.length,
                  asTable: _asTable,
                  onChanged: (v) => setState(() => _asTable = v),
                ),
              if (AppTheme.isDesktop(context) && _asTable)
                _RegisterTable(bookings: visibleBookings, onOpen: _open)
              else
                AdaptiveGrid(
                  minTileWidth: 440,
                  children: [
                    for (final b in visibleBookings)
                      _RegisterCard(booking: b, onTap: () => _open(b)),
                  ],
                ),
            ],
            if (visibleDrafts.isNotEmpty)
              AdaptiveGrid(
                minTileWidth: 440,
                children: [
                  for (final d in visibleDrafts)
                    _DraftRegisterCard(
                      draft: d,
                      onTap: () async {
                        await Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => TakeBookingScreen(draft: d),
                          ),
                        );
                        _load(silent: true);
                      },
                    ),
                ],
              ),
          ],
        ],
      ),
    );
  }
}

/// The register's own words for a status — "Reserved" and "Stayed" rather
/// than "Booked" and "Checked out", the way the web page's own filter chips
/// and status column word it (STAY_STATUS_CHIP_LABEL). Kept apart from
/// [BookingActions.statusLabel], which is what the detail screen's header
/// still uses.
const kRegisterStatusLabel = <String, String>{
  'BOOKED': 'Reserved',
  'CHECKED_IN': 'Checked in',
  'CHECKED_OUT': 'Stayed',
  'CANCELLED': 'Cancelled',
};

const _kStatusOrder = ['CHECKED_IN', 'BOOKED', 'CHECKED_OUT', 'CANCELLED'];

/// One icon per status — a chip carries its type at a glance rather than
/// relying on the label alone, the same way the tape chart's own tiles are
/// told apart by more than colour.
const _kStatusIcon = <String, IconData>{
  'CHECKED_IN': Icons.login_rounded,
  'BOOKED': Icons.event_available_rounded,
  'CHECKED_OUT': Icons.logout_rounded,
  'CANCELLED': Icons.cancel_rounded,
};

// ── Range + search ───────────────────────────────────────────────────────────

class _RangeAndSearch extends StatelessWidget {
  final String fromDate;
  final String toDate;
  final TextEditingController searchController;
  final bool searchNotEmpty;
  final int activeFilterCount;
  final void Function(String from, String to) onFromTo;
  final ValueChanged<String> onSearch;
  final VoidCallback onToggleFilter;

  const _RangeAndSearch({
    required this.fromDate,
    required this.toDate,
    required this.searchController,
    required this.searchNotEmpty,
    required this.activeFilterCount,
    required this.onFromTo,
    required this.onSearch,
    required this.onToggleFilter,
  });

  @override
  Widget build(BuildContext context) {
    final from = _DateField(
      label: 'From',
      value: fromDate,
      onPick: (v) => onFromTo(v, toDate),
    );
    final to = _DateField(
      label: 'To',
      value: toDate,
      minDate: fromDate,
      onPick: (v) => onFromTo(fromDate, v),
    );
    final search = Container(
                height: 40,
                padding: const EdgeInsets.symmetric(horizontal: AppTheme.s4),
                decoration: BoxDecoration(
                  color: AppTheme.card,
                  borderRadius: AppTheme.searchRadius(context),
                  border: AppTheme.searchBorder(context),
                  boxShadow: AppTheme.subtle,
                ),
                child: Row(
                  children: [
                    Container(
                      width: 28,
                      height: 28,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: AppTheme.accent.withValues(alpha: 0.10),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.search_rounded,
                        size: 15,
                        color: AppTheme.accent,
                      ),
                    ),
                    const SizedBox(width: AppTheme.s8),
                    Expanded(
                      child: TextField(
                        onChanged: onSearch,
                        controller: searchController,
                        style: const TextStyle(
                          color: AppTheme.heading,
                          fontSize: 14,
                        ),
                        decoration: const InputDecoration(
                          hintText: 'Name, room, phone or bill number',
                          hintStyle: TextStyle(
                            color: AppTheme.muted,
                            fontSize: 14,
                          ),
                          border: InputBorder.none,
                          isDense: true,
                          contentPadding: EdgeInsets.symmetric(vertical: 10),
                        ),
                      ),
                    ),
                    if (searchNotEmpty)
                      GestureDetector(
                        onTap: () {
                          searchController.clear();
                          onSearch('');
                        },
                        behavior: HitTestBehavior.opaque,
                        child: Container(
                          width: 26,
                          height: 26,
                          margin: const EdgeInsets.only(right: 2),
                          alignment: Alignment.center,
                          decoration: const BoxDecoration(
                            color: AppTheme.bg,
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(
                            Icons.close_rounded,
                            size: 15,
                            color: AppTheme.muted,
                          ),
                        ),
                      ),
                  ],
                ),
              );
    final filter = _FilterButton(
      count: activeFilterCount,
      onTap: onToggleFilter,
    );
    if (AppTheme.isDesktop(context)) {
      return Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          SizedBox(width: 220, child: from),
          const SizedBox(width: AppTheme.s8),
          SizedBox(width: 220, child: to),
          const SizedBox(width: AppTheme.s12),
          Expanded(child: search),
          const SizedBox(width: AppTheme.s8),
          filter,
        ],
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(child: from),
            const SizedBox(width: AppTheme.s8),
            Expanded(child: to),
          ],
        ),
        const SizedBox(height: AppTheme.s8),
        Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(child: search),
            const SizedBox(width: AppTheme.s8),
            filter,
          ],
        ),
      ],
    );
  }
}

/// The status cut's own door — a funnel icon with a badge naming how many
/// statuses are on, right beside the search box and stretched to match its
/// height exactly ([IntrinsicHeight] on the row that holds both). Tapping it
/// folds the status chips open directly underneath, rather than opening a
/// sheet over the rest of the screen.
class _FilterButton extends StatelessWidget {
  final int count;
  final VoidCallback onTap;

  const _FilterButton({required this.count, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final on = count > 0;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 40,
        height: 40,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          gradient: on
              ? const LinearGradient(
                  colors: [AppTheme.accent, AppTheme.sidebarBrand],
                )
              : null,
          color: on ? null : AppTheme.card,
          shape: BoxShape.circle,
          border: on
              ? null
              : Border.all(color: AppTheme.shadowDark, width: 1.3),
          boxShadow: on
              ? [
                  BoxShadow(
                    color: AppTheme.accent.withValues(alpha: 0.3),
                    blurRadius: 8,
                    offset: const Offset(0, 2),
                  ),
                ]
              : AppTheme.subtle,
        ),
        child: Stack(
          clipBehavior: Clip.none,
          alignment: Alignment.center,
          children: [
            Icon(
              Icons.filter_alt_rounded,
              size: 17,
              color: on ? Colors.white : AppTheme.accent,
            ),
            if (count > 0)
              Positioned(
                top: -4,
                right: -6,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 4,
                    vertical: 1,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    shape: BoxShape.circle,
                    border: Border.all(color: AppTheme.accent, width: 1.2),
                  ),
                  constraints: const BoxConstraints(
                    minWidth: 16,
                    minHeight: 16,
                  ),
                  child: Text(
                    '$count',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: AppTheme.accent,
                      fontSize: 9,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _DateField extends StatelessWidget {
  final String label;
  final String value;
  final String? minDate;
  final ValueChanged<String> onPick;

  const _DateField({
    required this.label,
    required this.value,
    required this.onPick,
    this.minDate,
  });

  static const _months = [
    '',
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

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
            lastDate: DateTime(now.year + 1),
          );
          if (picked == null) return;
          onPick(_RegisterScreenState._iso(picked));
        },
        borderRadius: BorderRadius.circular(999),
        highlightColor: AppTheme.accent.withValues(alpha: 0.05),
        splashColor: AppTheme.accent.withValues(alpha: 0.08),
        child: Container(
          height: 42,
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
                width: 26,
                height: 26,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppTheme.accent.withValues(alpha: 0.14),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.calendar_today_rounded,
                  size: 13,
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
                        fontSize: 9,
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
                        fontSize: 12,
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

class _DraftRegisterCard extends StatelessWidget {
  final BookingDraft draft;
  final VoidCallback onTap;

  const _DraftRegisterCard({required this.draft, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final form = draft.form;
    final name = (draft.guestName ?? form.guestName).trim();
    final dates = [
      draft.checkInDate,
      draft.checkOutDate,
    ].whereType<String>().join(' – ');
    return GestureDetector(
      onTap: onTap,
      child: NeuCard(
        radius: AppTheme.rMedium,
        shadow: AppTheme.extruded,
        padding: const EdgeInsets.all(AppTheme.s16),
        child: Row(
          children: [
            Container(
              width: 4,
              height: 52,
              decoration: BoxDecoration(
                color: AppTheme.draft,
                borderRadius: BorderRadius.circular(4),
              ),
            ),
            const SizedBox(width: AppTheme.s12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name.isEmpty ? 'Draft booking' : name,
                    style: const TextStyle(
                      color: AppTheme.heading,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    [
                      if (draft.roomNumber != null) 'Room ${draft.roomNumber}',
                      if (dates.isNotEmpty) dates,
                      'Draft',
                    ].join(' · '),
                    style: const TextStyle(color: AppTheme.muted, fontSize: 12),
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right_rounded, color: AppTheme.muted),
          ],
        ),
      ),
    );
  }
}

// ── One row ───────────────────────────────────────────────────────────────

// ── Desktop: count + cards/table toggle, and the register table ─────────────

class _RegisterHeader extends StatelessWidget {
  final int count;
  final bool asTable;
  final ValueChanged<bool> onChanged;

  const _RegisterHeader({
    required this.count,
    required this.asTable,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    Widget seg(bool table, IconData icon, String tip) {
      final on = asTable == table;
      return Tooltip(
        message: tip,
        child: InkWell(
          borderRadius: BorderRadius.circular(AppTheme.rSmall),
          onTap: () => onChanged(table),
          child: AnimatedContainer(
            duration: AppMotion.short,
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: on ? AppTheme.accent : Colors.transparent,
              borderRadius: BorderRadius.circular(AppTheme.rSmall),
            ),
            child: Icon(
              icon,
              size: 18,
              color: on ? Colors.white : AppTheme.muted,
            ),
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: AppTheme.s12),
      child: Row(
        children: [
          Text(
            '$count ${count == 1 ? 'stay' : 'stays'}',
            style: const TextStyle(
              color: AppTheme.muted,
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
            ),
          ),
          const Spacer(),
          Container(
            padding: const EdgeInsets.all(2),
            decoration: BoxDecoration(
              color: AppTheme.card,
              borderRadius: BorderRadius.circular(AppTheme.rSmall + 2),
              border: Border.all(color: AppTheme.border),
            ),
            child: Row(
              children: [
                seg(true, Icons.table_rows_rounded, 'Table'),
                seg(false, Icons.view_agenda_rounded, 'Cards'),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _RegisterTable extends StatelessWidget {
  final List<Booking> bookings;
  final ValueChanged<Booking> onOpen;

  const _RegisterTable({required this.bookings, required this.onOpen});

  static const _cols = <(String, double, bool)>[
    ('Booking no.', 120, false),
    ('Guest', 200, false),
    ('Phone', 120, false),
    ('Room', 170, false),
    ('Came in', 160, false),
    ('Left', 160, false),
    ('Status', 120, false),
    ('Amount', 110, true),
  ];

  @override
  Widget build(BuildContext context) {
    final width = _cols.fold<double>(0, (sum, c) => sum + c.$2);
    return NeuCard(
      padding: EdgeInsets.zero,
      radius: AppTheme.rMedium,
      shadow: AppTheme.subtle,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        child: HScrollTable(
          rowsScrollbar: true,
          child: TableSheet(
            width: width,
            child: StickyHeaderTable(
              header: Container(
                decoration: const BoxDecoration(
                  color: AppTheme.sidebarBrandWash,
                  border: Border(
                    bottom: BorderSide(
                      color: AppTheme.sidebarBrandWashEdge,
                      width: 0.8,
                    ),
                  ),
                ),
                child: Row(
                  children: [
                    for (final c in _cols)
                      TableCol(
                        width: c.$2,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: AppTheme.s8,
                            vertical: 10,
                          ),
                          child: Text(
                            c.$1.toUpperCase(),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            textAlign: c.$3 ? TextAlign.right : TextAlign.left,
                            style: const TextStyle(
                              color: Colors.black,
                              fontSize: 10.5,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 0.3,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              rows: [
                for (var i = 0; i < bookings.length; i++)
                  _RegisterTableRow(
                    booking: bookings[i],
                    shaded: i.isOdd,
                    onTap: () => onOpen(bookings[i]),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _RegisterTableRow extends StatefulWidget {
  final Booking booking;
  final bool shaded;
  final VoidCallback onTap;

  const _RegisterTableRow({
    required this.booking,
    required this.shaded,
    required this.onTap,
  });

  @override
  State<_RegisterTableRow> createState() => _RegisterTableRowState();
}

class _RegisterTableRowState extends State<_RegisterTableRow> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    final b = widget.booking;
    final cameIn = b.actualCheckInAt;
    final left = b.actualCheckOutAt;
    final statusColor = BookingActions.statusColor(b.status);

    Widget cell(int i, Widget child, {double v = 12}) => TableCol(
      width: _RegisterTable._cols[i].$2,
      child: Padding(
        padding: EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: v),
        child: child,
      ),
    );
    Widget txt(String t, {Color c = AppTheme.text, FontWeight w = FontWeight.w500, TextAlign? a}) => Text(
      t,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      textAlign: a,
      style: TextStyle(color: c, fontSize: 12.5, fontWeight: w),
    );

    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() => _hover = false),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: widget.onTap,
        child: AnimatedContainer(
          duration: AppMotion.short,
          decoration: BoxDecoration(
            color: _hover
                ? AppTheme.accent.withValues(alpha: 0.06)
                : widget.shaded
                ? AppTheme.border.withValues(alpha: 0.25)
                : AppTheme.card,
            border: const Border(
              bottom: BorderSide(color: AppTheme.border, width: 0.8),
            ),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              cell(0, txt(b.bookingNumber ?? '—', c: AppTheme.muted, w: FontWeight.w700)),
              cell(
                1,
                txt(
                  (b.guestName ?? '').trim().isEmpty
                      ? 'Guest'
                      : capitalizeWords(b.guestName),
                  c: AppTheme.heading,
                  w: FontWeight.w700,
                ),
              ),
              cell(2, txt((b.guestPhone ?? '').isEmpty ? '—' : b.guestPhone!)),
              cell(
                3,
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppTheme.sidebarBrandWash,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        b.roomNumber ?? '—',
                        style: const TextStyle(
                          color: AppTheme.sidebarBrandInk,
                          fontSize: 11.5,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    if ((b.categoryName ?? '').isNotEmpty) ...[
                      const SizedBox(width: 6),
                      Flexible(child: txt(b.categoryName!, c: AppTheme.muted)),
                    ],
                  ],
                ),
              ),
              cell(
                4,
                txt(
                  cameIn != null
                      ? formatDateTime(cameIn)
                      : 'Due ${formatIsoDate(b.checkInDate)}',
                  c: cameIn != null ? AppTheme.text : AppTheme.muted,
                ),
              ),
              cell(
                5,
                txt(
                  left != null
                      ? formatDateTime(left)
                      : cameIn != null
                      ? 'Still staying'
                      : 'Due ${formatIsoDate(b.checkOutDate)}',
                  c: left != null ? AppTheme.text : AppTheme.muted,
                ),
              ),
              cell(
                6,
                Align(
                  alignment: Alignment.centerLeft,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                    decoration: BoxDecoration(
                      color: statusColor.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(_kStatusIcon[b.status] ?? Icons.circle, size: 11, color: statusColor),
                        const SizedBox(width: 4),
                        Text(
                          kRegisterStatusLabel[b.status] ?? b.status ?? '',
                          style: TextStyle(
                            color: statusColor,
                            fontSize: 10.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              cell(
                7,
                txt(
                  formatPrice(b.billAmount ?? b.totalPrice),
                  c: AppTheme.accent,
                  w: FontWeight.w800,
                  a: TextAlign.right,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}


class _RegisterCard extends StatelessWidget {
  final Booking booking;
  final VoidCallback onTap;

  const _RegisterCard({required this.booking, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final b = booking;
    final cameIn = b.actualCheckInAt;
    final left = b.actualCheckOutAt;
    final amount = b.billAmount ?? b.totalPrice;
    final statusColor = BookingActions.statusColor(b.status);

    return GestureDetector(
      onTap: onTap,
      child: NeuCard(
        radius: AppTheme.rMedium,
        shadow: AppTheme.extruded,
        padding: EdgeInsets.zero,
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    AppTheme.s16,
                    AppTheme.s12,
                    AppTheme.s12,
                    AppTheme.s12,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              (b.guestName ?? '').trim().isEmpty
                                  ? 'Guest'
                                  : capitalizeWords(b.guestName),
                              style: const TextStyle(
                                color: AppTheme.heading,
                                fontWeight: FontWeight.w700,
                                fontSize: 15,
                                letterSpacing: -0.1,
                              ),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          const SizedBox(width: AppTheme.s8),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 9,
                              vertical: 4,
                            ),
                            decoration: BoxDecoration(
                              color: statusColor.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(999),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  _kStatusIcon[b.status] ?? Icons.circle,
                                  size: 11,
                                  color: statusColor,
                                ),
                                const SizedBox(width: 4),
                                Text(
                                  kRegisterStatusLabel[b.status] ??
                                      b.status ??
                                      '',
                                  style: TextStyle(
                                    color: statusColor,
                                    fontSize: 10,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 3),
                      Text(
                        '${b.bookingNumber != null ? '${b.bookingNumber} · ' : ''}'
                        'Room ${b.roomNumber ?? '—'}'
                        '${b.categoryName != null ? ' · ${b.categoryName}' : ''}'
                        '${(b.guestPhone ?? '').isNotEmpty ? ' · ${b.guestPhone}' : ''}',
                        style: const TextStyle(
                          color: AppTheme.muted,
                          fontSize: 11.5,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: AppTheme.s12),
                      Container(height: 1, color: AppTheme.border),
                      const SizedBox(height: AppTheme.s12),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            flex: 3,
                            child: _Field(
                              label: 'Came in',
                              value: cameIn != null
                                  ? formatDateTime(cameIn)
                                  : 'Due ${formatIsoDate(b.checkInDate)}',
                            ),
                          ),
                          const SizedBox(width: AppTheme.s8),
                          Expanded(
                            flex: 3,
                            child: _Field(
                              label: 'Left',
                              value: left != null
                                  ? formatDateTime(left)
                                  : cameIn != null
                                  ? 'Still staying'
                                  : 'Due ${formatIsoDate(b.checkOutDate)}',
                            ),
                          ),
                          const SizedBox(width: AppTheme.s8),
                          Expanded(
                            flex: 2,
                            child: _Field(
                              label: 'Amount',
                              value: formatPrice(amount),
                              accent: true,
                              alignEnd: true,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Field extends StatelessWidget {
  final String label;
  final String value;
  final bool accent;
  final bool alignEnd;

  const _Field({
    required this.label,
    required this.value,
    this.accent = false,
    this.alignEnd = false,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: alignEnd
          ? CrossAxisAlignment.end
          : CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            color: AppTheme.muted,
            fontSize: 10,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          textAlign: alignEnd ? TextAlign.end : TextAlign.start,
          style: TextStyle(
            color: accent ? AppTheme.accent : AppTheme.heading,
            fontSize: accent ? 13 : 12,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }
}
