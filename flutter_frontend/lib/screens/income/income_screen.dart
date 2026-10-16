import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/pill_tabs.dart';
import '../theme.dart';
import 'income_interest_panel.dart';
import 'income_list_panel.dart';
import 'income_payers_panel.dart';
import 'income_recurring_panel.dart';

/// Other income tracking — mirrors IncomePanel.jsx's shell, minus its
/// Categories tab: Income, Interest, Recurring, Payers. A category is only ever named
/// through the combobox on the income/recurring forms, the same way the web
/// panel itself lets a category get named — there is no separate "manage
/// categories" screen here, on this app or the web.
class IncomeScreen extends ConsumerStatefulWidget {
  const IncomeScreen({super.key});

  @override
  ConsumerState<IncomeScreen> createState() => _IncomeScreenState();
}

class _IncomeScreenState extends ConsumerState<IncomeScreen> {
  String _tab = 'income';

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(incomeViewModelProvider.notifier).loadCatalogue());
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
            'interest' => const IncomeInterestPanel(),
            'recurring' => const IncomeRecurringPanel(),
            'payers' => const IncomePayersPanel(),
            _ => const IncomeListPanel(),
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
        PillTab('income', 'Income', Icons.south_west_rounded),
        PillTab('interest', 'Interest', Icons.percent_rounded),
        PillTab('recurring', 'Recurring', Icons.autorenew_rounded),
        PillTab('payers', 'Payers', Icons.people_alt_rounded),
      ],
    );
  }
}
