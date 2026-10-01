import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/food_order.dart';
import '../../domain/models/invoice.dart';
import '../../presentation/providers/usecase_provider.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/orders_viewmodel.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../billing/invoice_preview_screen.dart';
import '../billing/issue_food_bill_screen.dart';
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
  /// True when a parent (food_billing_screen.dart) already renders the
  /// Kitchen queue/History switch itself, alongside a Numbering tab neither
  /// enum here knows about — the same `hideTabs` OrdersPanel.jsx takes from
  /// FoodSection.jsx so one strip can cover both halves of the merged "Food
  /// orders & Billing" section.
  final bool hideTabs;

  const OrdersScreen({super.key, this.hideTabs = false});

  @override
  ConsumerState<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends ConsumerState<OrdersScreen> {
  final _historySearch = TextEditingController();

  /// The Kitchen queue's own search — client-side over whatever the poll
  /// already holds, same as History's own search box but with nothing to
  /// fetch: the live queue is already the whole list.
  final _queueSearch = TextEditingController();
  String _queueSearchText = '';

  @override
  void dispose() {
    _historySearch.dispose();
    _queueSearch.dispose();
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
    final canBill = permissions.contains('billing.manage');
    // A cook-only login (orders.manage + orders.cook, no orders.take — the
    // kitchen role) never accepts a guest's own order: that is front-of-
    // house's job. Same formula as OrdersPanel.jsx's own canAccept.
    final canAccept = canWorkQueue && !(canCook && !canTakeOrders);
    // The owner watches the kitchen and the queue but doesn't physically
    // hand food to a guest — same canHandOver() the web checks by role.
    final canHandOver = me?.user.role != 'OWNER';
    // Issuing a bill straight from an order needs orders.manage AND
    // orders.take AND billing.manage in the Kitchen queue (OrdersPanel.jsx's
    // own `canBillHere`), but only orders.take AND billing.manage in History
    // (its own `canViewBill`/`canDeliver` pair, no orders.manage required) —
    // the two differ because History is reachable without the queue at all.
    final canIssueBillQueue = canWorkQueue && canTakeOrders && canBill;
    final canIssueBillHistory = canTakeOrders && canBill;

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
              if (!widget.hideTabs) ...[
                _TabRow(
                  state: state,
                  canWorkQueue: canWorkQueue,
                  onSelect: vm.setTab,
                ),
                const SizedBox(height: AppTheme.s12),
              ],
              if (state.tab == OrdersTab.queue && canWorkQueue)
                ..._queue(
                  context,
                  ref,
                  state,
                  canCook: canCook,
                  canDeliver: canTakeOrders,
                  canAccept: canAccept,
                  canHandOver: canHandOver,
                  canIssueBill: canIssueBillQueue,
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
                  canIssueBill: canIssueBillHistory,
                  canViewBill: canBill,
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

  List<Widget> _queue(
    BuildContext context,
    WidgetRef ref,
    OrdersState state, {
    required bool canCook,
    required bool canDeliver,
    required bool canAccept,
    required bool canHandOver,
    required bool canIssueBill,
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

        // One flat list, oldest first — same as OrdersPanel.jsx's own
        // `queue`/`groups`, which stopped sectioning by stage: every live
        // ticket (including an old delivered-but-unbilled one still
        // waiting on "Issue bill") sits under one "Live orders" heading,
        // card view and spreadsheet alike.
        final sorted = [...orders]..sort(
          (a, b) => (a.placedAt ?? '').compareTo(b.placedAt ?? ''),
        );
        final pending = orders.where((o) => o.status == 'PENDING').length;
        final filtered = _queueSearchText.trim().isEmpty
            ? sorted
            : sorted.where((o) => o.matchesSearch(_queueSearchText)).toList();

        return [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: _SearchField(
                  controller: _queueSearch,
                  hint: 'Order #, room/table, guest, dish…',
                  onChanged: (v) => setState(() => _queueSearchText = v),
                ),
              ),
              const SizedBox(width: AppTheme.s8),
              OrdersViewToggle(
                view: state.listView,
                onChanged: ref.read(ordersViewModelProvider.notifier).setListView,
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s12),
          if (pending > 0)
            Padding(
              padding: const EdgeInsets.only(bottom: AppTheme.s8),
              child: NeuNotice(
                icon: Icons.notifications_active_rounded,
                message:
                    '$pending guest QR order${pending == 1 ? '' : 's'} '
                    'are waiting to be accepted — nobody has checked them yet.',
              ),
            ),
          Padding(
            padding: const EdgeInsets.only(bottom: AppTheme.s8),
            child: Text(
              'Live orders (${filtered.length})',
              style: Theme.of(context).textTheme.titleSmall,
            ),
          ),
          if (filtered.isEmpty)
            const NeuNotice(
              icon: Icons.search_off_rounded,
              message: 'Nothing matches that search.',
            )
          else if (state.listView == 'sheet')
            _OrdersSheet(
              orders: filtered,
              now: state.now,
              live: true,
              canCook: canCook,
              canDeliver: canDeliver,
              canAccept: canAccept,
              canHandOver: canHandOver,
              canIssueBill: canIssueBill,
              isRealQueue: true,
            )
          else
            for (final order in filtered)
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
                  canIssueBill: canIssueBill,
                  isRealQueue: true,
                ),
              ),
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
    required bool canIssueBill,
    required bool canViewBill,
  }) {
    final vm = ref.read(ordersViewModelProvider.notifier);

    // Only the captain's own "Kitchen queue" tab is compact — a live,
    // month-wide "still open" list with no day to pick and no status to
    // narrow, same as OrdersPanel.jsx's own `compact` (scope === 'active').
    // Their History tab is not compact: it falls through to the same
    // period-picker-and-list body everyone else's History uses.
    if (state.myOrdersMode && state.tab == OrdersTab.queue) {
      return _myOrdersBody(
        context,
        ref,
        state,
        canBillFood: canBillFood,
        canCook: canCook,
        canDeliver: canDeliver,
        canHandOver: canHandOver,
        canIssueBill: canIssueBill,
        canViewBill: canViewBill,
      );
    }

    final head = <Widget>[
      Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: _SearchField(
              controller: _historySearch,
              hint: 'Order #, room/table, guest, dish…',
              onChanged: vm.setHistorySearch,
            ),
          ),
          const SizedBox(width: AppTheme.s8),
          OrdersViewToggle(view: state.listView, onChanged: vm.setListView),
        ],
      ),
      const SizedBox(height: AppTheme.s8),
      _PeriodChipsRow(
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
        if (state.listView == 'sheet') {
          return [
            _OrdersSheet(
              orders: orders,
              now: state.now,
              live: false,
              canBillFood: canBillFood,
              canDeliver: canDeliver,
              canAccept: canDeliver && canHandOver,
              canHandOver: canHandOver,
              canIssueBill: canIssueBill,
              canViewBill: canViewBill,
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
                canIssueBill: canIssueBill,
                canViewBill: canViewBill,
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
    required bool canIssueBill,
    required bool canViewBill,
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
      data: (all) {
        // Same split as the tab itself: "Kitchen queue" is what's still
        // open, "History" is what's been settled — so the empty state reads
        // right for whichever one is actually showing nothing.
        final onQueueTab = state.tab == OrdersTab.queue;
        final head = <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: _SearchField(
                  controller: _historySearch,
                  hint: 'Order #, room/table, guest, dish…',
                  onChanged: vm.setHistorySearch,
                ),
              ),
              const SizedBox(width: AppTheme.s8),
              OrdersViewToggle(view: state.listView, onChanged: vm.setListView),
            ],
          ),
          const SizedBox(height: AppTheme.s12),
        ];

        if (all.isEmpty) {
          return [
            ...head,
            const SizedBox(height: 48),
            NeuNotice(
              icon: Icons.receipt_long_rounded,
              message: onQueueTab
                  ? 'Nothing open — every order is delivered and billed.'
                  : 'Nothing settled yet this month.',
            ),
          ];
        }

        final orders = all.where((o) => o.matchesSearch(state.historySearch)).toList();
        if (orders.isEmpty) {
          return [
            ...head,
            const SizedBox(height: 48),
            const NeuNotice(
              icon: Icons.search_off_rounded,
              message: 'Nothing matches that search.',
            ),
          ];
        }

        if (state.listView == 'sheet') {
          return [
            ...head,
            _OrdersSheet(
              orders: orders,
              now: state.now,
              live: onQueueTab,
              canCook: canCook,
              canBillFood: canBillFood,
              canDeliver: canDeliver,
              canAccept: canDeliver && canHandOver,
              canHandOver: canHandOver,
              canIssueBill: canIssueBill,
              canViewBill: canViewBill,
            ),
          ];
        }
        return [
          ...head,
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
                canIssueBill: canIssueBill,
                canViewBill: canViewBill,
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

// ── Search ───────────────────────────────────────────────────────────────────

/// The same pill-shaped search field every other list screen in the app uses
/// (assets_list_panel.dart, events_list_panel.dart, expenses_list_panel.dart,
/// income_list_panel.dart) — a circular accent-tinted icon badge, a borderless
/// field, and a clear (×) button once there is something to clear — rather
/// than the plain boxed [NeuField] this screen's search used before.
class _SearchField extends StatefulWidget {
  final TextEditingController controller;
  final String hint;
  final ValueChanged<String> onChanged;

  const _SearchField({
    required this.controller,
    required this.hint,
    required this.onChanged,
  });

  @override
  State<_SearchField> createState() => _SearchFieldState();
}

class _SearchFieldState extends State<_SearchField> {
  @override
  Widget build(BuildContext context) {
    return Container(
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
              controller: widget.controller,
              onChanged: (v) {
                setState(() {});
                widget.onChanged(v);
              },
              style: const TextStyle(color: AppTheme.heading, fontSize: 14),
              decoration: InputDecoration(
                hintText: widget.hint,
                hintStyle: const TextStyle(color: AppTheme.muted, fontSize: 13),
                border: InputBorder.none,
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(vertical: 13),
              ),
            ),
          ),
          if (widget.controller.text.isNotEmpty)
            GestureDetector(
              onTap: () {
                widget.controller.clear();
                setState(() {});
                widget.onChanged('');
              },
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
    );
  }
}

// ── Spreadsheet / cards ──────────────────────────────────────────────────────

/// Same `ViewToggle` OrdersPanel.jsx renders for the kitchen queue and
/// History: a dense spreadsheet (every ticket as one row) or the cards
/// everywhere else on this screen already used before this switch existed.
///
/// Public (not `_ViewToggle`) so food_billing_screen.dart can place it
/// itself, in the corner of its own tab strip, when it hides this screen's
/// own one.
class OrdersViewToggle extends StatelessWidget {
  final String view;
  final ValueChanged<String> onChanged;

  const OrdersViewToggle({super.key, required this.view, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    Widget button(String value, IconData icon, String tooltip) {
      final on = view == value;
      return Tooltip(
        message: tooltip,
        child: InkWell(
          onTap: () => onChanged(value),
          borderRadius: BorderRadius.circular(AppTheme.rSmall),
          child: Container(
            padding: const EdgeInsets.all(AppTheme.s8),
            decoration: BoxDecoration(
              color: on ? AppTheme.accent.withValues(alpha: 0.1) : null,
              borderRadius: BorderRadius.circular(AppTheme.rSmall),
            ),
            child: Icon(
              icon,
              size: 17,
              color: on ? AppTheme.accent : AppTheme.muted,
            ),
          ),
        ),
      );
    }

    return Align(
      alignment: Alignment.centerRight,
      child: NeuCard(
        radius: AppTheme.rSmall,
        shadow: AppTheme.subtle,
        padding: const EdgeInsets.all(2),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            button('sheet', Icons.table_rows_rounded, 'Spreadsheet view'),
            button('cards', Icons.view_agenda_rounded, 'Card view'),
          ],
        ),
      ),
    );
  }
}

