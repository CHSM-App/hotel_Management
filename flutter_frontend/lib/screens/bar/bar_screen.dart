import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/pill_tabs.dart';
import '../theme.dart';
import 'bar_billing_panel.dart';
import 'bar_history_panel.dart';
import 'bar_orders_panel.dart';

/// "Bar orders & Billing": Open orders / Ready to bill / Bills / History,
/// each shown to the permission that earns it (mirrors BarSection.jsx).
class BarScreen extends ConsumerStatefulWidget {
  const BarScreen({super.key});

  @override
  ConsumerState<BarScreen> createState() => _BarScreenState();
}

class _BarScreenState extends ConsumerState<BarScreen> {
  String? _tab;

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authViewModelProvider).me?.user;
    final canTake = user?.can('bar.take') ?? false;
    final canBill = user?.can('bar.bill') ?? false;
    final tabs = <PillTab>[
      if (canTake || canBill) const PillTab('open', 'Open orders', Icons.local_bar_rounded),
      if (canBill) const PillTab('ready', 'Ready to bill', Icons.receipt_long_rounded),
      if (canBill) const PillTab('bills', 'Bills', Icons.request_quote_rounded),
      if (canTake || canBill) const PillTab('history', 'History', Icons.history_rounded),
    ];
    if (tabs.isEmpty) return const SizedBox.shrink();
    final current = tabs.any((t) => t.key == _tab) ? _tab! : tabs.first.key;

    return Column(
      children: [
        Padding(
          padding: EdgeInsets.fromLTRB(AppTheme.gutter(context), AppTheme.s8, AppTheme.gutter(context), 0),
          child: Align(
            alignment: Alignment.centerLeft,
            child: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: AppTheme.isDesktop(context) ? 640 : double.infinity),
              child: PillTabs(tabs: tabs, selected: current, onSelect: (k) => setState(() => _tab = k)),
            ),
          ),
        ),
        Expanded(
          child: switch (current) {
            'ready' => const BarBillingPanel(),
            'bills' => const BarHistoryPanel(key: ValueKey('bills'), bills: true),
            'history' => const BarHistoryPanel(key: ValueKey('history'), bills: false),
            _ => const BarOrdersPanel(),
          },
        ),
      ],
    );
  }
}
