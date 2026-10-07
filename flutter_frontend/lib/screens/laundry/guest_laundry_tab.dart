import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/laundry.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'guest_laundry_form_screen.dart';
import 'guest_laundry_receive_screen.dart';
import 'laundry_parts.dart';

/// Guest laundry — mirrors LaundryPanel.jsx's GuestLaundryTab: a "Show"
/// filter (in wash / received / handed over / all), the order list, and the
/// actions each stage offers.
class GuestLaundryTab extends ConsumerStatefulWidget {
  const GuestLaundryTab({super.key});

  @override
  ConsumerState<GuestLaundryTab> createState() => _GuestLaundryTabState();
}

class _GuestLaundryTabState extends ConsumerState<GuestLaundryTab> {
  String _filter = 'WASH';
  final _search = TextEditingController();

  static const _filters = {'WASH': 'In wash', 'BACK': 'Received', 'DELIVERED': 'Handed over', 'ALL': 'All'};

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      ref.read(laundryViewModelProvider.notifier).loadOrders();
      ref.read(laundryViewModelProvider.notifier).loadGuestLaundryExtras();
    });
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  bool _inFilter(LaundryOrder o, String key) => switch (key) {
    'ALL' => true,
    'WASH' => o.status == 'RECEIVED' || o.status == 'WASHING',
    'BACK' => o.status == 'READY',
    _ => o.status == 'DELIVERED',
  };

  Future<void> _confirmDeliver(LaundryOrder order) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: Text('Hand over tag ${order.tagNumber}?', style: const TextStyle(color: AppTheme.heading)),
        content: Text(
          '${order.guestName}${order.roomNumber != null ? ', room ${order.roomNumber}' : ''}. ${order.pieces} ${order.pieces == 1 ? 'piece' : 'pieces'}. '
          '${formatPrice(order.total)} will be added to Services to bill, so it can go on the room bill or be billed on its own.',
          style: const TextStyle(color: AppTheme.text),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Not yet')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Hand over')),
        ],
      ),
    );
    if (confirmed == true) {
      ref.read(laundryViewModelProvider.notifier).setLaundryStatus(order.id, {'status': 'DELIVERED'});
    }
  }

  Future<void> _confirmCancel(LaundryOrder order) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: Text('Cancel tag ${order.tagNumber}?', style: const TextStyle(color: AppTheme.heading)),
        content: const Text('The clothes are not charged. This cannot be undone.', style: TextStyle(color: AppTheme.text)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Keep order')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Cancel order', style: TextStyle(color: AppTheme.danger))),
        ],
      ),
    );
    if (confirmed == true) {
      ref.read(laundryViewModelProvider.notifier).setLaundryStatus(order.id, {'status': 'CANCELLED'});
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(laundryViewModelProvider);
    final query = _search.text.trim().toLowerCase();
    final shown = state.orders.where((o) {
      if (!_inFilter(o, _filter)) return false;
      if (query.isEmpty) return true;
      return o.tagNumber.toString().contains(query.replaceAll('#', '')) || o.guestName.toLowerCase().contains(query);
    }).toList();

    if (state.ordersLoading && state.orders.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    return RefreshIndicator(
      onRefresh: () => ref.read(laundryViewModelProvider.notifier).loadOrders(),
      color: AppTheme.accent,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s12, AppTheme.s16, AppTheme.s32),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          if (state.error != null) ...[
            ErrorBanner(state.error!),
            const SizedBox(height: AppTheme.s12),
          ],
          Row(
            children: [
              Expanded(
                child: NeuButton(primary: true, onPressed: () => showGuestLaundryFormScreen(context), child: const Text('+ New laundry')),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s12),
          if (state.orders.length > 5) ...[
            NeuField(controller: _search, label: '', hint: 'Find by tag or name', onChanged: (_) => setState(() {})),
            const SizedBox(height: AppTheme.s12),
          ],
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final entry in _filters.entries)
                _FilterPill(
                  label: '${entry.value} (${state.orders.where((o) => _inFilter(o, entry.key)).length})',
                  selected: _filter == entry.key,
                  onTap: () => setState(() => _filter = entry.key),
                ),
            ],
          ),
          const SizedBox(height: AppTheme.s12),
          if (shown.isEmpty)
            NeuNotice(
              icon: Icons.local_laundry_service_outlined,
              message: query.isNotEmpty
                  ? 'No match. Check the tag number or the name.'
                  : switch (_filter) {
                      'WASH' => 'Nothing in the wash. Tap + New laundry when a guest hands in clothes.',
                      'BACK' => 'Nothing waiting to be handed over. Orders move here when you receive them from the wash.',
                      'DELIVERED' => 'Nothing handed over yet. Orders move here when you hand the clothes back.',
                      _ => 'No laundry yet. Tap + New laundry when a guest hands in clothes.',
                    },
            )
          else ...[
            for (final o in shown)
              _OrderCard(
                order: o,
                busy: state.submitting,
                onReceive: () => showGuestLaundryReceiveScreen(context, o),
                onDeliver: () => _confirmDeliver(o),
                onCancel: () => _confirmCancel(o),
              ),
            if (_filter == 'WASH') const Padding(padding: EdgeInsets.only(top: 4), child: Text('Tap Receive when the clothes come back from the wash.', style: TextStyle(color: AppTheme.muted, fontSize: 11.5))),
            if (_filter == 'BACK') const Padding(padding: EdgeInsets.only(top: 4), child: Text('Hand over when the guest collects. It adds the charge to Room billing → Services to bill.', style: TextStyle(color: AppTheme.muted, fontSize: 11.5))),
          ],
        ],
      ),
    );
  }
}

