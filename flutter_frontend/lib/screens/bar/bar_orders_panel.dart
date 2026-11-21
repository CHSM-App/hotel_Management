import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/bar.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'bar_common.dart';
import 'bar_take_order_screen.dart';

/// The bar's live orders: deliver, add, mark ready to bill, add to a room bill.
class BarOrdersPanel extends ConsumerStatefulWidget {
  const BarOrdersPanel({super.key});

  @override
  ConsumerState<BarOrdersPanel> createState() => _BarOrdersPanelState();
}

class _BarOrdersPanelState extends ConsumerState<BarOrdersPanel> {
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(barViewModelProvider.notifier).loadOrders());
    _poll = Timer.periodic(const Duration(seconds: 10), (_) {
      if (mounted) ref.read(barViewModelProvider.notifier).loadOrders(silent: true);
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _take([BarOrder? existing]) async {
    await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => BarTakeOrderScreen(existing: existing)));
    if (mounted) ref.read(barViewModelProvider.notifier).loadOrders(silent: true);
  }

  Future<void> _act(Future<bool> Function() run, String done) async {
    final ok = await run();
    if (!mounted) return;
    barSnack(context, ok ? done : (ref.read(barViewModelProvider).error ?? 'Something went wrong.'));
  }

  Future<void> _toRoom(BarOrder o) async {
    final vm = ref.read(barViewModelProvider.notifier);
    BarGuest? g;
    if (o.source == 'ROOM' && o.roomId != null && o.bookingId != null) {
      g = BarGuest(roomId: o.roomId!, roomNumber: o.roomNumber ?? '', bookingId: o.bookingId!);
    } else {
      await vm.loadTargets();
      if (!mounted) return;
      g = await pickBarRoom(context, ref.read(barViewModelProvider).targets.guests);
    }
    if (g == null || !mounted) return;
    final guest = g;
    await _act(() => vm.addToRoom([o.id], guest.bookingId, guest.roomId), 'Added to Room ${guest.roomNumber} bill.');
  }

  @override
  Widget build(BuildContext context) {
    final bar = ref.watch(barViewModelProvider);
    final me = ref.watch(authViewModelProvider).me;
    final canTake = me?.user.can('bar.take') ?? false;
    final orders = bar.openOrders;
    final cols = AppTheme.isDesktop(context) ? (MediaQuery.of(context).size.width > 1200 ? 3 : 2) : 1;

    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: canTake
          ? FloatingActionButton.extended(
              onPressed: _take,
              icon: const Icon(Icons.add_rounded),
              label: const Text('Take order'),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: () => ref.read(barViewModelProvider.notifier).loadOrders(),
        child: bar.isLoading && bar.orders.isEmpty
            ? const Center(child: CircularProgressIndicator())
            : bar.error != null && bar.orders.isEmpty
            ? ListView(children: [NeuNotice(icon: Icons.error_outline_rounded, message: bar.error!)])
            : orders.isEmpty
            ? ListView(children: const [NeuNotice(icon: Icons.local_bar_rounded, message: 'No open bar orders.\nTap “Take order” to start one.')])
            : GridView.builder(
                padding: EdgeInsets.fromLTRB(AppTheme.gutter(context), AppTheme.s8, AppTheme.gutter(context), 96),
                gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: cols,
                  mainAxisExtent: 380,
                  crossAxisSpacing: AppTheme.s12,
                  mainAxisSpacing: AppTheme.s12,
                ),
                itemCount: orders.length,
                itemBuilder: (_, i) => _OrderCard(
                  order: orders[i],
                  canTake: canTake,
                  onAdd: () => _take(orders[i]),
                  onToRoom: () => _toRoom(orders[i]),
                  onAct: _act,
                ),
              ),
      ),
    );
  }
}

class _OrderCard extends ConsumerWidget {
  final BarOrder order;
  final bool canTake;
  final VoidCallback onAdd;
  final VoidCallback onToRoom;
  final Future<void> Function(Future<bool> Function() run, String done) onAct;