/// History's own period picker — Today, This month, or a custom range, as
/// three always-visible chips, same as OrdersPanel.jsx's own
/// `order-history__filters` period row — not folded behind a funnel icon.
class _PeriodChipsRow extends StatelessWidget {
  final String period;
  final DateTime from;
  final DateTime to;
  final ValueChanged<String> onSelect;

  const _PeriodChipsRow({
    required this.period,
    required this.from,
    required this.to,
    required this.onSelect,
  });

  String get _customLabel =>
      from == to ? formatDate(from) : '${formatDate(from)} – ${formatDate(to)}';

  @override
  Widget build(BuildContext context) {
    Widget chip(String key, String label) {
      final on = period == key;
      return Padding(
        padding: const EdgeInsets.only(right: AppTheme.s8),
        child: InkWell(
          onTap: () => onSelect(key),
          borderRadius: BorderRadius.circular(999),
          child: Container(
            padding: const EdgeInsets.symmetric(
              horizontal: AppTheme.s12,
              vertical: AppTheme.s8,
            ),
            decoration: BoxDecoration(
              color: on ? AppTheme.accent.withValues(alpha: 0.1) : AppTheme.card,
              border: Border.all(color: on ? AppTheme.accent : AppTheme.border),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              label,
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: on ? FontWeight.w700 : FontWeight.w500,
                color: on ? AppTheme.accent : AppTheme.text,
              ),
            ),
          ),
        ),
      );
    }

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          chip('today', 'Today'),
          chip('month', 'This month'),
          chip('custom', period == 'custom' ? _customLabel : 'Custom'),
        ],
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

  /// Whether this login may issue the bill directly from here — same
  /// `canBillHere`/`canViewBill && canDeliver` OrdersPanel.jsx computes per
  /// screen. When true, a delivered order offers "Issue bill" (which opens
  /// the bill straight away) instead of merely "Ready to bill".
  final bool canIssueBill;

  /// Whether this login may open an already-issued bill from here — History
  /// only; the Kitchen queue never shows "View bill".
  final bool canViewBill;

  /// True only for the real Kitchen queue (Owner/Kitchen/Reception's own
  /// cooking pipeline) — the one place OrdersPanel.jsx's renderOrder never
  /// offers Edit or View bill at all. A captain's own "Kitchen" tab is not
  /// this: it is myOrdersMode's own live list, and OrdersPanel.jsx's
  /// renderCaptainCard (used there too) offers both regardless of whether
  /// the order is still open — same as this screen's own History tab.
  final bool isRealQueue;

  const _OrderCard({
    required this.order,
    required this.now,
    required this.live,
    this.canCook = false,
    this.canBillFood = false,
    this.canDeliver = false,
    this.canAccept = false,
    this.canHandOver = true,
    this.canIssueBill = false,
    this.canViewBill = false,
    this.isRealQueue = false,
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
                          order.customerLabel != null) ...[
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
                            if (order.customerLabel != null) ...[
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
                                  order.customerLabel!,
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

                      // Still unbilled and not sent to billing: the captain
                      // can correct what was rung in — same "Edit order" the
                      // web offers alongside Accept/Cancel. Not on the real
                      // Kitchen queue — OrdersPanel.jsx's renderOrder never
                      // offers it there — but shown everywhere else,
                      // including a captain's own "Kitchen" tab, same as
                      // renderCaptainCard.
                      if (!isRealQueue && canDeliver && order.isEditable) ...[
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

                      // Already billed: open what was issued. Not on the
                      // real Kitchen queue, same as OrdersPanel.jsx's own
                      // `viewBill`.
                      if (!isRealQueue && canViewBill && order.invoiceId != null) ...[
                        const SizedBox(height: AppTheme.s8),
                        NeuButton(
                          expand: true,
                          padding: const EdgeInsets.symmetric(
                            vertical: AppTheme.s8 + 2,
                          ),
                          onPressed: () =>
                              _viewOrderBill(context, ref, order.invoiceId!),
                          child: const Text(
                            'View bill',
                            style: TextStyle(fontSize: 13),
                          ),
                        ),
                      ],

                      // Delivered and unbilled: either straight to a bill
                      // (this login also holds billing.manage, same as
                      // OrdersPanel.jsx's `readyToBill.issues`) or queued for
                      // whoever does (`canBillFood` alone) — never both.
                      if (canIssueBill &&
                          order.isDeliveredUnbilled &&
                          order.billableAsFoodTab) ...[
                        const SizedBox(height: AppTheme.s8),
                        NeuButton(
                          primary: true,
                          expand: true,
                          padding: const EdgeInsets.symmetric(
                            vertical: AppTheme.s8 + 2,
                          ),
                          onPressed: () => _issueBillForOrder(context, ref, order),
                          child: const Text(
                            'Issue bill',
                            style: TextStyle(fontSize: 13),
                          ),
                        ),
                      ] else if (canBillFood && order.canMarkReadyToBill) ...[
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

                      // A table or takeaway can also go on a staying guest's
                      // room bill instead of being paid for here — same
                      // `canRoom` exception OrdersPanel.jsx carves out (rooms
                      // only, never a room order itself).
                      if ((canIssueBill || canBillFood) &&
                          order.isDeliveredUnbilled &&
                          order.source != 'ROOM' &&
                          (ref.watch(authViewModelProvider).me?.lodge.hasRooms ??
                              false)) ...[
                        const SizedBox(height: AppTheme.s8),
                        NeuButton(
                          expand: true,
                          padding: const EdgeInsets.symmetric(
                            vertical: AppTheme.s8 + 2,
                          ),
                          onPressed: () => _addOrderToRoom(context, ref, order),
                          child: const Text(
                            'Add to room',
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

// ── The spreadsheet ──────────────────────────────────────────────────────────

/// One ticket per row, same column set OrdersPanel.jsx's own
/// `renderQueueTable` (and History's own spreadsheet) lay out: order
/// number, where it's for, the dishes, status, a time column, the total,
/// and whatever actions this login may take — a dense read for a desk that
/// wants to scan many tickets at once rather than scroll a wall of cards.
class _OrdersSheet extends ConsumerStatefulWidget {
  final List<FoodOrder> orders;
  final DateTime now;

  /// A live ticket shows how long it has been waiting; a settled one shows
  /// when it was placed instead — same as the queue/History split elsewhere
  /// on this screen.
  final bool live;

  final bool canCook;
  final bool canBillFood;
  final bool canDeliver;
  final bool canAccept;
  final bool canHandOver;

  /// Same `canBillHere`/`canViewBill && canDeliver` OrdersPanel.jsx computes
  /// per screen — when true, a delivered order's bill button reads "Issue
  /// bill" and opens it directly instead of only queueing it.
  final bool canIssueBill;

  /// History only — the Kitchen queue never offers "View bill".
  final bool canViewBill;

  /// True only for the real Kitchen queue — see `_OrderCard.isRealQueue`,
  /// which this mirrors.
  final bool isRealQueue;

  const _OrdersSheet({
    required this.orders,
    required this.now,
    required this.live,
    this.canCook = false,
    this.canBillFood = false,
    this.canDeliver = false,
    this.canAccept = false,
    this.canHandOver = true,
    this.canIssueBill = false,
    this.canViewBill = false,
    this.isRealQueue = false,
  });

  @override
  ConsumerState<_OrdersSheet> createState() => _OrdersSheetState();
}

class _OrdersSheetState extends ConsumerState<_OrdersSheet> {
  /// Tickets whose dishes are open, by order id — same `<details>` behaviour
  /// OrdersPanel.jsx's own `renderSections`/`sumline` toggle gives each
  /// ticket, read by course rather than a bare count.
  final Set<int> _open = {};

  /// Queue columns: #, Where, Dishes, Status, Waiting, Total, Actions — same
  /// as OrdersPanel.jsx's own `renderQueueTable`. History adds Placed and
  /// Took (how long the ticket ran from placed to settled), same as its own
  /// history-table columns.
  static const _liveWidths = [46.0, 118.0, 120.0, 190.0, 104.0, 72.0, 78.0, 132.0];
  static const _historyWidths = [46.0, 70.0, 108.0, 120.0, 190.0, 104.0, 78.0, 70.0, 132.0];

  List<double> get _widths => widget.live ? _liveWidths : _historyWidths;
  double get _totalWidth => _widths.reduce((a, b) => a + b);

  @override
  Widget build(BuildContext context) {
    Widget head(String label, {TextAlign align = TextAlign.left}) => Text(
      label.toUpperCase(),
      textAlign: align,
      style: const TextStyle(
        fontSize: 10.5,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.3,
        color: AppTheme.muted,
      ),
    );

    final headerCells = widget.live
        ? [
            head('#'),
            head('Where'),
            head('Customer'),
            head('Dishes'),
            head('Status'),
            head('Waiting'),
            head('Total', align: TextAlign.right),
            head('Actions'),
          ]
        : [
            head('#'),
            head('Placed'),
            head('Where'),
            head('Customer'),
            head('Dishes'),
            head('Status'),
            head('Total', align: TextAlign.right),
            head('Took'),
            head('Actions'),
          ];

    return NeuCard(
      padding: EdgeInsets.zero,
      radius: AppTheme.rMedium,
      shadow: AppTheme.subtle,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: SizedBox(
            width: _totalWidth,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                _sheetRow(header: true, cells: headerCells),
                for (var i = 0; i < widget.orders.length; i++) ...[
                  _sheetRow(
                    shaded: i.isOdd,
                    cells: _rowCells(context, widget.orders[i]),
                  ),
                  if (_open.contains(widget.orders[i].id))
                    _dishesExpanded(widget.orders[i], shaded: i.isOdd),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _sheetRow({required List<Widget> cells, bool header = false, bool shaded = false}) {
    return Container(
      decoration: BoxDecoration(
        color: header
            ? AppTheme.bg
            : shaded
            ? AppTheme.border.withValues(alpha: 0.4)
            : AppTheme.card,
        border: Border(
          bottom: BorderSide(color: AppTheme.border, width: header ? 1.4 : 0.8),
        ),
      ),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (var i = 0; i < cells.length; i++)
              SizedBox(
                width: _widths[i],
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppTheme.s8,
                    vertical: AppTheme.s8,
                  ),
                  child: cells[i],
                ),
              ),
          ],
        ),
      ),
    );
  }

  /// Dishes grouped by menu section, in menu order — same grouping
  /// OrdersPanel.jsx's own `sectionsOf`/`renderSections` reads.
  static List<MapEntry<String, List<FoodOrderItem>>> _groups(FoodOrder order) {
    final sorted = [...order.items]
      ..sort((a, b) => a.categorySort.compareTo(b.categorySort));
    final groups = <String, List<FoodOrderItem>>{};
    for (final item in sorted) {
      final name = (item.category ?? '').isNotEmpty ? item.category! : 'Other';
      (groups[name] ??= []).add(item);
    }
    return groups.entries.toList();
  }

  /// The Dishes cell itself — a tap target the whole row's width, summarised
  /// by section ("Snacks 3/3"), same as the web's own `sumline`. Tapping
  /// opens [_dishesExpanded] below with every dish named.
  Widget _dishesCell(FoodOrder order) {
    final isOpen = _open.contains(order.id);
    final groups = _groups(order);
    return InkWell(
      onTap: () => setState(() {
        if (isOpen) {
          _open.remove(order.id);
        } else {
          _open.add(order.id);
        }
      }),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            isOpen ? Icons.keyboard_arrow_down_rounded : Icons.keyboard_arrow_right_rounded,
            size: 16,
            color: AppTheme.muted,
          ),
          Expanded(
            child: Wrap(
              spacing: 8,
              runSpacing: 2,
              children: [
                for (final g in groups)
                  Text(
                    '${g.key} ${g.value.where((i) => i.isReady).length}/${g.value.length}',
                    style: const TextStyle(fontSize: 12),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Every dish on [order], by name — the full-width row that opens under a
  /// ticket once [_dishesCell] is tapped, same as the web's own
  /// `queue-sub`/expanded `<details>`: each section's dishes as a row of
  /// pills, a dish's pill tinted once the kitchen has ticked it ready.
  Widget _dishesExpanded(FoodOrder order, {required bool shaded}) {
    return Container(
      width: _totalWidth,
      color: shaded ? AppTheme.border.withValues(alpha: 0.25) : AppTheme.bg,
      padding: const EdgeInsets.fromLTRB(
        AppTheme.s16 + AppTheme.s8,
        0,
        AppTheme.s8,
        AppTheme.s8,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final g in _groups(order))
            Padding(
              padding: const EdgeInsets.only(bottom: AppTheme.s4),
              child: Wrap(
                spacing: 6,
                runSpacing: 4,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(
                    g.key,
                    style: const TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w700,
                      color: AppTheme.muted,
                    ),
                  ),
                  for (final item in g.value)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: item.isReady
                            ? AppTheme.accent.withValues(alpha: 0.12)
                            : AppTheme.card,
                        border: item.isReady
                            ? null
                            : Border.all(color: AppTheme.border),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        '${item.quantity}× ${item.name}',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: item.isReady ? AppTheme.accent : AppTheme.text,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          if (order.note != null && order.note!.isNotEmpty)
            Text(
              '"${order.note}"',
              style: const TextStyle(fontSize: 11, color: AppTheme.muted, fontStyle: FontStyle.italic),
            ),
        ],
      ),
    );
  }

  /// Where this ticket is for, plus who it came from and who is working it
  /// — a guest's own QR scan or a member of staff, and (once somebody has)
  /// their name — same as OrdersPanel.jsx's own `SourceTag`/`HandledBy`.
  Widget _whereCell(FoodOrder order) {
    final place = order.source == 'ROOM'
        ? 'Room'
        : order.source == 'TABLE'
        ? 'Table'
        : 'Counter';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Wrap(
          spacing: 4,
          runSpacing: 2,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text(
              order.target,
              style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
              decoration: BoxDecoration(
                color: order.guestOrder
                    ? AppTheme.accent.withValues(alpha: 0.12)
                    : AppTheme.border.withValues(alpha: 0.6),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                order.guestOrder ? '$place QR' : 'Staff',
                style: TextStyle(
                  fontSize: 9,
                  fontWeight: FontWeight.w700,
                  color: order.guestOrder ? AppTheme.accent : AppTheme.muted,
                ),
              ),
            ),
          ],
        ),
        if ((order.handledBy ?? '').isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text(
              '${order.guestOrder ? 'Accepted' : 'Taken'} by ${order.handledBy}',
              style: const TextStyle(fontSize: 10.5, color: AppTheme.muted),
              overflow: TextOverflow.ellipsis,
            ),
          ),
      ],
    );
  }

  /// Who the food is for — its own column, same as OrdersPanel.jsx's own
  /// `history-table__customer` cell, separate from [_whereCell]'s table/room
  /// number and who placed it.
  Widget _customerCell(FoodOrder order) {
    final name = order.guestName ?? '';
    final phone = order.guestPhone ?? '';
    if (name.isEmpty && phone.isEmpty) {
      return const Text('—', style: TextStyle(fontSize: 12, color: AppTheme.muted));
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          name.isNotEmpty ? name : '—',
          style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
          overflow: TextOverflow.ellipsis,
        ),
        if (phone.isNotEmpty)
          Text(
            phone,
            style: const TextStyle(fontSize: 10.5, color: AppTheme.muted),
            overflow: TextOverflow.ellipsis,
          ),
      ],
    );
  }

  Widget _statusCell(FoodOrder order) {
    final colour = _OrderCard._statusColour(order.status);
    final statusText = order.billed
        ? 'Billed'
        : order.readyToBill
        ? 'Ready to bill'
        : order.statusLabel;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          decoration: BoxDecoration(
            color: colour.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(999),
          ),
          child: Text(
            statusText,
            style: TextStyle(color: colour, fontSize: 10, fontWeight: FontWeight.w600),
          ),
        ),
        // The bill this order settled on, once one exists — same as
        // OrdersPanel.jsx's own `Bill {o.invoiceNumber}` note under Status.
        if ((order.invoiceNumber ?? '').isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text(
              'Bill ${order.invoiceNumber}',
              style: const TextStyle(fontSize: 10, color: AppTheme.muted),
            ),
          ),
      ],
    );
  }

  List<Widget> _rowCells(BuildContext context, FoodOrder order) {
    final numberCell = Text(
      '#${order.orderNumber}',
      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5),
    );
    final totalCell = Text(
      formatPrice(order.subtotal),
      textAlign: TextAlign.right,
      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5),
    );
    final actionsCell = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: _sheetActionButtons(context, order),
    );

    if (widget.live) {
      final waited = order.waitingFor(widget.now);
      final overdue = waited != null && waited.inMinutes >= 20;
      return [
        numberCell,
        _whereCell(order),
        _customerCell(order),
        _dishesCell(order),
        _statusCell(order),
        Text(
          waited == null ? '—' : _OrderCard._elapsed(waited),
          style: TextStyle(
            fontSize: 12,
            color: overdue ? AppTheme.danger : AppTheme.muted,
            fontWeight: overdue ? FontWeight.w700 : FontWeight.w400,
          ),
        ),
        totalCell,
        actionsCell,
      ];
    }

    final took = order.took;
    return [
      numberCell,
      Text(formatTimeOfDay(order.placedAt), style: const TextStyle(fontSize: 12)),
      _whereCell(order),
      _customerCell(order),
      _dishesCell(order),
      _statusCell(order),
      totalCell,
      Text(
        took == null ? '—' : _OrderCard._elapsed(took),
        style: const TextStyle(fontSize: 12, color: AppTheme.muted),
      ),
      actionsCell,
    ];
  }

  /// Every action this login may take on [order] from the spreadsheet row —
  /// the same per-status split `_OrderCard._visibleStatuses` makes, in the
  /// same order OrdersPanel.jsx's own history row does: the next-status
  /// buttons, then Edit, View bill, Issue/Ready to bill — so the spreadsheet
  /// never offers less than the card view would. Full-width stacked buttons,
  /// the same solid/outline pair the web's own `.history-table__btn` and
  /// `.history-table__btn--danger` are, rather than a row of small chips.
  List<Widget> _sheetActionButtons(BuildContext context, FoodOrder order) {
    final actions = order.nextStatuses.where((s) {
      switch (s) {
        case 'QUEUED':
          return widget.canAccept;
        case 'CANCELLED':
          return widget.canDeliver && order.items.any((i) => !i.isReady);
        case 'DELIVERED':
          return widget.canDeliver && widget.canHandOver;
        default:
          return widget.canCook;
      }
    });

    final buttons = <Widget>[
      for (final status in actions)
        _SheetActionButton(
          label: kOrderActionLabels[status] ?? status,
          danger: status == 'CANCELLED',
          primary: status != 'CANCELLED',
          onTap: () => _advanceOrderStatus(context, ref, order, status),
        ),
    ];

    // Edit and View bill are never on the real Kitchen queue, same as
    // OrdersPanel.jsx's renderOrder — but a captain's own "Kitchen" tab
    // (myOrdersMode, not isRealQueue) gets both, same as renderCaptainCard.
    if (!widget.isRealQueue && widget.canDeliver && order.isEditable) {
      buttons.add(
        _SheetActionButton(
          label: 'Edit',
          onTap: () => _openEditOrder(context, order),
        ),
      );
    }
    if (!widget.isRealQueue && widget.canViewBill && order.invoiceId != null) {
      buttons.add(
        _SheetActionButton(
          label: 'View bill',
          onTap: () => _viewOrderBill(context, ref, order.invoiceId!),
        ),
      );
    }

    if (widget.canIssueBill && order.isDeliveredUnbilled && order.billableAsFoodTab) {
      buttons.add(
        _SheetActionButton(
          label: 'Issue bill',
          primary: true,
          onTap: () => _issueBillForOrder(context, ref, order),
        ),
      );
    } else if (widget.canBillFood && order.canMarkReadyToBill) {
      buttons.add(
        _SheetActionButton(
          label: 'Ready to bill',
          primary: true,
          onTap: () async {
            final ok = await ref
                .read(ordersViewModelProvider.notifier)
                .markReadyToBill(order.id);
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
          },
        ),
      );
    }

    // A table or takeaway can also go on a staying guest's room bill instead
    // of being paid for here — same `canRoom` exception OrdersPanel.jsx
    // carves out (rooms only, never a room order itself).
    if ((widget.canIssueBill || widget.canBillFood) &&
        order.isDeliveredUnbilled &&
        order.source != 'ROOM' &&
        (ref.watch(authViewModelProvider).me?.lodge.hasRooms ?? false)) {
      buttons.add(
        _SheetActionButton(
          label: 'Add to room',
          onTap: () => _addOrderToRoom(context, ref, order),
        ),
      );
    }

    return buttons;
  }
}

