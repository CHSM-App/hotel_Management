import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/food_order.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/orders_viewmodel.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'counter_order_screen.dart';

/// The kitchen queue, and the day behind it.
///
/// Split the same way the web's OrdersPanel.jsx is: `orders.manage` is the
/// queue (view, accept, cancel), `orders.cook` is ticking dishes off, and
/// `orders.take` is placing a counter order. A CAPTAIN login (orders.take
/// only) never sees the Kitchen queue tab or its actions — it lands on "My
/// orders" with the "+ Take an order" button instead, exactly like the web.
class OrdersScreen extends ConsumerStatefulWidget {
  const OrdersScreen({super.key});

  @override
  ConsumerState<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends ConsumerState<OrdersScreen> {
  /// The status cut, behind its own icon rather than sitting permanently on
  /// screen — folds open right under the date field, the same way the
  /// register page's own status filter does.
  bool _filterOpen = false;
  final LayerLink _filterLink = LayerLink();
  final OverlayPortalController _filterPortalController =
      OverlayPortalController();

  final _historySearch = TextEditingController();

  void _toggleFilterOpen() {
    setState(() => _filterOpen = !_filterOpen);
    if (_filterOpen) {
      _filterPortalController.show();
    } else {
      _filterPortalController.hide();
    }
  }

  @override
  void dispose() {
    _historySearch.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(ordersViewModelProvider);
    final vm = ref.read(ordersViewModelProvider.notifier);
    final me = ref.watch(authViewModelProvider).me;
    final permissions = me?.user.permissions ?? const [];
    final canWorkQueue = permissions.contains('orders.manage');
    final canTakeOrders = permissions.contains('orders.take');
    final canCook = permissions.contains('orders.cook');
    // A cook-only login (orders.manage + orders.cook, no orders.take — the
    // kitchen role) never accepts a guest's own order: that is front-of-
    // house's job. Same formula as OrdersPanel.jsx's own canAccept.
    final canAccept = canWorkQueue && !(canCook && !canTakeOrders);
    // The owner watches the kitchen and the queue but doesn't physically
    // hand food to a guest — same canHandOver() the web checks by role.
    final canHandOver = me?.user.role != 'OWNER';

    // A captain with no queue access lands on "My orders" instead — the
    // Kitchen tab is never shown to them, mirroring OrdersPanel.jsx. This
    // also switches the viewmodel into myOrdersMode: a month-wide, live,
    // "still open" list rather than a single picked day, which would be
    // empty on any day the captain hasn't personally placed an order yet.
    //
    // Called every build rather than once — configureForRole only acts when
    // canWorkQueue actually changed, so this is cheap, and it means a stale
    // decision (taken before `me` finished loading, or left over from this
    // screen briefly showing a different login) always self-corrects on the
    // next rebuild instead of sticking for the rest of this screen's life.
    // Skipped while `me` itself is still loading — permissions read as
    // empty then, which is not this login's real answer to hold onto.
    if (me != null) {
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => vm.configureForRole(canWorkQueue: canWorkQueue),
      );
    }

    return Stack(
      fit: StackFit.expand,
      children: [
        RefreshIndicator(
          onRefresh: () => (!state.myOrdersMode && state.tab == OrdersTab.queue)
              ? vm.loadQueue()
              : vm.loadHistory(),
          color: AppTheme.accent,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              AppTheme.s16,
              AppTheme.s8,
              AppTheme.s16,
              88,
            ),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              _TabRow(
                state: state,
                canWorkQueue: canWorkQueue,
                onSelect: vm.setTab,
              ),
              const SizedBox(height: AppTheme.s12),
              if (state.tab == OrdersTab.queue && canWorkQueue)
                ..._queue(
                  context,
                  ref,
                  state,
                  canCook: canCook,
                  canDeliver: canTakeOrders,
                  canAccept: canAccept,
                  canHandOver: canHandOver,
                )
              else
                ..._history(
                  context,
                  ref,
                  state,
                  canBillFood: canTakeOrders,
                  canCook: canCook,
                  canDeliver: canTakeOrders,
                  canHandOver: canHandOver,
                ),
            ],
          ),
        ),
        if (canTakeOrders)
          Positioned(
            right: AppTheme.s16,
            bottom: AppTheme.s16,
            child: FloatingActionButton(
              backgroundColor: AppTheme.accent,
              foregroundColor: Colors.white,
              onPressed: () async {
                final placed = await Navigator.of(context).push<bool>(
                  MaterialPageRoute(builder: (_) => const CounterOrderScreen()),
                );
                if (placed == true) await vm.loadQueue();
              },
              child: const Icon(Icons.add_rounded),
            ),
          ),
      ],
    );
  }

  // ── The queue ─────────────────────────────────────────────────────────────

  /// PENDING, QUEUED, PREPARING, READY, in that order — the stages the
  /// queue is sectioned by, same as OrdersPanel.jsx's own STATUS_ORDER.
  static const _stageOrder = ['PENDING', 'QUEUED', 'PREPARING', 'READY'];
  static const _stageLabel = {
    'PENDING': 'Waiting for you to accept',
    'QUEUED': 'In the queue',
    'PREPARING': 'Preparing',
    'READY': 'Ready to serve',
  };

  List<Widget> _queue(
    BuildContext context,
    WidgetRef ref,
    OrdersState state, {
    required bool canCook,
    required bool canDeliver,
    required bool canAccept,
    required bool canHandOver,
  }) {
    return state.queue.when(
      loading: () => const [
        SizedBox(height: 120),
        Center(child: CircularProgressIndicator()),
      ],
      error: (e, _) => [
        NeuNotice(
          icon: Icons.cloud_off_rounded,
          message: state.error ?? 'Could not reach the kitchen queue.',
          action: NeuButton(
            onPressed: () =>
                ref.read(ordersViewModelProvider.notifier).loadQueue(),
            child: const Text('Try again'),
          ),
        ),
      ],
      data: (all) {
        // A cook-only login (orders.manage + orders.cook, no orders.take —
        // the kitchen role) never accepts a guest's own order, so an
        // unaccepted one isn't shown to them at all — same filter
        // OrdersPanel.jsx's own `queue` applies.
        final orders = all
            .where((o) => canAccept || o.status != 'PENDING')
            .toList();
        if (orders.isEmpty) {
          return const [
            SizedBox(height: 80),
            NeuNotice(
              icon: Icons.restaurant_rounded,
              message: 'Nothing is cooking.',
            ),
          ];
        }

        final byStage = <String, List<FoodOrder>>{};
        for (final order in orders) {
          (byStage[order.status] ??= []).add(order);
        }

        return [
          for (final stage in _stageOrder)
            if (byStage[stage] != null) ...[
              Padding(
                padding: const EdgeInsets.only(
                  top: AppTheme.s4,
                  bottom: AppTheme.s8,
                ),
                child: Text(
                  '${_stageLabel[stage]} (${byStage[stage]!.length})',
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    color: stage == 'PENDING' ? AppTheme.danger : null,
                  ),
                ),
              ),
              if (stage == 'PENDING')
                Padding(
                  padding: const EdgeInsets.only(bottom: AppTheme.s8),
                  child: Text(
                    "These came from a table QR, so nobody has checked "
                    'them. Accept to send them to the kitchen, or cancel.',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              for (final order in byStage[stage]!)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppTheme.s4),
                  child: _OrderCard(
                    order: order,
                    now: state.now,
                    live: true,
                    canCook: canCook,
                    canDeliver: canDeliver,
                    canAccept: canAccept,
                    canHandOver: canHandOver,
                  ),
                ),
              const SizedBox(height: AppTheme.s8),
            ],
        ];
      },
    );
  }

  // ── The day ───────────────────────────────────────────────────────────────

  List<Widget> _history(
    BuildContext context,
    WidgetRef ref,
    OrdersState state, {
    required bool canBillFood,
    required bool canCook,
    required bool canDeliver,
    required bool canHandOver,
  }) {
    final vm = ref.read(ordersViewModelProvider.notifier);

    // A captain's "My orders" is a live, month-wide "still open" list — no
    // day to pick and no status to narrow, the same way OrdersPanel.jsx's
    // compact History drops those controls for a captain.
    if (state.myOrdersMode) {
      return _myOrdersBody(
        context,
        ref,
        state,
        canBillFood: canBillFood,
        canCook: canCook,
        canDeliver: canDeliver,
        canHandOver: canHandOver,
      );
    }

    final head = <Widget>[
      Row(
        children: [
          Expanded(
            child: _PeriodField(
              period: state.historyPeriod,
              from: state.historyCustomFrom,
              to: state.historyCustomTo,
              onSelect: (period) async {
                if (period != 'custom') {
                  await vm.setHistoryPeriod(period);
                  return;
                }
                final now = DateTime.now();
                final range = await showDateRangePicker(
                  context: context,
                  initialDateRange: DateTimeRange(
                    start: state.historyCustomFrom,
                    end: state.historyCustomTo,
                  ),
                  firstDate: DateTime(now.year - 2),
                  lastDate: now,
                );
                if (range != null) {
                  await vm.setHistoryCustomRange(range.start, range.end);
                }
              },
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
                      onTap: _toggleFilterOpen,
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
                        child: _StatusChips(
                          selected: state.historyStatus,
                          onSelect: (status) {
                            vm.setHistoryStatus(status);
                            _toggleFilterOpen();
                          },
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              child: _FilterButton(
                active: state.historyStatus != null,
                open: _filterOpen,
                onTap: _toggleFilterOpen,
              ),
            ),
          ),
        ],
      ),
      const SizedBox(height: AppTheme.s8),
      NeuField(
        controller: _historySearch,
        hint: 'Order #, room/table, guest, dish…',
        label: '',
        suffix: const Padding(
          padding: EdgeInsets.only(right: AppTheme.s12),
          child: Icon(Icons.search_rounded, size: 18, color: AppTheme.muted),
        ),
        onChanged: vm.setHistorySearch,
      ),
      const SizedBox(height: AppTheme.s12),
    ];

    final body = state.history.when(
      loading: () => const [
        SizedBox(height: 80),
        Center(child: CircularProgressIndicator()),
      ],
      error: (e, _) => [
        NeuNotice(
          icon: Icons.cloud_off_rounded,
          message: state.error ?? 'Could not load that day.',
          action: NeuButton(
            onPressed: vm.loadHistory,
            child: const Text('Try again'),
          ),
        ),
      ],
      data: (all) {
        final orders = all
            .where((o) => o.matchesSearch(state.historySearch))
            .toList();
        if (orders.isEmpty) {
          return [
            const SizedBox(height: 60),
            NeuNotice(
              icon: Icons.receipt_long_rounded,
              message: all.isEmpty
                  ? 'No orders in this period.'
                  : 'Nothing matches that search.',
            ),
          ];
        }
        return [
          for (final order in orders)
            Padding(
              padding: const EdgeInsets.only(bottom: AppTheme.s4),
              child: _OrderCard(
                order: order,
                now: state.now,
                live: false,
                canBillFood: canBillFood,
                canDeliver: canDeliver,
                // Same as OrdersPanel.jsx's renderHistoryRow: Accept and
                // Deliver both ride on orders.take here, not the Kitchen
                // tab's own canWorkQueue-based canAccept — History has no
                // separate front-of-house/kitchen split, just whoever holds
                // orders.take.
                canAccept: canDeliver && canHandOver,
                canHandOver: canHandOver,
              ),
            ),
        ];
      },
    );

    return [...head, ...body];
  }

  // ── "My orders" — a captain's own live queue ────────────────────────────

  List<Widget> _myOrdersBody(
    BuildContext context,
    WidgetRef ref,
    OrdersState state, {
    required bool canBillFood,
    required bool canCook,
    required bool canDeliver,
    required bool canHandOver,
  }) {
    final vm = ref.read(ordersViewModelProvider.notifier);

    return state.history.when(
      loading: () => const [
        SizedBox(height: 80),
        Center(child: CircularProgressIndicator()),
      ],
      error: (e, _) => [
        NeuNotice(
          icon: Icons.cloud_off_rounded,
          message: state.error ?? 'Could not load your orders.',
          action: NeuButton(
            onPressed: vm.loadHistory,
            child: const Text('Try again'),
          ),
        ),
      ],
      data: (orders) {
        // Same split as the tab itself: "Kitchen queue" is what's still
        // open, "History" is what's been settled — so the empty state reads
        // right for whichever one is actually showing nothing.
        final onQueueTab = state.tab == OrdersTab.queue;
        if (orders.isEmpty) {
          return [
            const SizedBox(height: 60),
            NeuNotice(
              icon: Icons.receipt_long_rounded,
              message: onQueueTab
                  ? 'Nothing open — every order is delivered and billed.'
                  : 'Nothing settled yet this month.',
            ),
          ];
        }
        return [
          for (final order in orders)
            Padding(
              padding: const EdgeInsets.only(bottom: AppTheme.s4),
              child: _OrderCard(
                order: order,
                now: state.now,
                live: onQueueTab,
                canCook: canCook,
                canBillFood: canBillFood,
                canDeliver: canDeliver,
                // A captain accepts a guest's own order on their own
                // orders.take, not the Kitchen tab's canWorkQueue-based
                // canAccept — same as OrdersPanel.jsx's renderCaptainCard.
                canAccept: canDeliver && canHandOver,
                canHandOver: canHandOver,
              ),
            ),
        ];
      },
    );
  }
}

