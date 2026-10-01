import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/orders_viewmodel.dart';
import '../billing/billing_screen.dart';
import '../billing/numbering_screen.dart';
import '../theme.dart';
import 'orders_screen.dart';

/// One sidebar entry for the restaurant — orders and billing merged under a
/// single flat tab strip, the same merge FoodSection.jsx makes of
/// OrdersPanel.jsx and `<Billing stream="restaurant" />`
/// (propertyProfile.js's 'food' row is now titled "Food orders & Billing").
///
/// The strip mirrors FoodSection.jsx's own `strip` exactly: Kitchen queue and
/// History show for a login holding orders.manage/orders.take, with
/// Numbering appended when it also holds billing.manage — a login with both
/// (OWNER, RECEPTION) gets exactly those three tabs, nothing else. Food to
/// bill and Bills drop out entirely in that case, because a delivered
/// order's own row already offers Issue bill (orders_screen.dart's
/// `canIssueBill`) — there is nothing left for a separate billing list to
/// show that the order list doesn't. A login with only billing.manage (an
/// accountant) never reaches the orders tabs: it gets Billing (the full
/// restaurant Billing screen, Food to bill/Bills included) and Numbering
/// instead.
class FoodBillingScreen extends ConsumerStatefulWidget {
  const FoodBillingScreen({super.key});

  @override
  ConsumerState<FoodBillingScreen> createState() => _FoodBillingScreenState();
}

class _FoodBillingScreenState extends ConsumerState<FoodBillingScreen> {
  /// Numbering isn't a value of [OrdersTab] — [OrdersViewModel] has no idea
  /// billing exists — so this screen tracks it on its own, the same way
  /// FoodSection.jsx's own `view` carries 'billing' alongside the order
  /// view's 'queue'/'active'/'history'.
  bool _onNumbering = false;

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
          selected: !_onNumbering && ordersState.tab == OrdersTab.queue,
          onTap: () {
            setState(() => _onNumbering = false);
            ordersVm.setTab(OrdersTab.queue);
          },
        ),
        _Segment(
          label: 'History',
          selected: !_onNumbering && ordersState.tab == OrdersTab.history,
          onTap: () {
            setState(() => _onNumbering = false);
            ordersVm.setTab(OrdersTab.history);
          },
        ),
      ] else if (canBill)
        _Segment(
          label: 'Billing',
          selected: !_onNumbering,
          onTap: () => setState(() => _onNumbering = false),
        ),
      if (canBill)
        _Segment(
          label: 'Numbering',
          selected: _onNumbering,
          onTap: () => setState(() => _onNumbering = true),
        ),
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
          child: _onNumbering
              ? const Padding(
                  padding: EdgeInsets.all(AppTheme.s16),
                  child: NumberingScreen(),
                )
              : canOrders
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

/// The same sliding-pill strip every other switch on this screen uses
/// (Kitchen queue/History inside orders_screen.dart, the billing screen's
/// own toggle) — generalised to however many segments this login's
/// permissions produce (two or three), rather than the two-only shape a
/// plain left/right toggle would assume.
class _TabStrip extends StatelessWidget {
  final List<_Segment> segments;

  const _TabStrip({required this.segments});

  static const double _height = 38;

  @override
  Widget build(BuildContext context) {
    final slot = segments.indexWhere((s) => s.selected).clamp(0, segments.length - 1);

    Widget segment(_Segment s) => Expanded(
      child: GestureDetector(
        onTap: s.onTap,
        behavior: HitTestBehavior.opaque,
        child: SizedBox(
          height: _height,
          child: Center(
            child: AnimatedDefaultTextStyle(
              duration: const Duration(milliseconds: 200),
              curve: Curves.easeOut,
              style: TextStyle(
                color: s.selected ? AppTheme.accent : AppTheme.muted,
                fontWeight: s.selected ? FontWeight.w600 : FontWeight.w500,
                fontSize: 13,
              ),
              child: Text(s.label, overflow: TextOverflow.ellipsis),
            ),
          ),
        ),
      ),
    );

    return Container(
      height: _height,
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
      ),
      child: Stack(
        children: [
          AnimatedAlign(
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
            alignment: Alignment(
              -1 + (2 * slot) / (segments.length - 1).clamp(1, 999),
              0,
            ),
            child: FractionallySizedBox(
              widthFactor: 1 / segments.length,
              child: Container(
                height: _height - 8,
                decoration: BoxDecoration(
                  color: AppTheme.card,
                  borderRadius: BorderRadius.circular(AppTheme.rMedium - 4),
                  boxShadow: AppTheme.extruded,
                ),
              ),
            ),
          ),
          Row(children: [for (final s in segments) segment(s)]),
        ],
      ),
    );
  }
}
