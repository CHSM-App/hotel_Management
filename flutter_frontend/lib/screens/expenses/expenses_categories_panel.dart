import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/expense.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/expenses_viewmodel.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';

/// Expenses > Categories — mirrors the Categories tab in ExpensesPanel.jsx:
/// a read-only list of every category that's been named through the
/// expense/recurring forms, with two checkboxes each to pull a category into
/// the Profit & Loss report's Interest/Income Tax rows instead of counting it
/// as an ordinary operating expense. There is no add/edit/delete here — a
/// category only exists once an expense or template has used it.
class ExpensesCategoriesPanel extends ConsumerWidget {
  const ExpensesCategoriesPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(expensesViewModelProvider);
    final categories = state.categories;

    return RefreshIndicator(
      onRefresh: () => ref.read(expensesViewModelProvider.notifier).loadCatalogue(),
      color: AppTheme.accent,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s4, AppTheme.s12, 24),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: AppTheme.s4, vertical: AppTheme.s8),
            child: Text(
              "Tag a category as Interest or Income Tax to pull it into the Profit & Loss report's own rows "
              'for those, instead of counting it as an ordinary operating expense. Use a dedicated category '
              'for each — tagging a category shared with other expenses reclassifies all of them too.',
              style: TextStyle(color: AppTheme.muted, fontSize: 12, height: 1.4),
            ),
          ),
          if (state.catalogueLoading && categories.isEmpty)
            const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()))
          else if (categories.isEmpty)
            const NeuNotice(
              icon: Icons.sell_outlined,
              message: 'No categories yet. Log an expense first to create one.',
            )
          else
            for (final cat in categories)
              Padding(
                padding: const EdgeInsets.only(bottom: AppTheme.s8),
                child: _CategoryCard(category: cat),
              ),
        ],
      ),
    );
  }
}

class _CategoryCard extends ConsumerWidget {
  final ExpenseCategory category;

  const _CategoryCard({required this.category});

  Future<void> _toggle(BuildContext context, WidgetRef ref, String field, bool turningOn) async {
    final notifier = ref.read(expensesViewModelProvider.notifier);
    if (!turningOn) {
      await notifier.setCategoryFlag(
        category.id,
        isInterest: field == 'isInterest' ? false : null,
        isTax: field == 'isTax' ? false : null,
      );
      return;
    }

    final label = field == 'isInterest' ? 'Interest' : 'Income Tax';
    final impact = await showDialog<CategoryTagImpact>(
      context: context,
      builder: (_) => _CategoryTagDialog(categoryName: category.name, label: label, notifier: notifier, categoryId: category.id),
    );
    if (impact == null) return;
    await notifier.setCategoryFlag(
      category.id,
      isInterest: field == 'isInterest' ? true : null,
      isTax: field == 'isTax' ? true : null,
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return NeuCard(
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  category.name,
                  style: Theme.of(context).textTheme.titleSmall,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (category.isInterest) _Tag(label: 'Interest'),
              if (category.isTax) _Tag(label: 'Income Tax'),
            ],
          ),
          const SizedBox(height: AppTheme.s4),
          CheckboxListTile(
            value: category.isInterest,
            onChanged: (v) => _toggle(context, ref, 'isInterest', v ?? false),
            controlAffinity: ListTileControlAffinity.leading,
            contentPadding: EdgeInsets.zero,
            dense: true,
            title: const Text('Interest (loan EMI)', style: TextStyle(fontSize: 13)),
          ),
          CheckboxListTile(
            value: category.isTax,
            onChanged: (v) => _toggle(context, ref, 'isTax', v ?? false),
            controlAffinity: ListTileControlAffinity.leading,
            contentPadding: EdgeInsets.zero,
            dense: true,
            title: const Text('Income Tax', style: TextStyle(fontSize: 13)),
          ),
        ],
      ),
    );
  }
}

class _Tag extends StatelessWidget {
  final String label;

  const _Tag({required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(left: AppTheme.s8),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppTheme.accent.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(label, style: const TextStyle(color: AppTheme.accent, fontSize: 11, fontWeight: FontWeight.w600)),
    );
  }
}

/// Confirms tagging a category as Interest/Income Tax — shows how many
/// existing expenses would retroactively count toward that P&L row, so
/// ticking the wrong category doesn't silently misstate every past report.
/// Mirrors the pendingCategoryTag modal in ExpensesPanel.jsx. Pops with the
/// fetched [CategoryTagImpact] on confirm, or null on cancel.
class _CategoryTagDialog extends StatefulWidget {
  final String categoryName;
  final String label;
  final int categoryId;
  final ExpensesViewModel notifier;

  const _CategoryTagDialog({
    required this.categoryName,
    required this.label,
    required this.categoryId,
    required this.notifier,
  });

  @override
  State<_CategoryTagDialog> createState() => _CategoryTagDialogState();
}

class _CategoryTagDialogState extends State<_CategoryTagDialog> {
  CategoryTagImpact? _impact;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final impact = await widget.notifier.categoryTagImpact(widget.categoryId);
    if (!mounted) return;
    setState(() {
      if (impact == null) {
        _error = 'Could not check this category\'s expenses.';
      } else {
        _impact = impact;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: AppTheme.bg,
      title: Text('Tag "${widget.categoryName}" as ${widget.label}?', style: const TextStyle(color: AppTheme.heading)),
      content: _buildBody(),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        TextButton(
          onPressed: _impact == null ? null : () => Navigator.pop(context, _impact),
          child: const Text('Tag category'),
        ),
      ],
    );
  }

  Widget _buildBody() {
    if (_error != null) {
      return Text(_error!, style: const TextStyle(color: AppTheme.danger));
    }
    if (_impact == null) {
      return const Text('Checking…', style: TextStyle(color: AppTheme.text));
    }
    if (_impact!.count == 0) {
      return Text(
        'No expenses logged under this category yet — safe to tag. Every expense filed here from now on '
        'will count as ${widget.label} in the P&L report.',
        style: const TextStyle(color: AppTheme.text),
      );
    }
    final earliest = formatIsoDate(_impact!.earliestDate);
    final latest = formatIsoDate(_impact!.latestDate);
    final range = earliest == latest ? earliest : '$earliest – $latest';
    final countLabel = '${_impact!.count} expense${_impact!.count == 1 ? '' : 's'}';
    return Text(
      'This reclassifies $countLabel totaling ${formatPrice(_impact!.total)} ($range) as ${widget.label} in '
      'every past and future Profit & Loss report, removing them from Expenses. If this category is shared '
      'with unrelated expenses, cancel and move this one to a dedicated category instead.',
      style: const TextStyle(color: AppTheme.text),
    );
  }
}