// ── Queue / history switch ──────────────────────────────────────────────────

/// Same sliding-pill segmented control the billing screen's To-bill/Issued
/// switch and the rooms screen's Rooms/Price-chart switch use — one connected
/// control with a moving highlight, rather than two separate boxes that don't
/// read as a single tab bar.
class _TabRow extends StatelessWidget {
  final OrdersState state;
  final bool canWorkQueue;
  final ValueChanged<OrdersTab> onSelect;

  const _TabRow({
    required this.state,
    required this.canWorkQueue,
    required this.onSelect,
  });

  static const double _height = 38;

  @override
  Widget build(BuildContext context) {
    // Same two tabs for everyone, same as OrdersPanel.jsx: a captain (no
    // orders.manage) gets them too — the first still reads "Kitchen queue"
    // there, it just holds their own still-open orders instead of the real
    // cooking pipeline; the second is what has been settled.
    //
    // The count rides on the tab because a cook (or a captain) looking at
    // the day's history still needs to know something new has come in.
    final waiting = state.needsAccepting;
    final kitchenLabel = waiting > 0 ? 'Kitchen ($waiting new)' : 'Kitchen';
    final selectedIndex = state.tab == OrdersTab.queue ? 0 : 1;

    Widget segment(String label, bool isSelected, VoidCallback onTap) =>
        Expanded(
          child: GestureDetector(
            onTap: onTap,
            behavior: HitTestBehavior.opaque,
            child: SizedBox(
              height: _height,
              child: Center(
                child: AnimatedDefaultTextStyle(
                  duration: const Duration(milliseconds: 200),
                  curve: Curves.easeOut,
                  style: TextStyle(
                    color: isSelected ? AppTheme.accent : AppTheme.muted,
                    fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
                    fontSize: 13,
                  ),
                  child: Text(label, overflow: TextOverflow.ellipsis),
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
            alignment: selectedIndex == 0
                ? Alignment.centerLeft
                : Alignment.centerRight,
            child: FractionallySizedBox(
              widthFactor: 0.5,
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
          Row(
            children: [
              segment(
                kitchenLabel,
                selectedIndex == 0,
                () => onSelect(OrdersTab.queue),
              ),
              segment(
                'History',
                selectedIndex == 1,
                () => onSelect(OrdersTab.history),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// History's own period picker — Today, This month, or a custom range —
/// same three OrdersPanel.jsx's period control offers, behind one field
/// instead of three always-visible chips.
class _PeriodField extends StatelessWidget {
  final String period;
  final DateTime from;
  final DateTime to;
  final ValueChanged<String> onSelect;

  const _PeriodField({
    required this.period,
    required this.from,
    required this.to,
    required this.onSelect,
  });

  String get _label => switch (period) {
    'month' => 'This month',
    'custom' => from == to
        ? formatDate(from)
        : '${formatDate(from)} – ${formatDate(to)}',
    _ => 'Today',
  };

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<String>(
      onSelected: onSelect,
      offset: const Offset(0, 8),
      color: AppTheme.card,
      elevation: 6,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        side: const BorderSide(color: AppTheme.border),
      ),
      itemBuilder: (context) => [
        for (final entry in const {
          'today': 'Today',
          'month': 'This month',
          'custom': 'Custom range…',
        }.entries)
          PopupMenuItem<String>(
            value: entry.key,
            height: 44,
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    entry.value,
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ),
                if (entry.key == period)
                  const Icon(Icons.check_rounded, color: AppTheme.accent, size: 18),
              ],
            ),
          ),
      ],
      child: NeuCard(
        radius: AppTheme.rSmall,
        shadow: AppTheme.subtle,
        padding: const EdgeInsets.symmetric(
          horizontal: AppTheme.s12,
          vertical: AppTheme.s8,
        ),
        child: Row(
          children: [
            const Icon(Icons.event_rounded, size: 15, color: AppTheme.muted),
            const SizedBox(width: AppTheme.s8),
            Expanded(
              child: Text(
                _label,
                style: Theme.of(context).textTheme.bodyMedium,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const Icon(
              Icons.keyboard_arrow_down_rounded,
              size: 18,
              color: AppTheme.muted,
            ),
          ],
        ),
      ),
    );
  }
}

/// The status cut's own door — a funnel icon with a dot when a status is on,
/// right beside the date field. Tapping it folds the status chips open
/// directly underneath, the same way the register page's own filter icon
/// works, rather than the chips sitting permanently on screen.
class _FilterButton extends StatelessWidget {
  final bool active;
  final bool open;
  final VoidCallback onTap;

  const _FilterButton({
    required this.active,
    required this.open,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final on = active || open;
    return GestureDetector(
      onTap: onTap,
      child: NeuCard(
        radius: AppTheme.rSmall,
        shadow: AppTheme.subtle,
        padding: const EdgeInsets.symmetric(
          horizontal: AppTheme.s12,
          vertical: AppTheme.s8,
        ),
        child: SizedBox(
          width: 18,
          height: 15,
          child: Stack(
            clipBehavior: Clip.none,
            alignment: Alignment.center,
            children: [
              Icon(
                Icons.filter_alt_rounded,
                size: 18,
                color: on ? AppTheme.accent : AppTheme.muted,
              ),
              if (active)
                Positioned(
                  top: -2,
                  right: -2,
                  child: Container(
                    width: 8,
                    height: 8,
                    decoration: const BoxDecoration(
                      color: AppTheme.accent,
                      shape: BoxShape.circle,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusChips extends StatelessWidget {
  final String? selected;
  final ValueChanged<String?> onSelect;

  static const _options = <String?, String>{
    null: 'All',
    'DELIVERED': 'Delivered',
    'CANCELLED': 'Cancelled',
  };

  static const _icons = <String?, IconData>{
    null: Icons.apps_rounded,
    'DELIVERED': Icons.check_circle_rounded,
    'CANCELLED': Icons.cancel_rounded,
  };

  const _StatusChips({required this.selected, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 170,
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        boxShadow: AppTheme.subtle,
      ),
      padding: const EdgeInsets.symmetric(vertical: AppTheme.s8),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final entry in _options.entries)
            _Chip(
              label: entry.value,
              icon: _icons[entry.key]!,
              on: entry.key == selected,
              onTap: () => onSelect(entry.key),
            ),
        ],
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  final String label;
  final IconData icon;
  final bool on;
  final VoidCallback onTap;

  const _Chip({
    required this.label,
    required this.icon,
    required this.on,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: AppTheme.s12,
          vertical: AppTheme.s8,
        ),
        decoration: BoxDecoration(
          color: on
              ? AppTheme.accent.withValues(alpha: 0.10)
              : Colors.transparent,
          border: Border(
            left: BorderSide(
              color: on ? AppTheme.accent : Colors.transparent,
              width: 3,
            ),
          ),
        ),
        child: Row(
          children: [
            Icon(icon, size: 16, color: on ? AppTheme.accent : AppTheme.muted),
            const SizedBox(width: AppTheme.s8),
            Text(
              label,
              style: TextStyle(
                color: on ? AppTheme.accent : AppTheme.text,
                fontSize: 13,
                fontWeight: on ? FontWeight.w600 : FontWeight.w400,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── One ticket ──────────────────────────────────────────────────────────────

class _OrderCard extends ConsumerWidget {
  final FoodOrder order;
  final DateTime now;

  /// A live ticket carries its actions; a historical one is a record.
  final bool live;

  /// Whether this login may actually cook — gates the item ticks and the
  /// preparing/ready/deliver actions, same as OrdersPanel.jsx's `canCook`.
  /// A front-of-house role (orders.manage without orders.cook, e.g. OWNER or
  /// RECEPTION) only ever gets Accept and Cancel.
  final bool canCook;

  /// Whether this login may mark a delivered order ready to bill — same
  /// `orders.take` permission that gates placing a counter order.
  final bool canBillFood;

  /// Whether this login may carry a ready dish out to the guest — same
  /// `orders.take` permission that gates placing a counter order and
  /// marking an order ready to bill.
  final bool canDeliver;

  /// Whether this login may accept a PENDING (guest QR) order in this
  /// context — the Kitchen queue tab's own `canAccept`, or a captain's own
  /// `orders.take`; see the two call sites for which.
  final bool canAccept;

  /// Whether this login may physically hand food to a guest — false only
  /// for OWNER, same as OrdersPanel.jsx's `canHandOver()`.
  final bool canHandOver;

  const _OrderCard({
    required this.order,
    required this.now,
    required this.live,
    this.canCook = false,
    this.canBillFood = false,
    this.canDeliver = false,
    this.canAccept = false,
    this.canHandOver = true,
  });

  /// Which of the order's own [FoodOrder.nextStatuses] this login may act
  /// on from the whole-order action row — same per-status split
  /// OrdersPanel.jsx's own `visibleStatuses` makes: accepting is front-of-
  /// house, cooking-on is the kitchen, cancelling and handing over are the
  /// captain's.
  List<String> get _visibleStatuses => order.nextStatuses.where((s) {
    switch (s) {
      case 'QUEUED':
        return canAccept;
      case 'CANCELLED':
        return canDeliver && order.items.any((i) => !i.isReady);
      case 'DELIVERED':
        return canDeliver && canHandOver;
      default:
        return canCook;
    }
  }).toList();

  static Color _statusColour(String status) {
    switch (status) {
      case 'PENDING':
        return AppTheme.danger;
      case 'PREPARING':
        return AppTheme.checkedIn;
      case 'READY':
        return AppTheme.accent;
      case 'DELIVERED':
        return AppTheme.stayed;
      case 'CANCELLED':
        return AppTheme.danger;
      default:
        return AppTheme.reserved;
    }
  }

  /// The ticket's dishes, grouped by menu section when it spans more than
  /// one — collapsed behind its own summary (name, count, how many are
  /// ready) same as OrdersPanel.jsx's own renderSections, so a long ticket
  /// reads by course instead of one flat list. A single-section order (most
  /// of them) renders flat, same as the web does when there's nothing to
  /// group.
  List<Widget> _itemRows() {
    final sorted = [...order.items]
      ..sort((a, b) => a.categorySort.compareTo(b.categorySort));
    final groups = <String, List<FoodOrderItem>>{};
    for (final item in sorted) {
      final name = (item.category ?? '').isNotEmpty ? item.category! : 'Other';
      (groups[name] ??= []).add(item);
    }
    if (groups.length <= 1) {
      return [
        for (final item in order.items)
          _ItemLine(
            order: order,
            item: item,
            live: live,
            canCook: canCook,
            canDeliver: canDeliver,
          ),
      ];
    }
    return [
      for (final entry in groups.entries)
        _ItemSection(
          name: entry.key,
          items: entry.value,
          order: order,
          live: live,
          canCook: canCook,
          canDeliver: canDeliver,
        ),
    ];
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colour = _statusColour(order.status);
    final waited = order.waitingFor(now);
    final overdue = waited != null && waited.inMinutes >= 20;
    final actions = _visibleStatuses;

    return ClipRRect(
      borderRadius: BorderRadius.circular(AppTheme.rMedium),
      child: NeuCard(
        radius: AppTheme.rMedium,
        padding: EdgeInsets.zero,
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // A thin status-colour rail down the left edge — the ticket's
              // state readable at a glance, before any text is parsed.
              Container(width: 4, color: colour),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    AppTheme.s12,
                    AppTheme.s8,
                    AppTheme.s12,
                    AppTheme.s8,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Text(
                              // The number the kitchen calls out, then who it
                              // is for.
                              '#${order.orderNumber} · ${order.target}',
                              style: Theme.of(
                                context,
                              ).textTheme.titleSmall?.copyWith(fontSize: 14),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          const SizedBox(width: AppTheme.s8),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 3,
                            ),
                            decoration: BoxDecoration(
                              color: colour.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(999),
                            ),
                            child: Text(
                              order.billed
                                  ? 'Billed'
                                  : order.readyToBill
                                  ? 'Ready to bill'
                                  : order.statusLabel,
                              style: TextStyle(
                                color: colour,
                                fontSize: 10.5,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ],
                      ),
                      if ((live && waited != null) ||
                          (order.guestName ?? '').isNotEmpty) ...[
                        const SizedBox(height: 3),
                        Row(
                          children: [
                            if (live && waited != null) ...[
                              Icon(
                                Icons.access_time_filled_rounded,
                                size: 12,
                                color: overdue
                                    ? AppTheme.danger
                                    : AppTheme.muted,
                              ),
                              const SizedBox(width: 3),
                              Text(
                                'Waiting ${_elapsed(waited)}',
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: overdue
                                      ? FontWeight.w700
                                      : FontWeight.w500,
                                  // A ticket that has sat for twenty minutes
                                  // should read as a problem without anybody
                                  // having to do the subtraction.
                                  color: overdue
                                      ? AppTheme.danger
                                      : AppTheme.muted,
                                ),
                              ),
                            ],
                            if ((order.guestName ?? '').isNotEmpty) ...[
                              if (live && waited != null) ...[
                                const SizedBox(width: AppTheme.s8),
                                const Text(
                                  '·',
                                  style: TextStyle(
                                    color: AppTheme.muted,
                                    fontSize: 11,
                                  ),
                                ),
                                const SizedBox(width: AppTheme.s8),
                              ],
                              Expanded(
                                child: Text(
                                  order.guestName!,
                                  style: Theme.of(context).textTheme.labelSmall,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ],
                        ),
                      ],

                      const SizedBox(height: AppTheme.s8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: AppTheme.s8,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: AppTheme.bg,
                          borderRadius: BorderRadius.circular(AppTheme.rSmall),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: _itemRows(),
                        ),
                      ),

                      if ((order.note ?? '').isNotEmpty) ...[
                        const SizedBox(height: AppTheme.s4),
                        Text(
                          'Note: ${order.note}',
                          style: Theme.of(context).textTheme.labelSmall,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],

                      const SizedBox(height: AppTheme.s4),
                      const Divider(height: 1, color: AppTheme.border),
                      const SizedBox(height: AppTheme.s4),
                      Row(
                        children: [
                          Text(
                            'Total',
                            style: Theme.of(context).textTheme.labelSmall,
                          ),
                          const Spacer(),
                          Text(
                            formatPrice(order.subtotal),
                            style: const TextStyle(
                              color: AppTheme.heading,
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),

                      if (order.status == 'CANCELLED' &&
                          (order.cancelReason ?? '').isNotEmpty) ...[
                        const SizedBox(height: AppTheme.s4),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.symmetric(
                            horizontal: AppTheme.s8,
                            vertical: AppTheme.s4,
                          ),
                          decoration: BoxDecoration(
                            color: AppTheme.danger.withValues(alpha: 0.08),
                            borderRadius: BorderRadius.circular(
                              AppTheme.rSmall,
                            ),
                          ),
                          child: Text(
                            'Cancelled: ${order.cancelReason}',
                            style: Theme.of(context).textTheme.labelSmall
                                ?.copyWith(color: AppTheme.danger),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],

                      // Rendered only from what the server offered, filtered
                      // the same way OrdersPanel.jsx filters visibleStatuses:
                      // Accept (QUEUED) and Cancel are front-of-house,
                      // everything else is the kitchen actually cooking the
                      // order and needs orders.cook. A single action fills
                      // the row; several share it evenly rather than
                      // wrapping.
                      // Not gated on [live]: [_visibleStatuses] already only
                      // ever returns entries from the order's own
                      // nextStatuses, which the server leaves empty once an
                      // order is settled — so a History row still offers
                      // Accept/Deliver/Cancel for an order still actually
                      // open today, same as OrdersPanel.jsx's own
                      // renderHistoryRow (distinct from the item ticks and
                      // per-item Deliver below, which stay [live]-only: the
                      // web's History table has no per-item button, only
                      // the whole-order one).
                      if (actions.isNotEmpty) ...[
                        const SizedBox(height: AppTheme.s8),
                        Row(
                          children: [
                            for (var i = 0; i < actions.length; i++) ...[
                              if (i > 0) const SizedBox(width: AppTheme.s8),
                              Expanded(
                                child: NeuButton(
                                  primary: actions[i] != 'CANCELLED',
                                  expand: true,
                                  padding: const EdgeInsets.symmetric(
                                    vertical: AppTheme.s8 + 2,
                                  ),
                                  onPressed: () =>
                                      _advance(context, ref, actions[i]),
                                  child: Text(
                                    kOrderActionLabels[actions[i]] ??
                                        actions[i],
                                    style: const TextStyle(fontSize: 13),
                                  ),
                                ),
                              ),
                            ],
                          ],
                        ),
                      ],

                      // Delivered and unbilled: the captain can send it on
                      // to Billing's "Food to bill" queue — from history, or
                      // straight from "My orders" once it's fully delivered.
                      if (canBillFood && order.canMarkReadyToBill) ...[
                        const SizedBox(height: AppTheme.s8),
                        NeuButton(
                          primary: true,
                          expand: true,
                          padding: const EdgeInsets.symmetric(
                            vertical: AppTheme.s8 + 2,
                          ),
                          onPressed: () => _markReadyToBill(context, ref),
                          child: const Text(
                            'Ready to bill',
                            style: TextStyle(fontSize: 13),
                          ),
                        ),
                      ],

                      // Still unbilled and not sent to billing: the captain
                      // can correct what was rung in — same "Edit order" the
                      // web offers alongside Accept/Cancel.
                      if (canDeliver && order.isEditable) ...[
                        const SizedBox(height: AppTheme.s8),
                        NeuButton(
                          expand: true,
                          padding: const EdgeInsets.symmetric(
                            vertical: AppTheme.s8 + 2,
                          ),
                          onPressed: () => _editOrder(context),
                          child: const Text(
                            'Edit order',
                            style: TextStyle(fontSize: 13),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _elapsed(Duration d) {
    if (d.inMinutes < 1) return 'less than a minute';
    if (d.inMinutes < 60) return '${d.inMinutes}m';
    final hours = d.inHours;
    final minutes = d.inMinutes % 60;
    return minutes == 0 ? '${hours}h' : '${hours}h ${minutes}m';
  }

  Future<void> _advance(
    BuildContext context,
    WidgetRef ref,
    String next,
  ) async {
    final vm = ref.read(ordersViewModelProvider.notifier);

    String? reason;
    if (next == 'CANCELLED') {
      reason = await _askReason(context);
      // Null is backing out. An empty string is a cancellation with no reason
      // given, which the schema allows.
      if (reason == null || !context.mounted) return;
    }

    final ok = await vm.advance(order.id, next, cancelReason: reason);
    if (!context.mounted) return;
    if (!ok) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            ref.read(ordersViewModelProvider).error ??
                'Could not update that order.',
          ),
          backgroundColor: AppTheme.heading,
        ),
      );
    }
  }

  Future<void> _editOrder(BuildContext context) async {
    await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => CounterOrderScreen(editingOrder: order),
      ),
    );
  }

  Future<void> _markReadyToBill(BuildContext context, WidgetRef ref) async {
    final vm = ref.read(ordersViewModelProvider.notifier);
    final ok = await vm.markReadyToBill(order.id);
    if (!context.mounted) return;
    if (!ok) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            ref.read(ordersViewModelProvider).error ??
                'Could not send that order to billing.',
          ),
          backgroundColor: AppTheme.heading,
        ),
      );
    }
  }

  Future<String?> _askReason(BuildContext context) {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: const Text(
          'Cancel this order?',
          style: TextStyle(color: AppTheme.heading),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Order #${order.orderNumber} for ${order.target}.',
              style: const TextStyle(color: AppTheme.text, fontSize: 13),
            ),
            const SizedBox(height: AppTheme.s16),
            NeuField(
              controller: controller,
              label: 'Why (optional)',
              maxLength: 200,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Keep it'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Cancel order'),
          ),
        ],
      ),
    );
  }
}

/// One menu section's dishes on a ticket that spans more than one — folded
/// shut behind its own name, count and ready tally, same as
/// OrdersPanel.jsx's `<details>`/`<summary>` renderSections. Starts
/// collapsed; tapping the summary opens it to the dishes underneath.
class _ItemSection extends StatefulWidget {
  final String name;
  final List<FoodOrderItem> items;
  final FoodOrder order;
  final bool live;
  final bool canCook;
  final bool canDeliver;

  const _ItemSection({
    required this.name,
    required this.items,
    required this.order,
    required this.live,
    required this.canCook,
    required this.canDeliver,
  });

  @override
  State<_ItemSection> createState() => _ItemSectionState();
}

class _ItemSectionState extends State<_ItemSection> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final total = widget.items.fold<int>(0, (n, i) => n + i.quantity);
    final ready = widget.items
        .where((i) => i.isReady)
        .fold<int>(0, (n, i) => n + i.quantity);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InkWell(
          onTap: () => setState(() => _open = !_open),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: AppTheme.s4),
            child: Row(
              children: [
                Icon(
                  _open
                      ? Icons.keyboard_arrow_down_rounded
                      : Icons.keyboard_arrow_right_rounded,
                  size: 16,
                  color: AppTheme.muted,
                ),
                Expanded(
                  child: Text(
                    '${widget.name} · $total',
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: AppTheme.text,
                    ),
                  ),
                ),
                if (ready > 0)
                  Text(
                    ready == total ? 'All $total ready' : '$ready of $total ready',
                    style: const TextStyle(fontSize: 11, color: AppTheme.accent),
                  ),
              ],
            ),
          ),
        ),
        if (_open)
          Padding(
            padding: const EdgeInsets.only(left: AppTheme.s16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final item in widget.items)
                  _ItemLine(
                    order: widget.order,
                    item: item,
                    live: widget.live,
                    canCook: widget.canCook,
                    canDeliver: widget.canDeliver,
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

/// One dish on the ticket, with the kitchen's tick and the captain's own
/// "Deliver" — a dish leaves the kitchen's hands and the captain's in two
/// separate steps, same as OrdersPanel.jsx's ready tick and `deliverItem`.
class _ItemLine extends ConsumerWidget {
  final FoodOrder order;
  final FoodOrderItem item;
  final bool live;
  final bool canCook;
  final bool canDeliver;

  const _ItemLine({
    required this.order,
    required this.item,
    required this.live,
    this.canCook = false,
    this.canDeliver = false,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final done = item.isReady;
    final delivered = item.isDelivered;
    // The tick appears only while the order is being cooked, and only for a
    // login that may actually cook — same as OrdersPanel.jsx's `tickable`.
    // Outside that, the line is a plain record, same as a historical order.
    final tickable = live && order.status == 'PREPARING' && canCook;

    // Carried out to the guest once the kitchen has ticked it ready and
    // nobody has delivered it yet — same as OrdersPanel.jsx showing a
    // "Deliver" button on every ready, undelivered line.
    final deliverable = live && canDeliver && done && !delivered;

    final row = Padding(
      padding: const EdgeInsets.symmetric(vertical: AppTheme.s4 - 1),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (tickable)
            Padding(
              padding: const EdgeInsets.only(right: AppTheme.s4),
              child: Icon(
                done
                    ? Icons.check_circle_rounded
                    : Icons.radio_button_unchecked_rounded,
                size: 15,
                color: done ? AppTheme.accent : AppTheme.muted,
              ),
            ),
          Text(
            '${item.quantity}×  ',
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppTheme.text,
            ),
          ),
          Expanded(
            child: Text(
              item.name,
              style: TextStyle(
                fontSize: 13,
                color: delivered ? AppTheme.muted : AppTheme.text,
                decoration: delivered ? TextDecoration.lineThrough : null,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (deliverable)
            Padding(
              padding: const EdgeInsets.only(left: AppTheme.s8),
              child: GestureDetector(
                onTap: () => ref
                    .read(ordersViewModelProvider.notifier)
                    .deliverItem(order.id, item.id),
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: AppTheme.accent,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: const Text(
                    'Deliver',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            )
          else
            Padding(
              padding: const EdgeInsets.only(left: AppTheme.s8),
              child: Text(
                formatPrice(item.lineTotal),
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                  color: AppTheme.heading,
                ),
              ),
            ),
        ],
      ),
    );

    if (!tickable) return row;

    // Tappable both ways: a cook on a wall tablet mis-taps, and the server
    // takes a boolean precisely so the tick can be taken back.
    return GestureDetector(
      onTap: () => ref
          .read(ordersViewModelProvider.notifier)
          .setItemReady(order.id, item.id, !done),
      child: row,
    );
  }
}
