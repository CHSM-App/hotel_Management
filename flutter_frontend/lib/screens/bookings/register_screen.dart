import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/booking.dart';
import '../../presentation/providers/usecase_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../reports/report_widgets.dart';
import '../theme.dart';
import 'booking_actions.dart';
import 'booking_detail_screen.dart';

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

  List<Booking>? _bookings;
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

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rows = await ref
          .read(bookingUsecaseProvider)
          .bookings(fromDate: _fromDate, toDate: _toDate);
      if (!mounted) return;
      setState(() {
        _bookings = rows;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Could not load the register.';
      });
    }
  }

  void _setRange(String from, String to) {
    setState(() {
      _fromDate = from;
      _toDate = to;
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

  /// The status cut, behind its own icon rather than sitting permanently on
  /// screen — folds open right under the search bar rather than in a sheet,
  /// so choosing a chip and seeing the list answer it happen in the same
  /// place, one tap apart.
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

  List<Booking> get _searched {
    final rows = _bookings;
    if (rows == null) return const [];
    final query = _search.trim().toLowerCase();
    if (query.isEmpty) return rows;
    return rows.where((b) {
      if ((b.guestName ?? '').toLowerCase().contains(query)) return true;
      if ((b.roomNumber ?? '').toLowerCase().contains(query)) return true;
      if ((b.invoiceNumber ?? '').toLowerCase().contains(query)) return true;
      if ((b.guestPhone ?? '').contains(query)) return true;
      return b.coGuestNames.any((n) => n.toLowerCase().contains(query));
    }).toList();
  }

  List<Booking> get _filtered {
    final rows = _searched;
    if (_statuses.isEmpty) return rows;
    return rows.where((b) => _statuses.contains(b.status)).toList();
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _filtered;
    final stats = _Stats.of(filtered);
    final counts = <String, int>{};
    for (final b in _searched) {
      counts[b.status ?? ''] = (counts[b.status ?? ''] ?? 0) + 1;
    }

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
            filterOpen: _filterOpen,
            filterLink: _filterLink,
            filterPortalController: _filterPortalController,
            filterOverlayBuilder: (context) => Stack(
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
                      child: _StatusChips(
                        selected: _statuses,
                        counts: counts,
                        allCount: _searched.length,
                        onToggle: (key) {
                          _toggleStatus(key);
                          _toggleFilterOpen();
                        },
                        onClearAll: () {
                          _clearStatuses();
                          _toggleFilterOpen();
                        },
                      ),
                    ),
                  ),
                ),
              ],
            ),
            onFromTo: _setRange,
            onSearch: (v) => setState(() => _search = v),
            onToggleFilter: _toggleFilterOpen,
          ),
          const SizedBox(height: AppTheme.s16),
          if (_loading)
            const ReportLoading()
          else if (_error != null)
            ReportError(message: _error!)
          else ...[
            _CompactStatGrid(
              items: [
                _Stat(
                  label: 'Stays',
                  value: '${stats.stays}',
                  note: stats.cancelled > 0 ? '${stats.cancelled} cancelled' : null,
                ),
                _Stat(
                  label: 'Guests',
                  value: '${stats.people}',
                  note: 'people booked in',
                ),
                _Stat(
                  label: 'In house',
                  value: '${stats.inHouse}',
                  note: 'not checked out yet',
                ),
                _Stat(
                  label: 'Billed',
                  value: formatPrice(stats.billedAmount),
                  note: '${stats.billedCount} '
                      '${stats.billedCount == 1 ? 'bill' : 'bills'} issued',
                  accent: true,
                ),
                if (stats.pending > 0)
                  _Stat(
                    label: 'Pending',
                    value: formatPrice(stats.pending),
                    note: '${stats.pendingCount} '
                        '${stats.pendingCount == 1 ? 'stay' : 'stays'} not billed yet',
                  ),
              ],
            ),
            const SizedBox(height: AppTheme.s16),
            if (filtered.isEmpty)
              const NeuNotice(
                icon: Icons.groups_outlined,
                message: 'No guests match this range and filter.',
              )
            else
              for (final b in filtered)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppTheme.s8),
                  child: _RegisterCard(
                    booking: b,
                    onTap: () async {
                      await Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => BookingDetailScreen(bookingId: b.id),
                        ),
                      );
                      _load();
                    },
                  ),
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