class _FilterPill extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _FilterPill({required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color: selected ? AppTheme.accent : AppTheme.card,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: selected ? AppTheme.accent : AppTheme.border),
        ),
        child: Text(label, style: TextStyle(color: selected ? Colors.white : AppTheme.text, fontSize: 12, fontWeight: FontWeight.w600)),
      ),
    );
  }
}

class _OrderCard extends StatelessWidget {
  final LaundryOrder order;
  final bool busy;
  final VoidCallback onReceive;
  final VoidCallback onDeliver;
  final VoidCallback onCancel;

  const _OrderCard({required this.order, required this.busy, required this.onReceive, required this.onDeliver, required this.onCancel});

  @override
  Widget build(BuildContext context) {
    final statusLabel = kLaundryStatusLabel[order.status] ?? order.status;
    final statusColor = switch (order.status) {
      'DELIVERED' => AppTheme.vacant,
      'READY' => AppTheme.checkedIn,
      'CANCELLED' => AppTheme.muted,
      _ => AppTheme.edit,
    };

    return NeuCard(
      margin: const EdgeInsets.only(bottom: AppTheme.s8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(color: AppTheme.accent.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(999)),
                child: Text('#${order.tagNumber}', style: const TextStyle(color: AppTheme.accent, fontWeight: FontWeight.w800, fontSize: 11)),
              ),
              const SizedBox(width: AppTheme.s8),
              Expanded(
                child: Text(
                  '${order.guestName.isEmpty ? 'Walk-in' : order.guestName}${order.roomNumber != null ? ' · Room ${order.roomNumber}' : ''}',
                  style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 13.5),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                decoration: BoxDecoration(color: statusColor.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
                child: Text(statusLabel, style: TextStyle(color: statusColor, fontSize: 10.5, fontWeight: FontWeight.w700)),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s8),
          Text(
            order.items.map((i) => '${i.name} ×${i.quantity}').join(', '),
            style: const TextStyle(color: AppTheme.text, fontSize: 12.5),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              Text('${order.pieces} ${order.pieces == 1 ? 'piece' : 'pieces'} · ${formatPrice(order.total)}', style: const TextStyle(color: AppTheme.muted, fontSize: 11.5)),
              const Spacer(),
              Text(formatDateTime(order.receivedAt), style: const TextStyle(color: AppTheme.muted, fontSize: 11)),
            ],
          ),
          if (order.isOpen) ...[
            const SizedBox(height: AppTheme.s8),
            Row(
              children: [
                if (order.status == 'READY')
                  NeuButton(onPressed: busy ? null : onDeliver, padding: const EdgeInsets.symmetric(horizontal: AppTheme.s16, vertical: AppTheme.s8), child: const Text('Hand over', style: TextStyle(fontSize: 12.5)))
                else
                  NeuButton(onPressed: busy ? null : onReceive, padding: const EdgeInsets.symmetric(horizontal: AppTheme.s16, vertical: AppTheme.s8), child: const Text('Receive', style: TextStyle(fontSize: 12.5))),
                const SizedBox(width: AppTheme.s8),
                TextButton(onPressed: onCancel, child: const Text('Cancel', style: TextStyle(color: AppTheme.danger, fontSize: 12.5))),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
