import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/asset.dart' show Vendor;
import '../../domain/models/income.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../bookings/id_proof_viewer_screen.dart';
import '../theme.dart';
import 'income_form_screen.dart';

/// Income > Income — mirrors the Income tab in IncomePanel.jsx: a search box,
/// a category/payer/method/status filter, and every logged receipt, newest
/// first.
class IncomeListPanel extends ConsumerStatefulWidget {
  const IncomeListPanel({super.key});

  @override
  ConsumerState<IncomeListPanel> createState() => _IncomeListPanelState();
}

class _IncomeListPanelState extends ConsumerState<IncomeListPanel> {
  final _search = TextEditingController();
  final _filterLink = LayerLink();
  int? _categoryId;
  int? _payerId;
  String? _paymentMethod;
  String? _paymentStatus;
  String? _fromDate;
  String? _toDate;
  bool _filtersOpen = false;
  final _filterPortalController = OverlayPortalController();

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(incomeViewModelProvider.notifier).loadIncome());
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  /// Same mechanics as the booking register's status filter — an
  /// [OverlayPortal] anchored to the icon via [_filterLink], folding open
  /// right under it rather than in a sheet, so the button and its dropdown
  /// stay visually identical to the register tab's.
  void _toggleFilters() {
    setState(() => _filtersOpen = !_filtersOpen);
    if (_filtersOpen) {
      _filterPortalController.show();
    } else {
      _filterPortalController.hide();
    }
  }

  void _setFilters(VoidCallback update) => setState(update);

  /// The filter card's content, shown inside the [OverlayPortal] anchored to
  /// the filter icon — rebuilt on every filter change same as any other
  /// widget in the tree.
  Widget _buildFilterPanel() {
    final state = ref.read(incomeViewModelProvider);
    final usedCategoryIds = state.income.map((e) => e.categoryId).toSet();
    final categoriesWithSpend = state.categories.where((c) => usedCategoryIds.contains(c.id)).toList();

    final categoryCounts = <int, int>{};
    final payerCounts = <int, int>{};
    final methodCounts = <String, int>{};
    final statusCounts = <String, int>{};
    for (final e in state.income) {
      categoryCounts[e.categoryId] = (categoryCounts[e.categoryId] ?? 0) + 1;
      if (e.payerId != null) payerCounts[e.payerId!] = (payerCounts[e.payerId!] ?? 0) + 1;
      methodCounts[e.paymentMethod] = (methodCounts[e.paymentMethod] ?? 0) + 1;
      statusCounts[e.paymentStatus] = (statusCounts[e.paymentStatus] ?? 0) + 1;
    }

    return Container(
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        boxShadow: AppTheme.subtle,
      ),
      padding: const EdgeInsets.symmetric(vertical: AppTheme.s8),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(AppTheme.s12, 0, AppTheme.s12, AppTheme.s8),
            child: Row(
              children: [
                const Text('Filters', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 13)),
                const Spacer(),
                if (_activeFilterCount > 0)
                  GestureDetector(
                    onTap: () => _setFilters(_clearFilters),
                    child: const Text('Clear all', style: TextStyle(color: AppTheme.accent, fontWeight: FontWeight.w600, fontSize: 12.5)),
                  ),
              ],
            ),
          ),
          if (categoriesWithSpend.isNotEmpty)
            _CategoryFilterButton(
              categories: categoriesWithSpend,
              counts: categoryCounts,
              allCount: state.income.length,
              selected: _categoryId,
              onSelect: (id) => _setFilters(() => _categoryId = id),
            ),
          if (state.payers.isNotEmpty)
            _PayerFilterButton(
              payers: state.payers,
              counts: payerCounts,
              allCount: state.income.length,
              selected: _payerId,
              onSelect: (id) => _setFilters(() => _payerId = id),
            ),
          _MethodFilterButton(
            counts: methodCounts,
            allCount: state.income.length,
            selected: _paymentMethod,
            onSelect: (v) => _setFilters(() => _paymentMethod = v),
          ),
          _StatusFilterButton(
            counts: statusCounts,
            allCount: state.income.length,
            selected: _paymentStatus,
            onSelect: (v) => _setFilters(() => _paymentStatus = v),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s8, AppTheme.s12, 0),
            child: Row(
              children: [
                Expanded(
                  child: _DateChip(
                    label: _fromDate == null ? 'From' : formatIsoDate(_fromDate),
                    active: _fromDate != null,
                    onTap: () => _pickRangeBound(isFrom: true),
                    onClear: _fromDate == null ? null : () => _setFilters(() => _fromDate = null),
                  ),
                ),
                const SizedBox(width: AppTheme.s8),
                Expanded(
                  child: _DateChip(
                    label: _toDate == null ? 'To' : formatIsoDate(_toDate),
                    active: _toDate != null,
                    onTap: () => _pickRangeBound(isFrom: false),
                    onClear: _toDate == null ? null : () => _setFilters(() => _toDate = null),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  int get _activeFilterCount =>
      (_categoryId != null ? 1 : 0) +
      (_payerId != null ? 1 : 0) +
      (_paymentMethod != null ? 1 : 0) +
      (_paymentStatus != null ? 1 : 0) +
      (_fromDate != null ? 1 : 0) +
      (_toDate != null ? 1 : 0);

  void _clearFilters() {
    _categoryId = null;
    _payerId = null;
    _paymentMethod = null;
    _paymentStatus = null;
    _fromDate = null;
    _toDate = null;
  }

  Future<void> _pickRangeBound({required bool isFrom}) async {
    final now = DateTime.now();
    final current = isFrom ? _fromDate : _toDate;
    final earliest = DateTime(now.year - 5);
    // The to-date can't precede whatever from-date is already set.
    final firstDate = isFrom ? earliest : (DateTime.tryParse(_fromDate ?? '') ?? earliest);
    var initialDate = current != null ? (DateTime.tryParse(current) ?? now) : now;
    if (initialDate.isBefore(firstDate)) initialDate = firstDate;
    final picked = await showDatePicker(
      context: context,
      firstDate: firstDate,
      lastDate: DateTime(now.year + 1),
      initialDate: initialDate,
      builder: (context, child) => Theme(
        data: Theme.of(context).copyWith(
          colorScheme: const ColorScheme.light(primary: AppTheme.accent, onPrimary: Colors.white, surface: AppTheme.bg, onSurface: AppTheme.heading),
        ),
        child: child!,
      ),
    );
    if (picked == null) return;
    final iso = '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
    setState(() {
      if (isFrom) {
        _fromDate = iso;
      } else {
        _toDate = iso;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(incomeViewModelProvider);
    final needle = _search.text.trim().toLowerCase();
    final shown = [...state.income]
      ..removeWhere((e) =>
          (_categoryId != null && e.categoryId != _categoryId) ||
          (_payerId != null && e.payerId != _payerId) ||
          (_paymentMethod != null && e.paymentMethod != _paymentMethod) ||
          (_paymentStatus != null && e.paymentStatus != _paymentStatus) ||
          (_fromDate != null && e.incomeDate.compareTo(_fromDate!) < 0) ||
          (_toDate != null && e.incomeDate.compareTo(_toDate!) > 0) ||
          (needle.isNotEmpty &&
              !e.title.toLowerCase().contains(needle) &&
              !e.categoryName.toLowerCase().contains(needle) &&
              !(e.payerName ?? '').toLowerCase().contains(needle)))
      ..sort((a, b) => b.incomeDate.compareTo(a.incomeDate));

    final shownTotal = shown.fold<double>(0, (sum, e) => sum + e.amount);

    return Stack(
      fit: StackFit.expand,
      children: [
        RefreshIndicator(
          onRefresh: () => ref.read(incomeViewModelProvider.notifier).loadIncome(),
          color: AppTheme.accent,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, 88),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
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
                        border: Border.all(color: AppTheme.border),
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
                                hintText: 'Search income…',
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
                              onTap: _toggleFilters,
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
                                child: SizedBox(width: 220, child: _buildFilterPanel()),
                              ),
                            ),
                          ),
                        ],
                      ),
                      child: _FilterToggleButton(
                        open: _filtersOpen,
                        count: _activeFilterCount,
                        onTap: _toggleFilters,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppTheme.s12),
              if (state.isLoading && state.income.isEmpty)
                const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()))
              else if (state.error != null && state.income.isEmpty)
                NeuNotice(icon: Icons.cloud_off_rounded, message: state.error!)
              else if (shown.isEmpty)
                NeuNotice(
                  icon: Icons.savings_outlined,
                  message: state.income.isEmpty
                      ? 'Nothing logged yet. Log the first entry — interest, a scrap sale, rent received — and it starts showing up here.'
                      : 'No income entry matches these filters.',
                )
              else ...[
                _SummaryStrip(count: shown.length, total: shownTotal),
                const SizedBox(height: AppTheme.s12),
                for (final e in shown)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppTheme.s8),
                    child: _IncomeCard(income: e),
                  ),
              ],
            ],
          ),
        ),
        Positioned(
          right: AppTheme.s16,
          bottom: AppTheme.s16,
          child: FloatingActionButton(
            backgroundColor: AppTheme.accent,
            foregroundColor: Colors.white,
            elevation: 2,
            onPressed: () async {
              await showIncomeFormSheet(context);
              ref.read(incomeViewModelProvider.notifier).loadIncome();
            },
            child: const Icon(Icons.add_rounded),
          ),
        ),
      ],
    );
  }
}

