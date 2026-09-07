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
/// This is the section a KITCHEN login lands on, and until now the only one it
/// could reach — the seeded role carries `orders.manage` and nothing else, so
/// a cook signing in got a single tab with a placeholder behind it.
class OrdersScreen extends ConsumerWidget {
  const OrdersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(ordersViewModelProvider);
    final vm = ref.read(ordersViewModelProvider.notifier);

    return Stack(
      fit: StackFit.expand,
      children: [
        RefreshIndicator(
          onRefresh: () => state.tab == OrdersTab.queue
              ? vm.loadQueue()
              : vm.loadHistory(),
          color: AppTheme.accent,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              AppTheme.s16,
              AppTheme.s8,
              AppTheme.s16,
              96,
            ),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              _TabRow(state: state, onSelect: vm.setTab),
              const SizedBox(height: AppTheme.s16),
              if (state.tab == OrdersTab.queue)
                ..._queue(context, ref, state)
              else
                ..._history(context, ref, state),
            ],
          ),
        ),
        Positioned(
          left: AppTheme.s16,
          right: AppTheme.s16,
          bottom: AppTheme.s16,
          child: NeuButton(
            primary: true,
            expand: true,
            onPressed: () async {
              final placed = await Navigator.of(context).push<bool>(
                MaterialPageRoute(builder: (_) => const CounterOrderScreen()),
              );
              if (placed == true) await vm.loadQueue();
            },
            child: const Text('Take an order'),
          ),
        ),
      ],
    );
  }

  // ── The queue ─────────────────────────────────────────────────────────────

  List<Widget> _queue(BuildContext context, WidgetRef ref, OrdersState state) {
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
      data: (orders) {
        if (orders.isEmpty) {
          return const [
            SizedBox(height: 80),
            NeuNotice(
              icon: Icons.restaurant_rounded,
              message: 'Nothing is cooking.',
            ),
          ];
        }
        return [
          for (final order in orders)
            Padding(
              padding: const EdgeInsets.only(bottom: AppTheme.s12),
              child: _OrderCard(order: order, now: state.now, live: true),
            ),
        ];
      },
    );
  }

  // ── The day ───────────────────────────────────────────────────────────────

  List<Widget> _history(
    BuildContext context,
    WidgetRef ref,
    OrdersState state,
  ) {
    final vm = ref.read(ordersViewModelProvider.notifier);

    final head = <Widget>[
      Row(
        children: [
          Expanded(
            child: GestureDetector(
              onTap: () async {
                final now = DateTime.now();
                final picked = await showDatePicker(
                  context: context,
                  initialDate: state.historyDate,
                  firstDate: DateTime(now.year - 2),
                  lastDate: now,
                );
                if (picked != null) await vm.setHistoryDate(picked);
              },
              child: NeuCard(
                radius: AppTheme.rSmall,
                shadow: AppTheme.subtle,
                padding: const EdgeInsets.symmetric(
                  horizontal: AppTheme.s12,
                  vertical: AppTheme.s8,
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.event_rounded,
                      size: 15,
                      color: AppTheme.muted,
                    ),
                    const SizedBox(width: AppTheme.s8),
                    Text(
                      formatDate(state.historyDate),
                      style: const TextStyle(
                        color: AppTheme.text,
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
      const SizedBox(height: AppTheme.s12),
      _StatusChips(
        selected: state.historyStatus,
        onSelect: vm.setHistoryStatus,
      ),
      const SizedBox(height: AppTheme.s16),
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
      data: (orders) {
        if (orders.isEmpty) {
          return const [
            SizedBox(height: 60),
            NeuNotice(
              icon: Icons.receipt_long_rounded,
              message: 'No orders on this day.',
            ),
          ];
        }
        return [
          for (final order in orders)
            Padding(
              padding: const EdgeInsets.only(bottom: AppTheme.s12),
              child: _OrderCard(order: order, now: state.now, live: false),
            ),
        ];
      },
    );

    return [...head, ...body];
  }
}

// ── Queue / history switch ──────────────────────────────────────────────────

class _TabRow extends StatelessWidget {
  final OrdersState state;
  final ValueChanged<OrdersTab> onSelect;

  const _TabRow({required this.state, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    // The count rides on the tab because a cook looking at the day's history
    // still needs to know something new has come in.
    final waiting = state.needsAccepting;

    return Row(
      children: [
        Expanded(
          child: _Tab(
            label: waiting > 0 ? 'Kitchen ($waiting new)' : 'Kitchen',
            selected: state.tab == OrdersTab.queue,
            onTap: () => onSelect(OrdersTab.queue),
          ),
        ),
        const SizedBox(width: AppTheme.s8),
        Expanded(
          child: _Tab(
            label: 'Earlier',
            selected: state.tab == OrdersTab.history,
            onTap: () => onSelect(OrdersTab.history),
          ),
        ),
      ],
    );
  }
}

class _Tab extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _Tab({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final child = Text(
      label,
      textAlign: TextAlign.center,
      style: TextStyle(
        color: selected ? AppTheme.accent : AppTheme.text,
        fontWeight: selected ? FontWeight.w500 : FontWeight.w400,
        fontSize: 13,
      ),
    );

    return GestureDetector(
      onTap: onTap,
      child: selected
          ? NeuPressed(
              radius: 999,
              padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
              child: child,
            )
          : NeuCard(
              radius: 999,
              shadow: AppTheme.subtle,
              padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
              child: child,
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

  const _StatusChips({required this.selected, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final entry in _options.entries) ...[
            GestureDetector(
              onTap: () => onSelect(entry.key),
              child: entry.key == selected
                  ? NeuPressed(
                      radius: 999,
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppTheme.s16,
                        vertical: AppTheme.s8,
                      ),
                      child: Text(
                        entry.value,
                        style: const TextStyle(
                          color: AppTheme.accent,
                          fontWeight: FontWeight.w500,
                          fontSize: 13,
                        ),
                      ),
                    )
                  : NeuCard(
                      radius: 999,
                      shadow: AppTheme.subtle,
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppTheme.s16,
                        vertical: AppTheme.s8,
                      ),
                      child: Text(
                        entry.value,
                        style: const TextStyle(
                          color: AppTheme.text,
                          fontSize: 13,
                        ),
                      ),
                    ),
            ),
            const SizedBox(width: AppTheme.s8),
          ],
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

  const _OrderCard({
    required this.order,
    required this.now,
    required this.live,
  });

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
        return AppTheme.muted;
      default:
        return AppTheme.reserved;
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colour = _statusColour(order.status);
    final waited = order.waitingFor(now);

    return NeuCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  // The number the kitchen calls out, then who it is for.
                  '#${order.orderNumber} · ${order.target}',
                  style: Theme.of(context).textTheme.titleMedium,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: colour.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  order.statusLabel,
                  style: TextStyle(
                    color: colour,
                    fontSize: 11,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          ),
          if (live && waited != null) ...[
            const SizedBox(height: AppTheme.s4),
            Text(
              'Waiting ${_elapsed(waited)}',
              style: TextStyle(
                // A ticket that has sat for twenty minutes should read as a
                // problem without anybody having to do the subtraction.
                color: waited.inMinutes >= 20 ? AppTheme.danger : AppTheme.muted,
                fontSize: 12,
              ),
            ),
          ],
          if ((order.guestName ?? '').isNotEmpty) ...[
            const SizedBox(height: AppTheme.s4),
            Text(
              order.guestName!,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],

          const SizedBox(height: AppTheme.s12),
          for (final item in order.items)
            _ItemLine(order: order, item: item, live: live),

          if ((order.note ?? '').isNotEmpty) ...[
            const SizedBox(height: AppTheme.s8),
            Text(
              'Note: ${order.note}',
              style: const TextStyle(color: AppTheme.muted, fontSize: 12),
            ),
          ],

          const SizedBox(height: AppTheme.s12),
          Row(
            children: [
              const Expanded(
                child: Text(
                  'Total',
                  style: TextStyle(color: AppTheme.muted, fontSize: 12),
                ),
              ),
              Text(
                formatPrice(order.subtotal),
                style: const TextStyle(
                  color: AppTheme.heading,
                  fontSize: 15,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),

          if (order.status == 'CANCELLED' &&
              (order.cancelReason ?? '').isNotEmpty) ...[
            const SizedBox(height: AppTheme.s8),
            Text(
              'Cancelled: ${order.cancelReason}',
              style: const TextStyle(color: AppTheme.muted, fontSize: 12),
            ),
          ],

          // Rendered only from what the server offered. The phone never
          // decides which transitions are legal — it names the ones it was
          // handed, so a rule change on the server needs no release here.
          if (live && order.nextStatuses.isNotEmpty) ...[
            const SizedBox(height: AppTheme.s12),
            Wrap(
              spacing: AppTheme.s8,
              runSpacing: AppTheme.s8,
              children: [
                for (final next in order.nextStatuses)
                  NeuButton(
                    primary: next != 'CANCELLED',
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppTheme.s16,
                      vertical: AppTheme.s12,
                    ),
                    onPressed: () => _advance(context, ref, next),
                    child: Text(kOrderActionLabels[next] ?? next),
                  ),
              ],
            ),
          ],
        ],
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

/// One dish on the ticket, with the kitchen's tick.
class _ItemLine extends ConsumerWidget {
  final FoodOrder order;
  final FoodOrderItem item;
  final bool live;

  const _ItemLine({
    required this.order,
    required this.item,
    required this.live,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final done = item.isReady;

    final row = Padding(
      padding: const EdgeInsets.only(bottom: AppTheme.s8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (live)
            Padding(
              padding: const EdgeInsets.only(right: AppTheme.s8),
              child: Icon(
                done
                    ? Icons.check_circle_rounded
                    : Icons.radio_button_unchecked_rounded,
                size: 18,
                color: done ? AppTheme.accent : AppTheme.muted,
              ),
            ),
          Text(
            '${item.quantity}×  ',
            style: const TextStyle(color: AppTheme.muted, fontSize: 13),
          ),
          Expanded(
            child: Text(
              item.name,
              style: TextStyle(
                color: done ? AppTheme.muted : AppTheme.text,
                fontSize: 13,
                decoration: done ? TextDecoration.lineThrough : null,
              ),
            ),
          ),
          Text(
            formatPrice(item.lineTotal),
            style: const TextStyle(color: AppTheme.muted, fontSize: 12),
          ),
        ],
      ),
    );

    if (!live) return row;

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