/// One full-width button inside a spreadsheet row's Actions cell — solid
/// accent for the action that moves a ticket forward or bills it, a plain
/// outline for a side action (Edit, View bill), a red outline for Cancel —
/// the same three the web's own `.history-table__btn` carries, stacked
/// instead of wrapped so each reads its whole label.
class _SheetActionButton extends StatelessWidget {
  final String label;
  final bool primary;
  final bool danger;
  final VoidCallback onTap;

  const _SheetActionButton({
    required this.label,
    this.primary = false,
    this.danger = false,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final fg = danger ? AppTheme.danger : (primary ? Colors.white : AppTheme.accent);
    final bg = primary && !danger ? AppTheme.accent : Colors.transparent;
    final border = danger ? AppTheme.danger : AppTheme.accent;

    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
        child: Container(
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 6),
          decoration: BoxDecoration(
            color: bg,
            border: Border.all(color: border),
            borderRadius: BorderRadius.circular(AppTheme.rSmall),
          ),
          child: Text(
            label,
            textAlign: TextAlign.center,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: fg),
          ),
        ),
      ),
    );
  }
}

/// Issue the bill for [order] straight away — same flow as OrdersPanel.jsx's
/// own `issueBill`: marks it ready-to-bill first if nothing has yet (a
/// captain may already have queued it), then opens the bill for that order's
/// own table/room/counter tab. Used by both the card and the spreadsheet row,
/// from the Kitchen queue and from History alike.
Future<void> _issueBillForOrder(
  BuildContext context,
  WidgetRef ref,
  FoodOrder order,
) async {
  final ordersVm = ref.read(ordersViewModelProvider.notifier);
  if (!order.readyToBill) {
    final ok = await ordersVm.markReadyToBill(order.id);
    if (!context.mounted) return;
    if (!ok) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            ref.read(ordersViewModelProvider).error ?? 'Could not open the bill.',
          ),
          backgroundColor: AppTheme.heading,
        ),
      );
      return;
    }
  }

  await ref.read(billingViewModelProvider.notifier).openFood(
    FoodTab(
      tab: order.billingTabKey,
      tableLabel: order.source == 'ROOM' ? 'Room ${order.roomNumber ?? ''}' : order.tableLabel,
      guestName: order.guestName,
      subtotal: order.subtotal,
    ),
  );
  if (!context.mounted) return;
  await Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => const IssueFoodBillScreen()),
  );
  if (!context.mounted) return;
  await ordersVm.loadQueue();
  await ordersVm.loadHistory();
}