/// The search bar's own filter icon — a circular button that opens the
/// filter panel below it, with a small accent badge showing how many
/// filters are currently active (so the row can stay collapsed by default).
class _FilterToggleButton extends StatelessWidget {
  final bool open;
  final int count;
  final VoidCallback onTap;

  const _FilterToggleButton({required this.open, required this.count, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final on = open || count > 0;
    return GestureDetector(
      onTap: onTap,
      child: SizedBox(
        height: 48,
        child: NeuPressed(
          radius: AppTheme.rMedium,
          padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
          child: SizedBox(
            width: 18,
            child: Stack(
              clipBehavior: Clip.none,
              alignment: Alignment.center,
              children: [
                Icon(Icons.filter_alt_rounded, size: 18, color: on ? AppTheme.accent : AppTheme.muted),
                if (count > 0)
                  Positioned(
                    top: -4,
                    right: -4,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                      decoration: const BoxDecoration(color: AppTheme.accent, shape: BoxShape.circle),
                      constraints: const BoxConstraints(minWidth: 15, minHeight: 15),
                      child: Text(
                        '$count',
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.w700),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A quick "N income entries · ₹total" line above the list — mirrors the
/// running total a desk clerk would otherwise have to add up by eye, and
/// reflects whatever filters/search are currently narrowing the list.
class _SummaryStrip extends StatelessWidget {
  final int count;
  final double total;

  const _SummaryStrip({required this.count, required this.total});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text('$count entr${count == 1 ? 'y' : 'ies'}', style: const TextStyle(color: AppTheme.muted, fontSize: 12.5, fontWeight: FontWeight.w500)),
        const Text(' · ', style: TextStyle(color: AppTheme.muted, fontSize: 12.5)),
        Text(formatPrice(total), style: const TextStyle(color: AppTheme.heading, fontSize: 12.5, fontWeight: FontWeight.w700)),
      ],
    );
  }
}

/// "Partially received" / "Pending" — mirrors PAYMENT_STATUS_LABEL's tags in
/// IncomePanel.jsx. PAID is the common case and gets no tag at all.
class _StatusTag extends StatelessWidget {
  final String label;
  final Color color;

  const _StatusTag({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(999)),
      child: Text(label, style: TextStyle(color: color, fontSize: 10.5, fontWeight: FontWeight.w700)),
    );
  }
}

class _DateChip extends StatelessWidget {
  final String label;
  final bool active;
  final VoidCallback onTap;
  final VoidCallback? onClear;

  const _DateChip({required this.label, required this.active, required this.onTap, this.onClear});

  @override
  Widget build(BuildContext context) {
    return NeuPressed(
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: AppTheme.s8),
      focused: active,
      child: GestureDetector(
        onTap: onTap,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.calendar_today_rounded, size: 13, color: active ? AppTheme.accent : AppTheme.muted),
            const SizedBox(width: 6),
            Flexible(
              child: Text(label, overflow: TextOverflow.ellipsis, style: TextStyle(color: active ? AppTheme.accent : AppTheme.muted, fontSize: 12, fontWeight: FontWeight.w500)),
            ),
            if (onClear != null)
              GestureDetector(
                onTap: onClear,
                child: const Padding(
                  padding: EdgeInsets.only(left: 4),
                  child: Icon(Icons.close_rounded, size: 14, color: AppTheme.muted),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _CategoryFilterButton extends StatelessWidget {
  final List<IncomeCategory> categories;
  final Map<int, int> counts;
  final int allCount;
  final int? selected;
  final ValueChanged<int?> onSelect;

  const _CategoryFilterButton({
    required this.categories,
    required this.counts,
    required this.allCount,
    required this.selected,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    final isFiltered = selected != null;
    final selectedName = isFiltered ? categories.where((c) => c.id == selected).map((c) => c.name).firstOrNull : null;
    return PopupMenuButton<int?>(
      tooltip: 'Filter by category',
      padding: EdgeInsets.zero,
      initialValue: selected,
      onSelected: onSelect,
      offset: const Offset(0, 44),
      color: AppTheme.card,
      elevation: 3,
      constraints: const BoxConstraints(minWidth: 190, maxWidth: 220),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.rMedium)),
      itemBuilder: (context) => [
        _item(null, 'All', allCount, selected, Icons.apps_rounded),
        for (final c in categories) _item(c.id, c.name, counts[c.id] ?? 0, selected, Icons.category_rounded),
      ],
      child: _FilterRow(
        icon: Icons.category_rounded,
        label: 'Category',
        value: selectedName ?? 'All',
        active: isFiltered,
      ),
    );
  }
}

class _PayerFilterButton extends StatelessWidget {
  final List<Vendor> payers;
  final Map<int, int> counts;
  final int allCount;
  final int? selected;
  final ValueChanged<int?> onSelect;

  const _PayerFilterButton({
    required this.payers,
    required this.counts,
    required this.allCount,
    required this.selected,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    final isFiltered = selected != null;
    final selectedName = isFiltered ? payers.where((p) => p.id == selected).map((p) => p.name).firstOrNull : null;
    return PopupMenuButton<int?>(
      tooltip: 'Filter by payer',
      padding: EdgeInsets.zero,
      initialValue: selected,
      onSelected: onSelect,
      offset: const Offset(0, 44),
      color: AppTheme.card,
      elevation: 3,
      constraints: const BoxConstraints(minWidth: 190, maxWidth: 220),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.rMedium)),
      itemBuilder: (context) => [
        _item(null, 'All', allCount, selected, Icons.apps_rounded),
        for (final p in payers) _item(p.id, p.name, counts[p.id] ?? 0, selected, Icons.person_rounded),
      ],
      child: _FilterRow(
        icon: Icons.person_rounded,
        label: 'Payer',
        value: selectedName ?? 'All',
        active: isFiltered,
      ),
    );
  }
}

class _MethodFilterButton extends StatelessWidget {
  final Map<String, int> counts;
  final int allCount;
  final String? selected;
  final ValueChanged<String?> onSelect;

  const _MethodFilterButton({
    required this.counts,
    required this.allCount,
    required this.selected,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    final isFiltered = selected != null;
    return PopupMenuButton<String?>(
      tooltip: 'Filter by received via',
      padding: EdgeInsets.zero,
      initialValue: selected,
      onSelected: onSelect,
      offset: const Offset(0, 44),
      color: AppTheme.card,
      elevation: 3,
      constraints: const BoxConstraints(minWidth: 190, maxWidth: 220),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.rMedium)),
      itemBuilder: (context) => [
        _item(null, 'All', allCount, selected, Icons.apps_rounded),
        for (final m in kPaymentMethods) _item(m, kPaymentMethodLabel[m] ?? m, counts[m] ?? 0, selected, Icons.payments_rounded),
      ],
      child: _FilterRow(
        icon: Icons.payments_rounded,
        label: 'Method',
        value: isFiltered ? (kPaymentMethodLabel[selected] ?? selected!) : 'All',
        active: isFiltered,
      ),
    );
  }
}

class _StatusFilterButton extends StatelessWidget {
  final Map<String, int> counts;
  final int allCount;
  final String? selected;
  final ValueChanged<String?> onSelect;

  const _StatusFilterButton({
    required this.counts,
    required this.allCount,
    required this.selected,
    required this.onSelect,
  });

  static const _labels = {'PAID': 'Received', 'PARTIAL': 'Partially received', 'PENDING': 'Pending'};
  static const _icons = {
    'PAID': Icons.check_circle_rounded,
    'PARTIAL': Icons.incomplete_circle_rounded,
    'PENDING': Icons.hourglass_bottom_rounded,
  };

  @override
  Widget build(BuildContext context) {
    final isFiltered = selected != null;
    return PopupMenuButton<String?>(
      tooltip: 'Filter by status',
      padding: EdgeInsets.zero,
      initialValue: selected,
      onSelected: onSelect,
      offset: const Offset(0, 44),
      color: AppTheme.card,
      elevation: 3,
      constraints: const BoxConstraints(minWidth: 190, maxWidth: 220),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.rMedium)),
      itemBuilder: (context) => [
        _item(null, 'All', allCount, selected, Icons.apps_rounded),
        for (final s in kPaymentStatuses) _item(s, _labels[s] ?? s, counts[s] ?? 0, selected, _icons[s] ?? Icons.check_circle_outline_rounded),
      ],
      child: _FilterRow(
        icon: Icons.check_circle_outline_rounded,
        label: 'Status',
        value: isFiltered ? (_labels[selected] ?? selected!) : 'All',
        active: isFiltered,
      ),
    );
  }
}

/// One row of the top-level filter panel — a filter dimension's own opener
/// (Category/Payer/Method/Status), styled exactly like the booking
/// register's status list rows: full width, an icon, the dimension's name,
/// its current value trailing, a colour bar and tint when a value is picked.
class _FilterRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final bool active;

  const _FilterRow({required this.icon, required this.label, required this.value, required this.active});

  @override
  Widget build(BuildContext context) {
    const tint = AppTheme.accent;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8),
      decoration: BoxDecoration(
        color: active ? tint.withValues(alpha: 0.10) : Colors.transparent,
        border: Border(left: BorderSide(color: active ? tint : Colors.transparent, width: 3)),
      ),
      child: Row(
        children: [
          Icon(icon, size: 16, color: active ? tint : AppTheme.muted),
          const SizedBox(width: AppTheme.s8),
          Text(label, style: TextStyle(color: active ? tint : AppTheme.text, fontSize: 13, fontWeight: active ? FontWeight.w600 : FontWeight.w400)),
          const Spacer(),
          Flexible(
            child: Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.right,
              style: TextStyle(color: active ? tint : AppTheme.muted, fontSize: 12, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

/// One dropdown row — same look as the booking register's status list:
/// a colour bar on the left and a tinted background when selected, an icon,
/// the label, and a trailing count.
PopupMenuItem<T> _item<T>(T key, String label, int count, T selected, IconData icon) {
  final isSelected = key == selected;
  const tint = AppTheme.accent;
  return PopupMenuItem(
    value: key,
    padding: EdgeInsets.zero,
    height: 40,
    child: Container(
      width: double.infinity,
      height: 40,
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
      decoration: BoxDecoration(
        color: isSelected ? tint.withValues(alpha: 0.10) : Colors.transparent,
        border: Border(left: BorderSide(color: isSelected ? tint : Colors.transparent, width: 3)),
      ),
      child: Row(
        children: [
          Icon(icon, size: 16, color: isSelected ? tint : AppTheme.muted),
          const SizedBox(width: AppTheme.s8),
          Expanded(
            child: Text(
              label,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: isSelected ? tint : AppTheme.text, fontSize: 13, fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400),
            ),
          ),
          Text('$count', style: TextStyle(color: isSelected ? tint : AppTheme.muted, fontSize: 12, fontWeight: FontWeight.w600)),
        ],
      ),
    ),
  );
}

extension<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}

/// A stable, category-name-derived color — gives each category a recognizable
/// tint across the list without needing per-category color data from the API.
const _kCategoryPalette = [
  AppTheme.vacant,
  AppTheme.accent,
  AppTheme.checkedIn,
  Color(0xFF9F7AEA),
  Color(0xFF38A169),
  Color(0xFFD53F8C),
];

Color _categoryColor(String name) => _kCategoryPalette[name.codeUnits.fold<int>(0, (a, b) => a + b) % _kCategoryPalette.length];

class _IncomeCard extends ConsumerWidget {
  final IncomeEntry income;
  const _IncomeCard({required this.income});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final color = _categoryColor(income.categoryName);
    return NeuCard(
      padding: const EdgeInsets.all(AppTheme.s12),
      // A tap opens read-only first, not the editable form — mirrors a row
      // click in IncomePanel.jsx; "Edit details" inside switches it over.
      onTap: () async {
        await showIncomeFormSheet(context, income: income, viewMode: true);
        ref.read(incomeViewModelProvider.notifier).loadIncome();
      },
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(AppTheme.rSmall)),
            child: Icon(Icons.savings_rounded, size: 19, color: color),
          ),
          const SizedBox(width: AppTheme.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(income.title, style: Theme.of(context).textTheme.titleSmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                const SizedBox(height: 3),
                Text(
                  [income.categoryName, if (income.payerName != null) income.payerName!].join(' · '),
                  style: Theme.of(context).textTheme.bodySmall,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        income.paymentStatus == 'PENDING'
                            ? formatIsoDate(income.incomeDate)
                            : '${formatIsoDate(income.incomeDate)} · ${kPaymentMethodLabel[income.paymentMethod] ?? income.paymentMethod}',
                        style: const TextStyle(color: AppTheme.text, fontSize: 12),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (kIncomeStatusLabel[income.paymentStatus] != null) ...[
                      const SizedBox(width: 6),
                      _StatusTag(
                        label: kIncomeStatusLabel[income.paymentStatus]!,
                        color: income.paymentStatus == 'PENDING' ? AppTheme.danger : AppTheme.checkout,
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: AppTheme.s8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(formatPrice(income.amount), style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 14.5)),
              _IncomeRowMenu(
                showViewReceipt: income.hasReceiptDocument,
                onEdit: () async {
                  await showIncomeFormSheet(context, income: income);
                  ref.read(incomeViewModelProvider.notifier).loadIncome();
                },
                onViewReceipt: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => IdProofViewerScreen(
                      title: 'Receipt · ${income.title}',
                      load: () async {
                        final res = await ref.read(incomeViewModelProvider.notifier).usecase.incomeReceiptFile(income.id);
                        return (Uint8List.fromList(res.data!), res.headers.value('content-type'));
                      },
                    ),
                  ),
                ),
                onDelete: () => _confirmDelete(context, ref),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _confirmDelete(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: const Text('Delete this income entry?', style: TextStyle(color: AppTheme.heading)),
        content: Text('“${income.title}” · ${formatPrice(income.amount)}', style: const TextStyle(color: AppTheme.text)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Delete', style: TextStyle(color: AppTheme.danger))),
        ],
      ),
    );
    if (confirmed == true) {
      ref.read(incomeViewModelProvider.notifier).deleteIncome(income.id);
    }
  }
}

/// The ⋮ row menu — mirrors RowMenu in IncomePanel.jsx: "Edit income", "View
/// receipt" (only when one is attached), and "Delete income".
class _IncomeRowMenu extends StatelessWidget {
  final bool showViewReceipt;
  final VoidCallback onEdit;
  final VoidCallback onViewReceipt;
  final VoidCallback onDelete;

  const _IncomeRowMenu({
    required this.showViewReceipt,
    required this.onEdit,
    required this.onViewReceipt,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<VoidCallback>(
      tooltip: 'More actions',
      padding: EdgeInsets.zero,
      icon: const Icon(Icons.more_vert_rounded, size: 20, color: AppTheme.muted),
      onSelected: (action) => action(),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.rSmall), side: const BorderSide(color: AppTheme.border)),
      itemBuilder: (context) => [
        PopupMenuItem(value: onEdit, child: const Text('Edit income')),
        if (showViewReceipt) PopupMenuItem(value: onViewReceipt, child: const Text('View receipt')),
        PopupMenuItem(
          value: onDelete,
          child: const Text('Delete income', style: TextStyle(color: AppTheme.danger)),
        ),
      ],
    );
  }
}
