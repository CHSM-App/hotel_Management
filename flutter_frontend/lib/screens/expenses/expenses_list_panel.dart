import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/expense.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../bookings/id_proof_viewer_screen.dart';
import '../theme.dart';
import 'expense_form_screen.dart';

/// Expenses > Expenses — mirrors the Log tab in ExpensesPanel.jsx: a search
/// box, a category filter, and every logged spend, newest first.
class ExpensesListPanel extends ConsumerStatefulWidget {
  const ExpensesListPanel({super.key});

  @override
  ConsumerState<ExpensesListPanel> createState() => _ExpensesListPanelState();
}

class _ExpensesListPanelState extends ConsumerState<ExpensesListPanel> {
  final _search = TextEditingController();
  int? _categoryId;
  String? _fromDate;
  String? _toDate;
  bool _filtersOpen = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(expensesViewModelProvider.notifier).loadExpenses());
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  int get _activeFilterCount => (_categoryId != null ? 1 : 0) + (_fromDate != null ? 1 : 0) + (_toDate != null ? 1 : 0);

  void _clearFilters() => setState(() {
        _categoryId = null;
        _fromDate = null;
        _toDate = null;
      });

  Future<void> _pickRangeBound({required bool isFrom}) async {
    final now = DateTime.now();
    final current = isFrom ? _fromDate : _toDate;
    final picked = await showDatePicker(
      context: context,
      firstDate: DateTime(now.year - 5),
      lastDate: DateTime(now.year + 1),
      initialDate: current != null ? (DateTime.tryParse(current) ?? now) : now,
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
    final state = ref.watch(expensesViewModelProvider);
    final needle = _search.text.trim().toLowerCase();
    final shown = [...state.expenses]
      ..removeWhere((e) =>
          (_categoryId != null && e.categoryId != _categoryId) ||
          (_fromDate != null && e.expenseDate.compareTo(_fromDate!) < 0) ||
          (_toDate != null && e.expenseDate.compareTo(_toDate!) > 0) ||
          (needle.isNotEmpty &&
              !e.title.toLowerCase().contains(needle) &&
              !e.categoryName.toLowerCase().contains(needle) &&
              !(e.vendorName ?? '').toLowerCase().contains(needle)))
      ..sort((a, b) => b.expenseDate.compareTo(a.expenseDate));

    final shownTotal = shown.fold<double>(0, (sum, e) => sum + e.amount);

    // Only categories an expense is actually filed under — mirrors
    // categoriesWithSpend in ExpensesPanel.jsx.
    final usedCategoryIds = state.expenses.map((e) => e.categoryId).toSet();
    final categoriesWithSpend = state.categories.where((c) => usedCategoryIds.contains(c.id)).toList();

    return Stack(
      fit: StackFit.expand,
      children: [
        RefreshIndicator(
          onRefresh: () => ref.read(expensesViewModelProvider.notifier).loadExpenses(),
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
                                hintText: 'Search expenses…',
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
                  _FilterToggleButton(
                    open: _filtersOpen,
                    count: _activeFilterCount,
                    onTap: () => setState(() => _filtersOpen = !_filtersOpen),
                  ),
                ],
              ),
              AnimatedSize(
                duration: const Duration(milliseconds: 200),
                curve: Curves.easeOut,
                alignment: Alignment.topCenter,
                child: _filtersOpen
                    ? Padding(
                        padding: const EdgeInsets.only(top: AppTheme.s8),
                        child: NeuCard(
                          padding: const EdgeInsets.all(AppTheme.s12),
                          radius: AppTheme.rMedium,
                          shadow: AppTheme.subtle,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  const Text('Filters', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 13)),
                                  const Spacer(),
                                  if (_activeFilterCount > 0)
                                    GestureDetector(
                                      onTap: _clearFilters,
                                      child: const Text('Clear all', style: TextStyle(color: AppTheme.accent, fontWeight: FontWeight.w600, fontSize: 12.5)),
                                    ),
                                ],
                              ),
                              const SizedBox(height: AppTheme.s8),
                              Row(
                                children: [
                                  if (categoriesWithSpend.isNotEmpty) ...[
                                    Flexible(
                                      child: _CategoryFilterButton(
                                        categories: categoriesWithSpend,
                                        selected: _categoryId,
                                        onSelect: (id) => setState(() => _categoryId = id),
                                      ),
                                    ),
                                    const SizedBox(width: AppTheme.s8),
                                  ],
                                  Expanded(
                                    child: _DateChip(
                                      label: _fromDate == null ? 'From' : formatIsoDate(_fromDate),
                                      active: _fromDate != null,
                                      onTap: () => _pickRangeBound(isFrom: true),
                                      onClear: _fromDate == null ? null : () => setState(() => _fromDate = null),
                                    ),
                                  ),
                                  const SizedBox(width: AppTheme.s8),
                                  Expanded(
                                    child: _DateChip(
                                      label: _toDate == null ? 'To' : formatIsoDate(_toDate),
                                      active: _toDate != null,
                                      onTap: () => _pickRangeBound(isFrom: false),
                                      onClear: _toDate == null ? null : () => setState(() => _toDate = null),
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      )
                    : const SizedBox(width: double.infinity),
              ),
              const SizedBox(height: AppTheme.s12),
              if (state.isLoading && state.expenses.isEmpty)
                const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()))
              else if (state.error != null && state.expenses.isEmpty)
                NeuNotice(icon: Icons.cloud_off_rounded, message: state.error!)
              else if (shown.isEmpty)
                NeuNotice(
                  icon: Icons.receipt_long_outlined,
                  message: state.expenses.isEmpty
                      ? 'Nothing logged yet. Log the first bill — electricity, salaries, a repair — and it starts showing up here.'
                      : 'No expense matches these filters.',
                )
              else ...[
                _SummaryStrip(count: shown.length, total: shownTotal),
                const SizedBox(height: AppTheme.s12),
                for (final e in shown)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppTheme.s8),
                    child: _ExpenseCard(expense: e),
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
              await showExpenseFormSheet(context);
              ref.read(expensesViewModelProvider.notifier).loadExpenses();
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
    final active = open || count > 0;
    return GestureDetector(
      onTap: onTap,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: active ? AppTheme.accent.withValues(alpha: 0.1) : AppTheme.card,
              borderRadius: BorderRadius.circular(AppTheme.rSmall),
              border: Border.all(color: active ? AppTheme.accent : AppTheme.border, width: active ? 1.4 : 1),
            ),
            child: Icon(Icons.tune_rounded, size: 21, color: active ? AppTheme.accent : AppTheme.muted),
          ),
          if (count > 0)
            Positioned(
              right: -2,
              top: -2,
              child: Container(
                padding: const EdgeInsets.all(3),
                constraints: const BoxConstraints(minWidth: 16, minHeight: 16),
                decoration: const BoxDecoration(color: AppTheme.accent, shape: BoxShape.circle),
                child: Text(
                  '$count',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w700, height: 1),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// A quick "N expenses · ₹total" line above the list — mirrors the running
/// total a desk clerk would otherwise have to add up by eye, and reflects
/// whatever filters/search are currently narrowing the list.
class _SummaryStrip extends StatelessWidget {
  final int count;
  final double total;

  const _SummaryStrip({required this.count, required this.total});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text('$count expense${count == 1 ? '' : 's'}', style: const TextStyle(color: AppTheme.muted, fontSize: 12.5, fontWeight: FontWeight.w500)),
        const Text(' · ', style: TextStyle(color: AppTheme.muted, fontSize: 12.5)),
        Text(formatPrice(total), style: const TextStyle(color: AppTheme.heading, fontSize: 12.5, fontWeight: FontWeight.w700)),
      ],
    );
  }
}

/// "Partially paid" / "Pending" — mirrors PAYMENT_STATUS_LABEL's tags in
/// ExpensesPanel.jsx. PAID is the common case and gets no tag at all.
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
  final List<ExpenseCategory> categories;
  final int? selected;
  final ValueChanged<int?> onSelect;

  const _CategoryFilterButton({required this.categories, required this.selected, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    final isFiltered = selected != null;
    final selectedName = isFiltered ? categories.where((c) => c.id == selected).map((c) => c.name).firstOrNull : null;
    return PopupMenuButton<int?>(
      tooltip: 'Filter by category',
      initialValue: selected,
      onSelected: onSelect,
      offset: const Offset(0, 44),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.rSmall), side: const BorderSide(color: AppTheme.border)),
      itemBuilder: (context) => [
        _item(null, 'All categories'),
        for (final c in categories) _item(c.id, c.name),
      ],
      child: NeuPressed(
        padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: AppTheme.s8),
        focused: isFiltered,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.category_rounded, size: 15, color: isFiltered ? AppTheme.accent : AppTheme.muted),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                selectedName ?? 'Category',
                style: TextStyle(color: isFiltered ? AppTheme.accent : AppTheme.muted, fontSize: 12, fontWeight: FontWeight.w500),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
    );
  }

  PopupMenuItem<int?> _item(int? key, String label) {
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

extension<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}