/// A guest staying in the property asks for a table or takeaway to go on
/// their room bill instead of being paid for here — same flow as
/// OrdersPanel.jsx's own `AddToRoomDialog`: picks the checked-in guest,
/// marks the order ready to bill if it is not yet, and moves it onto that
/// stay's bill.
Future<void> _addOrderToRoom(
  BuildContext context,
  WidgetRef ref,
  FoodOrder order,
) async {
  final added = await showDialog<bool>(
    context: context,
    builder: (_) => _AddToRoomDialog(order: order),
  );
  if (added != true || !context.mounted) return;
  final ordersVm = ref.read(ordersViewModelProvider.notifier);
  await ordersVm.loadQueue();
  await ordersVm.loadHistory();
}

class _AddToRoomDialog extends ConsumerStatefulWidget {
  final FoodOrder order;

  const _AddToRoomDialog({required this.order});

  @override
  ConsumerState<_AddToRoomDialog> createState() => _AddToRoomDialogState();
}

class _AddToRoomDialogState extends ConsumerState<_AddToRoomDialog> {
  List<InHouseGuest>? _guests;
  int? _bookingId;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    ref.read(billingUsecaseProvider).inHouseGuests().then((guests) {
      if (!mounted) return;
      setState(() => _guests = guests);
    }).catchError((_) {
      if (!mounted) return;
      setState(() {
        _guests = const [];
        _error = 'Could not load the guests who are staying.';
      });
    });
  }

  Future<void> _confirm() async {
    if (_bookingId == null || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final order = widget.order;
    final ordersVm = ref.read(ordersViewModelProvider.notifier);
    try {
      if (!order.readyToBill) {
        final ok = await ordersVm.markReadyToBill(order.id);
        if (!ok) {
          throw ref.read(ordersViewModelProvider).error ??
              'Could not add this to the room bill.';
        }
      }
      await ref
          .read(billingUsecaseProvider)
          .addFoodTabToRoom(order.billingTabKey, _bookingId!);
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'Could not add this to the room bill.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final order = widget.order;
    final label = order.source == 'TABLE'
        ? (order.tableLabel ?? 'Table')
        : 'Takeaway #${order.orderNumber}';

    return AlertDialog(
      backgroundColor: AppTheme.bg,
      title: const Text(
        'Add to room bill',
        style: TextStyle(color: AppTheme.heading),
      ),
      content: SizedBox(
        width: 320,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '$label · ${formatPrice(order.subtotal)}',
              style: const TextStyle(color: AppTheme.muted, fontSize: 13),
            ),
            const SizedBox(height: AppTheme.s12),
            if (_error != null) ...[
              Text(_error!, style: const TextStyle(color: AppTheme.danger)),
              const SizedBox(height: AppTheme.s8),
            ],
            if (_guests == null)
              const Text('Loading guests…', style: TextStyle(color: AppTheme.muted))
            else if (_guests!.isEmpty)
              const Text(
                'Nobody is checked in right now.',
                style: TextStyle(color: AppTheme.muted),
              )
            else
              DropdownButtonFormField<int>(
                value: _bookingId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Guest'),
                items: [
                  for (final g in _guests!)
                    DropdownMenuItem(
                      value: g.bookingId,
                      child: Text(
                        'Room ${g.roomNumber ?? ''} · ${g.guestName ?? ''}',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                ],
                onChanged: _busy ? null : (v) => setState(() => _bookingId = v),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _busy || _bookingId == null ? null : _confirm,
          child: Text(_busy ? 'Adding…' : 'Add to room bill'),
        ),
      ],
    );
  }
}

/// Opens the bill already issued for [invoiceId] — History's own "View
/// bill", fetched fresh since an order only carries the bare id.
Future<void> _viewOrderBill(
  BuildContext context,
  WidgetRef ref,
  int invoiceId,
) async {
  try {
    final invoice = await ref.read(billingUsecaseProvider).invoice(invoiceId);
    if (!context.mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => InvoicePreviewScreen(invoice: invoice)),
    );
  } catch (_) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Could not load that bill.'),
        backgroundColor: AppTheme.heading,
      ),
    );
  }
}