  const _OrderCard({required this.order, required this.canTake, required this.onAdd, required this.onToRoom, required this.onAct});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final vm = ref.read(barViewModelProvider.notifier);
    final o = order;
    final busy = ref.watch(barViewModelProvider.select((s) => s.submitting));
    final chipColor = o.undelivered > 0 ? AppTheme.checkout : AppTheme.vacant;
    return NeuCard(
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text('#${o.orderNumber}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: AppTheme.heading)),
              const SizedBox(width: 8),
              BarChip(o.label),
              const Spacer(),
              Text(formatPrice(o.subtotal), style: const TextStyle(fontWeight: FontWeight.w800)),
              if (canTake)
                PopupMenuButton<String>(
                  onSelected: (v) async {
                    if (v == 'add') onAdd();
                    if (v == 'room') onToRoom();
                    if (v == 'cancel' && await barConfirm(context, title: 'Cancel order #${o.orderNumber}?', message: 'Stock is returned and the order is closed.', confirmLabel: 'Cancel order')) {
                      onAct(() => vm.cancelOrder(o.id), 'Order cancelled.');
                    }
                  },
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: 'add', child: Text('Add items')),
                    PopupMenuItem(value: 'room', child: Text('Add to room bill')),
                    PopupMenuItem(value: 'cancel', child: Text('Cancel order')),
                  ],
                ),
            ],
          ),
          if ((o.guestName ?? '').isNotEmpty || (o.guestPhone ?? '').isNotEmpty)
            Text([o.guestName, o.guestPhone].where((e) => (e ?? '').isNotEmpty).join(' · '), style: const TextStyle(color: AppTheme.muted, fontSize: 12.5)),
          const SizedBox(height: 4),
          BarChip(o.undelivered > 0 ? '${o.undelivered} to deliver' : 'All delivered', color: chipColor),
          const Divider(height: 16),
          Expanded(
            child: ListView(
              children: [
                for (final i in o.items)
                  _Line(
                    text: '${i.name} · ${i.size} × ${i.quantity}',
                    amount: i.lineTotal,
                    done: i.delivered,
                    onDeliver: canTake && !i.delivered ? () => onAct(() => vm.deliverItem(o.id, i.id), 'Delivered.') : null,
                    onRemove: canTake
                        ? () async {
                            if (await barConfirm(context, title: 'Remove ${i.name}?', message: 'Removes the item and returns its stock.', confirmLabel: 'Remove')) {
                              onAct(() => vm.cancelItem(o.id, i.id), 'Removed.');
                            }
                          }
                        : null,
                  ),
                for (final f in o.foodItems)
                  _Line(
                    text: '${f.name}${f.portion == null ? '' : ' · ${f.portion}'} × ${f.quantity}  (${f.kitchenStatus.toLowerCase()})',
                    amount: f.lineTotal,
                    done: f.delivered,
                    onDeliver: canTake && f.ready && !f.delivered ? () => onAct(() => vm.deliverFoodItem(f.foodOrderId, f.id), 'Delivered.') : null,
                  ),
              ],
            ),
          ),
          const SizedBox(height: AppTheme.s8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (canTake && o.undelivered > 0)
                NeuButton(
                  minHeight: 38,
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  onPressed: busy ? null : () => onAct(() => vm.deliverOrder(o.id), 'Delivered.'),
                  child: const Text('Deliver all'),
                ),
              NeuButton(
                primary: true,
                minHeight: 38,
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                onPressed: busy || o.undelivered > 0 ? null : () => onAct(() => vm.readyToBill(o.id), 'Moved to Ready to bill.'),
                child: const Text('Ready to bill'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Line extends StatelessWidget {
  final String text;
  final double amount;
  final bool done;
  final VoidCallback? onDeliver;
  final VoidCallback? onRemove;

  const _Line({required this.text, required this.amount, required this.done, this.onDeliver, this.onRemove});

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 2),
    child: Row(
      children: [
        Icon(done ? Icons.check_circle_rounded : Icons.radio_button_unchecked_rounded, size: 18, color: done ? AppTheme.vacant : AppTheme.muted),
        const SizedBox(width: 6),
        Expanded(child: Text(text, style: const TextStyle(fontSize: 13))),
        Text(formatPrice(amount), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
        if (onDeliver != null) _LineAction(icon: Icons.room_service_rounded, tooltip: 'Mark delivered', color: AppTheme.accent, onTap: onDeliver!),
        if (onRemove != null) _LineAction(icon: Icons.close_rounded, tooltip: 'Remove item', color: AppTheme.danger, onTap: onRemove!),
      ],
    ),
  );
}

/// A small tinted round action on an order line.
class _LineAction extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final Color color;
  final VoidCallback onTap;

  const _LineAction({required this.icon, required this.tooltip, required this.color, required this.onTap});

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(left: 6),
    child: Tooltip(
      message: tooltip,
      child: Material(
        color: color.withValues(alpha: 0.1),
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: SizedBox(width: 34, height: 34, child: Icon(icon, size: 18, color: color)),
        ),
      ),
    ),
  );
}
