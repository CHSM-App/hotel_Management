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
  final OverlayPortalController _filterPortalController = OverlayPortalController();

  void _toggleFilterOpen() {
    setState(() => _filterOpen = !_filterOpen);
    if (_filterOpen) {
      _filterPortalController.show();
    } else {
      _filterPortalController.hide();
    }
  }

  @override
  Widget build(BuildContext context) {
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
              padding: const EdgeInsets.only(bottom: AppTheme.s8),
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
              padding: const EdgeInsets.only(bottom: AppTheme.s8),
              child: _OrderCard(order: order, now: state.now, live: false),
            ),
        ];
      },
    );

    return [...head, ...body];
  }
}

// ── Queue / history switch ──────────────────────────────────────────────────

/// Same sliding-pill segmented control the billing screen's To-bill/Issued
/// switch and the rooms screen's Rooms/Price-chart switch use — one connected
/// control with a moving highlight, rather than two separate boxes that don't
/// read as a single tab bar.
class _TabRow extends StatelessWidget {
  final OrdersState state;
  final ValueChanged<OrdersTab> onSelect;

  const _TabRow({required this.state, required this.onSelect});

  static const double _height = 44;

  @override
  Widget build(BuildContext context) {
    // The count rides on the tab because a cook looking at the day's history
    // still needs to know something new has come in.
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
            alignment:
                selectedIndex == 0 ? Alignment.centerLeft : Alignment.centerRight,
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
              segment(kitchenLabel, selectedIndex == 0, () => onSelect(OrdersTab.queue)),
              segment('Earlier', selectedIndex == 1, () => onSelect(OrdersTab.history)),
            ],
          ),
        ],
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
          color: on ? AppTheme.accent.withValues(alpha: 0.10) : Colors.transparent,
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
      padding: const EdgeInsets.symmetric(
        horizontal: AppTheme.s12,
        vertical: AppTheme.s8,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  // The number the kitchen calls out, then who it is for.
                  '#${order.orderNumber} · ${order.target}',
                  style: const TextStyle(
                    color: AppTheme.heading,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 8,
                  vertical: 2,
                ),
                decoration: BoxDecoration(
                  color: colour.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  order.statusLabel,
                  style: TextStyle(
                    color: colour,
                    fontSize: 10,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          ),
          if ((live && waited != null) || (order.guestName ?? '').isNotEmpty) ...[
            const SizedBox(height: AppTheme.s4),
            Row(
              children: [
                if ((order.guestName ?? '').isNotEmpty)
                  Expanded(
                    child: Text(
                      order.guestName!,
                      style: const TextStyle(color: AppTheme.muted, fontSize: 11),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                if (live && waited != null)
                  Text(
                    'Waiting ${_elapsed(waited)}',
                    style: TextStyle(
                      // A ticket that has sat for twenty minutes should read
                      // as a problem without anybody having to do the
                      // subtraction.
                      color: waited.inMinutes >= 20
                          ? AppTheme.danger
                          : AppTheme.muted,
                      fontSize: 11,
                    ),
                  ),
              ],
            ),
          ],

          const SizedBox(height: AppTheme.s8),
          for (final item in order.items)
            _ItemLine(order: order, item: item, live: live),

          if ((order.note ?? '').isNotEmpty) ...[
            const SizedBox(height: AppTheme.s4),
            Text(
              'Note: ${order.note}',
              style: const TextStyle(color: AppTheme.muted, fontSize: 11),
            ),
          ],

          const SizedBox(height: AppTheme.s4),
          Row(
            children: [
              const Expanded(
                child: Text(
                  'Total',
                  style: TextStyle(color: AppTheme.muted, fontSize: 11),
                ),
              ),
              Text(
                formatPrice(order.subtotal),
                style: const TextStyle(
                  color: AppTheme.heading,
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),

          if (order.status == 'CANCELLED' &&
              (order.cancelReason ?? '').isNotEmpty) ...[
            const SizedBox(height: AppTheme.s4),
            Text(
              'Cancelled: ${order.cancelReason}',
              style: const TextStyle(color: AppTheme.muted, fontSize: 11),
            ),
          ],

          // Rendered only from what the server offered. The phone never
          // decides which transitions are legal — it names the ones it was
          // handed, so a rule change on the server needs no release here.
          if (live && order.nextStatuses.isNotEmpty) ...[
            const SizedBox(height: AppTheme.s8),
            Wrap(
              spacing: AppTheme.s8,
              runSpacing: AppTheme.s8,
              children: [
                for (final next in order.nextStatuses)
                  NeuButton(
                    primary: next != 'CANCELLED',
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppTheme.s12,
                      vertical: AppTheme.s8,
                    ),
                    onPressed: () => _advance(context, ref, next),
                    child: Text(
                      kOrderActionLabels[next] ?? next,
                      style: const TextStyle(fontSize: 13),
                    ),
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
      padding: const EdgeInsets.only(bottom: AppTheme.s4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (live)
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
            style: const TextStyle(color: AppTheme.muted, fontSize: 12),
          ),
          Expanded(
            child: Text(
              item.name,
              style: TextStyle(
                color: done ? AppTheme.muted : AppTheme.text,
                fontSize: 12,
                decoration: done ? TextDecoration.lineThrough : null,
              ),
            ),
          ),
          Text(
            formatPrice(item.lineTotal),
            style: const TextStyle(color: AppTheme.muted, fontSize: 11),
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