/// A stable, category-name-derived color — gives each category a recognizable
/// tint across the list without needing per-category color data from the API.
const _kCategoryPalette = [
  AppTheme.accent,
  AppTheme.edit,
  AppTheme.checkout,
  Color(0xFF9F7AEA),
  Color(0xFF38A169),
  Color(0xFFD53F8C),
];

Color _categoryColor(String name) => _kCategoryPalette[name.codeUnits.fold<int>(0, (a, b) => a + b) % _kCategoryPalette.length];

class _ExpenseCard extends ConsumerWidget {
  final Expense expense;
  const _ExpenseCard({required this.expense});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final color = _categoryColor(expense.categoryName);
    return NeuCard(
      padding: const EdgeInsets.all(AppTheme.s12),
      // A tap opens read-only first, not the editable form — mirrors a row
      // click in ExpensesPanel.jsx; "Edit details" inside switches it over.
      onTap: () async {
        await showExpenseFormSheet(context, expense: expense, viewMode: true);
        ref.read(expensesViewModelProvider.notifier).loadExpenses();
      },
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(AppTheme.rSmall)),
            child: Icon(Icons.receipt_long_rounded, size: 19, color: color),
          ),
          const SizedBox(width: AppTheme.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(expense.title, style: Theme.of(context).textTheme.titleSmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                const SizedBox(height: 3),
                Text(
                  [expense.categoryName, if (expense.vendorName != null) expense.vendorName!].join(' · '),
                  style: Theme.of(context).textTheme.bodySmall,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        expense.paymentStatus == 'PENDING'
                            ? formatIsoDate(expense.expenseDate)
                            : '${formatIsoDate(expense.expenseDate)} · ${kPaymentMethodLabel[expense.paymentMethod] ?? expense.paymentMethod}',
                        style: const TextStyle(color: AppTheme.text, fontSize: 12),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (kPaymentStatusLabel[expense.paymentStatus] != null) ...[
                      const SizedBox(width: 6),
                      _StatusTag(
                        label: kPaymentStatusLabel[expense.paymentStatus]!,
                        color: expense.paymentStatus == 'PENDING' ? AppTheme.danger : AppTheme.checkout,
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
              Text(formatPrice(expense.amount), style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 14.5)),
              _ExpenseRowMenu(
                showViewReceipt: expense.hasBillDocument,
                onEdit: () async {
                  await showExpenseFormSheet(context, expense: expense);
                  ref.read(expensesViewModelProvider.notifier).loadExpenses();
                },
                onViewReceipt: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => IdProofViewerScreen(
                      title: 'Receipt · ${expense.title}',
                      load: () async {
                        final res = await ref.read(expensesViewModelProvider.notifier).usecase.expenseBill(expense.id);
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
        title: const Text('Delete this expense?', style: TextStyle(color: AppTheme.heading)),
        content: Text('“${expense.title}” · ${formatPrice(expense.amount)}', style: const TextStyle(color: AppTheme.text)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Delete', style: TextStyle(color: AppTheme.danger))),
        ],
      ),
    );
    if (confirmed == true) {
      ref.read(expensesViewModelProvider.notifier).deleteExpense(expense.id);
    }
  }
}

/// The ⋮ row menu — mirrors RowMenu in ExpensesPanel.jsx: "Edit expense",
/// "View receipt" (only when a bill is attached), and "Delete expense".
class _ExpenseRowMenu extends StatelessWidget {
  final bool showViewReceipt;
  final VoidCallback onEdit;
  final VoidCallback onViewReceipt;
  final VoidCallback onDelete;

  const _ExpenseRowMenu({
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
        PopupMenuItem(value: onEdit, child: const Text('Edit expense')),
        if (showViewReceipt) PopupMenuItem(value: onViewReceipt, child: const Text('View receipt')),
        PopupMenuItem(
          value: onDelete,
          child: const Text('Delete expense', style: TextStyle(color: AppTheme.danger)),
        ),
      ],
    );
  }
}
