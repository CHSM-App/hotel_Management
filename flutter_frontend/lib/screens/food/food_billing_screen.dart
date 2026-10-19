import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/orders_viewmodel.dart';
import '../billing/billing_screen.dart';
import '../../widgets/pill_tabs.dart';
import '../theme.dart';
import 'orders_screen.dart';

/// One sidebar entry for the restaurant — orders and billing merged under a
/// single flat tab strip, the same merge FoodSection.jsx makes of
/// OrdersPanel.jsx and `<Billing stream="restaurant" />`
/// (propertyProfile.js's 'food' row is now titled "Food orders & Billing").
///
/// The strip mirrors FoodSection.jsx's own `strip` exactly: Kitchen queue and
/// History show for a login holding orders.manage/orders.take. A login with
/// only billing.manage (an accountant) never reaches the orders tabs: it
/// gets Billing (the full restaurant Billing screen, Food to bill/Bills
/// included) instead.
class FoodBillingScreen extends ConsumerStatefulWidget {
  const FoodBillingScreen({super.key});

  @override
  ConsumerState<FoodBillingScreen> createState() => _FoodBillingScreenState();
}

class _FoodBillingScreenState extends ConsumerState<FoodBillingScreen> {
  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authViewModelProvider).me;
    final permissions = me?.user.permissions ?? const [];
    final canOrders =
        permissions.contains('orders.manage') ||
        permissions.contains('orders.take');
    final canBill = permissions.contains('billing.manage');

    final ordersState = ref.watch(ordersViewModelProvider);
    final ordersVm = ref.read(ordersViewModelProvider.notifier);

    final segments = <_Segment>[
      if (canOrders) ...[
        _Segment(
          // Same label OrdersPanel.jsx's tab keeps even for a captain, whose
          // "queue" is really just their own still-open orders.
          label: ordersState.needsAccepting > 0
              ? 'Kitchen (${ordersState.needsAccepting} new)'
              : 'Kitchen queue',
          selected: ordersState.tab == OrdersTab.queue,
          onTap: () => ordersVm.setTab(OrdersTab.queue),
        ),
        _Segment(
          label: 'History',
          selected: ordersState.tab == OrdersTab.history,
          onTap: () => ordersVm.setTab(OrdersTab.history),
        ),
      ] else if (canBill)
        _Segment(label: 'Billing', selected: true, onTap: () {}),
    ];

    return Column(
      children: [
        if (segments.length > 1)
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppTheme.s16,
              AppTheme.s8,
              AppTheme.s16,
              0,
            ),
            child: _TabStrip(segments: segments),
          ),
        Expanded(
          child: canOrders
              ? const OrdersScreen(hideTabs: true)
              : const BillingScreen(restaurantOnly: true),
        ),
      ],
    );
  }
}

class _Segment {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _Segment({required this.label, required this.selected, required this.onTap});
}

class _TabStrip extends StatelessWidget {
  final List<_Segment> segments;

  const _TabStrip({required this.segments});

  static IconData _iconFor(String label) {
    if (label.startsWith('Kitchen')) return Icons.soup_kitchen_rounded;
    if (label == 'History') return Icons.history_rounded;
    return Icons.receipt_long_rounded;
  }

  @override
  Widget build(BuildContext context) {
    final selected = segments.indexWhere((s) => s.selected).clamp(0, segments.length - 1);
    return PillTabs(
      selected: '$selected',
      onSelect: (k) => segments[int.parse(k)].onTap(),
      tabs: [
        for (var i = 0; i < segments.length; i++)
          PillTab('$i', segments[i].label, _iconFor(segments[i].label)),
      ],
    );
  }
}
