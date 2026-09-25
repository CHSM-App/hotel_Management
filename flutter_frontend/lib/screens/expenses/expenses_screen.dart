import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import '../theme.dart';
import 'expenses_list_panel.dart';
import 'expenses_recurring_panel.dart';
import 'expenses_vendors_panel.dart';

/// Expense tracking — mirrors ExpensesPanel.jsx's shell exactly: Expenses,
/// Recurring, Vendors — same three tabs, same order. The web's Expenses tab
/// carries its own KPI row and category breakdown inline (see
/// expenses_list_panel.dart) rather than a separate Summary tab, and
/// categories have no "manage" screen of their own — they're named through
/// the combobox on the expense/recurring forms, same as the web.
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
          child: Align(
            alignment: Alignment.centerLeft,
            child: _SubTabs(selected: _tab, onSelect: (t) => setState(() => _tab = t)),
          ),
        ),
        Expanded(
          child: switch (_tab) {
            'recurring' => const ExpensesRecurringPanel(),
            'vendors' => const ExpensesVendorsPanel(),
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

  static const _tabs = [
    ('expenses', 'Expenses'),
    ('recurring', 'Recurring'),
    ('vendors', 'Vendors'),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppTheme.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final t in _tabs)
            GestureDetector(
              onTap: () => onSelect(t.$1),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 150),
                padding: const EdgeInsets.symmetric(horizontal: AppTheme.s16, vertical: AppTheme.s8),
                decoration: BoxDecoration(
                  color: t.$1 == selected ? AppTheme.accent : Colors.transparent,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  t.$2,
                  style: TextStyle(
                    color: t.$1 == selected ? Colors.white : AppTheme.text,
                    fontWeight: t.$1 == selected ? FontWeight.w600 : FontWeight.w500,
                    fontSize: 13,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
