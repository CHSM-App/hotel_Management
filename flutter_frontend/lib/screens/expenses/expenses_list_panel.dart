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
            padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s4, AppTheme.s12, 88),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              NeuField(
                controller: _search,
                label: '',
                hint: 'Search expenses…',
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: AppTheme.s8),
              Row(
                children: [
                  if (categoriesWithSpend.isNotEmpty) ...[
                    _CategoryFilterButton(
                      categories: categoriesWithSpend,
                      selected: _categoryId,
                      onSelect: (id) => setState(() => _categoryId = id),
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
              else
                for (final e in shown)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppTheme.s8),
                    child: _ExpenseCard(expense: e),
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
        padding: const EdgeInsets.all(AppTheme.s12),
        focused: isFiltered,
        child: Icon(Icons.filter_list_rounded, size: 20, color: isFiltered ? AppTheme.accent : AppTheme.muted),
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

class _ExpenseCard extends ConsumerWidget {
  final Expense expense;
  const _ExpenseCard({required this.expense});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return NeuCard(
      padding: const EdgeInsets.all(AppTheme.s12),
      onTap: () async {
        await showExpenseFormSheet(context, expense: expense);
        ref.read(expensesViewModelProvider.notifier).loadExpenses();
      },
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(expense.title, style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 14.5), maxLines: 1, overflow: TextOverflow.ellipsis),
                const SizedBox(height: 2),
                Text(
                  [expense.categoryName, if (expense.vendorName != null) expense.vendorName!].join(' · '),
                  style: const TextStyle(color: AppTheme.muted, fontSize: 12),
                ),
                const SizedBox(height: 2),
                Text(
                  '${formatIsoDate(expense.expenseDate)} · ${kPaymentMethodLabel[expense.paymentMethod] ?? expense.paymentMethod}',
                  style: const TextStyle(color: AppTheme.text, fontSize: 12),
                ),
              ],
            ),
          ),
          const SizedBox(width: AppTheme.s8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(formatPrice(expense.amount), style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 14)),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (expense.hasBillDocument)
                    IconButton(
                      visualDensity: VisualDensity.compact,
                      constraints: const BoxConstraints(),
                      padding: const EdgeInsets.all(6),
                      icon: const Icon(Icons.receipt_long_rounded, size: 18, color: AppTheme.accent),
                      onPressed: () => Navigator.of(context).push(
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
                    ),
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    constraints: const BoxConstraints(),
                    padding: const EdgeInsets.all(6),
                    icon: const Icon(Icons.delete_outline_rounded, size: 18, color: AppTheme.danger),
                    onPressed: () => _confirmDelete(context, ref),
                  ),
                ],
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
