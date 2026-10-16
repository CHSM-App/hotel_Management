import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/pill_tabs.dart';
import '../theme.dart';
import 'expenses_categories_panel.dart';
import 'expenses_list_panel.dart';
import 'expenses_recurring_panel.dart';
import 'expenses_vendors_panel.dart';

/// Expense tracking — mirrors ExpensesPanel.jsx's shell exactly: Expenses,
/// Recurring, Vendors, Categories — same four tabs, same order. The web's
/// Expenses tab carries its own KPI row and category breakdown inline (see
/// expenses_list_panel.dart) rather than a separate Summary tab. A category
/// is still only ever named through the combobox on the expense/recurring
/// forms — the Categories tab here is read-only P&L tagging, same as the web.
class ExpensesScreen extends ConsumerStatefulWidget {
  const ExpensesScreen({super.key});

  @override
  ConsumerState<ExpensesScreen> createState() => _ExpensesScreenState();
}

class _ExpensesScreenState extends ConsumerState<ExpensesScreen> {
  String _tab = 'expenses';

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(expensesViewModelProvider.notifier).loadCatalogue());
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s8),
          child: _SubTabs(selected: _tab, onSelect: (t) => setState(() => _tab = t)),
        ),
        Expanded(
          child: switch (_tab) {
            'recurring' => const ExpensesRecurringPanel(),
            'vendors' => const ExpensesVendorsPanel(),
            'categories' => const ExpensesCategoriesPanel(),
            _ => const ExpensesListPanel(),
          },
        ),
      ],
    );
  }
}

class _SubTabs extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onSelect;

  const _SubTabs({required this.selected, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return PillTabs(
      selected: selected,
      onSelect: onSelect,
      tabs: const [
        PillTab('expenses', 'Expenses', Icons.receipt_long_rounded),
        PillTab('recurring', 'Recurring', Icons.autorenew_rounded),
        PillTab('vendors', 'Vendors', Icons.storefront_rounded),
        PillTab('categories', 'Categories', Icons.category_rounded),
      ],
    );
  }
}