class _Stats {
  final int stays;
  final int people;
  final int inHouse;
  final num billedAmount;
  final int billedCount;
  final num pending;
  final int pendingCount;
  final int cancelled;

  const _Stats({
    required this.stays,
    required this.people,
    required this.inHouse,
    required this.billedAmount,
    required this.billedCount,
    required this.pending,
    required this.pendingCount,
    required this.cancelled,
  });

  /// Cancelled stays count toward neither a stay nor its money, the same way
  /// the web page's own reduce skips them — a cancelled booking is nobody
  /// staying and nothing owed.
  factory _Stats.of(List<Booking> rows) {
    var stays = 0, people = 0, inHouse = 0, billedCount = 0, pendingCount = 0, cancelled = 0;
    num billed = 0, pending = 0;
    for (final b in rows) {
      if (b.status == 'CANCELLED') {
        cancelled++;
        continue;
      }
      stays++;
      people += b.numGuests ?? 0;
      if (b.status == 'CHECKED_IN') inHouse++;
      final isBilled = (b.invoiceNumber ?? '').isNotEmpty;
      final amount = b.billAmount ?? b.totalPrice ?? 0;
      if (isBilled) {
        billed += amount;
        billedCount++;
      } else {
        pending += amount;
        pendingCount++;
      }
    }
    return _Stats(
      stays: stays,
      people: people,
      inHouse: inHouse,
      billedAmount: billed,
      billedCount: billedCount,
      pending: pending,
      pendingCount: pendingCount,
      cancelled: cancelled,
    );
  }
}

/// One tile's worth of content — [StatItem] plus the small caption line the
/// web page's own tiles carry under the figure ("1 bill issued", "people
/// booked in").
class _Stat {
  final String label;
  final String value;
  final String? note;
  final bool accent;

  const _Stat({
    required this.label,
    required this.value,
    this.note,
    this.accent = false,
  });
}

/// The summary strip, three tiles to a row rather than two — a phone screen
/// has room for it once each tile carries only a label, a number and a
/// caption, and three narrower tiles read as one glance instead of two.
class _CompactStatGrid extends StatelessWidget {
  final List<_Stat> items;