/// Opens the editor for [order] — the spreadsheet row's own "Edit", same
/// push `_OrderCard._editOrder` makes.
Future<void> _openEditOrder(BuildContext context, FoodOrder order) async {
  await Navigator.of(context).push<bool>(
    MaterialPageRoute(builder: (_) => CounterOrderScreen(editingOrder: order)),
  );
}

/// Moves [order] on, same flow as `_OrderCard._advance` — a standalone
/// function rather than a method so the spreadsheet row (which has no
/// `_OrderCard` instance of its own) can trigger exactly the same
/// cancel-reason prompt and error handling.
Future<void> _advanceOrderStatus(
  BuildContext context,
  WidgetRef ref,
  FoodOrder order,
  String next,
) async {
  final vm = ref.read(ordersViewModelProvider.notifier);

  String? reason;
  if (next == 'CANCELLED') {
    reason = await _askCancelReason(context, order);
    if (reason == null || !context.mounted) return;
  }

  final ok = await vm.advance(order.id, next, cancelReason: reason);
  if (!context.mounted) return;
  if (!ok) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          ref.read(ordersViewModelProvider).error ?? 'Could not update that order.',
        ),
        backgroundColor: AppTheme.heading,
      ),
    );
  }
}

Future<String?> _askCancelReason(BuildContext context, FoodOrder order) {
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
          NeuField(controller: controller, label: 'Why (optional)', maxLength: 200),
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