  const _CompactStatGrid({required this.items});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        const gap = AppTheme.s8;
        final width = (constraints.maxWidth - gap * 2) / 3;
        return Wrap(
          spacing: gap,
          runSpacing: gap,
          children: [
            for (final item in items)
              SizedBox(
                width: width,
                child: NeuCard(
                  radius: AppTheme.rSmall,
                  shadow: AppTheme.subtle,
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppTheme.s8,
                    vertical: AppTheme.s8,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        item.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: AppTheme.muted, fontSize: 10),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        item.value,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: item.accent ? AppTheme.accent : AppTheme.heading,
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      if (item.note != null) ...[
                        const SizedBox(height: 2),
                        Text(
                          item.note!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: AppTheme.muted, fontSize: 9),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

// ── Range + search ───────────────────────────────────────────────────────────

class _RangeAndSearch extends StatelessWidget {
  final String fromDate;
  final String toDate;
  final TextEditingController searchController;
  final bool searchNotEmpty;
  final int activeFilterCount;
  final bool filterOpen;
  final LayerLink filterLink;
  final OverlayPortalController filterPortalController;
  final WidgetBuilder filterOverlayBuilder;
  final void Function(String from, String to) onFromTo;
  final ValueChanged<String> onSearch;
  final VoidCallback onToggleFilter;

  const _RangeAndSearch({
    required this.fromDate,
    required this.toDate,
    required this.searchController,
    required this.searchNotEmpty,
    required this.filterLink,
    required this.filterPortalController,
    required this.filterOverlayBuilder,
    required this.activeFilterCount,
    required this.filterOpen,
    required this.onFromTo,
    required this.onSearch,
    required this.onToggleFilter,
  });

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      radius: AppTheme.rMedium,
      shadow: AppTheme.subtle,
      padding: const EdgeInsets.all(AppTheme.s8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: _DateField(
                  label: 'From',
                  value: fromDate,
                  onPick: (v) => onFromTo(v, toDate),
                ),
              ),
              const SizedBox(width: AppTheme.s8),
              Expanded(
                child: _DateField(
                  label: 'To',
                  value: toDate,
                  minDate: fromDate,
                  onPick: (v) => onFromTo(fromDate, v),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s8),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(
                  child: NeuPressed(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppTheme.s12,
                      vertical: 2,
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.search_rounded, size: 18, color: AppTheme.muted),
                        const SizedBox(width: AppTheme.s8),
                        Expanded(
                          child: TextField(
                            onChanged: onSearch,
                            controller: searchController,
                            decoration: const InputDecoration(
                              isDense: true,
                              border: InputBorder.none,
                              hintText: 'Name, room, phone or bill number',
                              hintStyle: TextStyle(color: AppTheme.muted, fontSize: 13),
                            ),
                            style: const TextStyle(color: AppTheme.heading, fontSize: 13),
                          ),
                        ),
                        if (searchNotEmpty)
                          InkResponse(
                            onTap: () {
                              searchController.clear();
                              onSearch('');
                            },
                            radius: 18,
                            child: const Icon(
                              Icons.close_rounded,
                              size: 18,
                              color: AppTheme.muted,
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: AppTheme.s8),
                CompositedTransformTarget(
                  link: filterLink,
                  child: OverlayPortal(
                    controller: filterPortalController,
                    overlayChildBuilder: filterOverlayBuilder,
                    child: _FilterButton(
                      count: activeFilterCount,
                      open: filterOpen,
                      onTap: onToggleFilter,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
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
  final bool open;
  final VoidCallback onTap;

  const _FilterButton({
    required this.count,
    required this.open,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final on = count > 0 || open;
    return GestureDetector(
      onTap: onTap,
      child: NeuPressed(
        padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
        child: SizedBox(
          width: 18,
          child: Stack(
            clipBehavior: Clip.none,
            alignment: Alignment.center,
            children: [
              Icon(
                Icons.filter_alt_rounded,
                size: 18,
                color: on ? AppTheme.accent : AppTheme.muted,
              ),
              if (count > 0)
                Positioned(
                  top: -4,
                  right: -4,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                    decoration: const BoxDecoration(
                      color: AppTheme.accent,
                      shape: BoxShape.circle,
                    ),
                    constraints: const BoxConstraints(minWidth: 15, minHeight: 15),
                    child: Text(
                      '$count',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 9,
                        fontWeight: FontWeight.w700,
                      ),
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
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  @override
  Widget build(BuildContext context) {
    final parsed = DateTime.tryParse(value);
    return GestureDetector(
      onTap: () async {
        final now = DateTime.now();
        final min = minDate != null ? DateTime.tryParse(minDate!) : null;
        final picked = await showDatePicker(
          context: context,
          initialDate: parsed ?? now,
          firstDate: min ?? DateTime(now.year - 5),
          lastDate: DateTime(now.year + 1),
        );
        if (picked == null) return;
        onPick(_RegisterScreenState._iso(picked));
      },
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(color: AppTheme.muted, fontSize: 10)),
          const SizedBox(height: 2),
          NeuPressed(
            padding: const EdgeInsets.symmetric(
              horizontal: AppTheme.s8,
              vertical: 6,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.event_rounded, size: 13, color: AppTheme.muted),
                const SizedBox(width: 6),
                Text(
                  parsed == null
                      ? value
                      : '${parsed.day} ${_months[parsed.month]} ${parsed.year}',
                  style: const TextStyle(color: AppTheme.heading, fontSize: 12),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ── Status chips ─────────────────────────────────────────────────────────────

class _StatusChips extends StatelessWidget {
  final Set<String> selected;
  final Map<String, int> counts;
  final int allCount;
  final ValueChanged<String> onToggle;
  final VoidCallback onClearAll;

  const _StatusChips({
    required this.selected,
    required this.counts,
    required this.allCount,
    required this.onToggle,
    required this.onClearAll,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 190,
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        boxShadow: AppTheme.subtle,
      ),
      padding: const EdgeInsets.symmetric(vertical: AppTheme.s8),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          _Chip(
            label: 'All',
            count: allCount,
            on: selected.isEmpty,
            icon: Icons.apps_rounded,
            onTap: onClearAll,
          ),
          for (final key in _kStatusOrder)
            _Chip(
              label: kRegisterStatusLabel[key]!,
              count: counts[key] ?? 0,
              on: selected.contains(key),
              color: BookingActions.statusColor(key),
              icon: _kStatusIcon[key]!,
              onTap: () => onToggle(key),
            ),
        ],
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  final String label;
  final int count;
  final bool on;
  final Color? color;
  final IconData icon;
  final VoidCallback onTap;

  const _Chip({
    required this.label,
    required this.count,
    required this.on,
    required this.icon,
    required this.onTap,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    final tint = color ?? AppTheme.accent;
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8),
        decoration: BoxDecoration(
          color: on ? tint.withValues(alpha: 0.10) : Colors.transparent,
          border: Border(
            left: BorderSide(
              color: on ? tint : Colors.transparent,
              width: 3,
            ),
          ),
        ),
        child: Row(
          children: [
            Icon(icon, size: 16, color: on ? tint : AppTheme.muted),
            const SizedBox(width: AppTheme.s8),
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  color: on ? tint : AppTheme.text,
                  fontSize: 13,
                  fontWeight: on ? FontWeight.w600 : FontWeight.w400,
                ),
              ),
            ),
            Text(
              '$count',
              style: TextStyle(
                color: on ? tint : AppTheme.muted,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── One row ───────────────────────────────────────────────────────────────

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
        padding: EdgeInsets.zero,
        child: IntrinsicHeight(
          child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // A colour bar down the left edge — the status reads at a glance
            // even before the eye lands on the chip, the same way a coloured
            // spine helps a stack of folders sort itself without reading
            // every label.
            Container(
              width: 4,
              decoration: BoxDecoration(
                color: statusColor,
                borderRadius: const BorderRadius.horizontal(
                  left: Radius.circular(AppTheme.rMedium),
                ),
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppTheme.s12,
                  AppTheme.s8,
                  AppTheme.s8,
                  AppTheme.s8,
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
                                : b.guestName!,
                            style: const TextStyle(
                              color: AppTheme.heading,
                              fontWeight: FontWeight.w700,
                              fontSize: 14,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: AppTheme.s8),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 3,
                          ),
                          decoration: BoxDecoration(
                            color: statusColor.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            kRegisterStatusLabel[b.status] ?? b.status ?? '',
                            style: TextStyle(
                              color: statusColor,
                              fontSize: 10,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        // The whole card already opens the same detail page
                        // on tap, but a card this dense reads as a block of
                        // text with no obvious click target — an explicit
                        // eye button gives the desk something to actually
                        // aim for, the way a "View" link would on the web.
                        const SizedBox(width: 4),
                        InkResponse(
                          onTap: onTap,
                          radius: 18,
                          child: Container(
                            padding: const EdgeInsets.all(5),
                            decoration: BoxDecoration(
                              color: AppTheme.accent.withValues(alpha: 0.10),
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(
                              Icons.visibility_outlined,
                              size: 15,
                              color: AppTheme.accent,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 1),
                    Text(
                      'Room ${b.roomNumber ?? '—'}'
                      '${b.categoryName != null ? ' · ${b.categoryName}' : ''}'
                      '${(b.guestPhone ?? '').isNotEmpty ? ' · ${b.guestPhone}' : ''}',
                      style: const TextStyle(
                        color: AppTheme.muted,
                        fontSize: 11,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: AppTheme.s8),
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
      crossAxisAlignment:
          alignEnd ? CrossAxisAlignment.end : CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: AppTheme.muted, fontSize: 10)),
        const SizedBox(height: 1),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          textAlign: alignEnd ? TextAlign.end : TextAlign.start,
          style: TextStyle(
            color: accent ? AppTheme.accent : AppTheme.heading,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}
