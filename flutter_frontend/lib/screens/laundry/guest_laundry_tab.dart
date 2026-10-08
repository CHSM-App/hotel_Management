import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/laundry.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../housekeeping/housekeeping_parts.dart' show FilterOption, FilterDropdownButton, HkViewToggle, StatusPill, CompactActionButton;
import '../theme.dart';
import 'guest_laundry_form_screen.dart';
import 'guest_laundry_receive_screen.dart';
import 'laundry_parts.dart';

/// Guest laundry — mirrors LaundryPanel.jsx's GuestLaundryTab: a "Show"
/// filter (in wash / received / handed over / all), the order list, and the
/// actions each stage offers. New laundry opens from a floating "+", and the
/// list switches between cards and a compact spreadsheet, same affordances
/// Housekeeping/Expenses/Assets already give their own registers.
class GuestLaundryTab extends ConsumerStatefulWidget {
  const GuestLaundryTab({super.key});

  @override
  ConsumerState<GuestLaundryTab> createState() => _GuestLaundryTabState();
}

class _GuestLaundryTabState extends ConsumerState<GuestLaundryTab> {
  String _filter = 'WASH';
  String _view = 'table';
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

    final filters = [
      for (final entry in _filters.entries) FilterOption(entry.key, entry.value, state.orders.where((o) => _inFilter(o, entry.key)).length),
    ];

    return Stack(
      fit: StackFit.expand,
      children: [
        RefreshIndicator(
          onRefresh: () => ref.read(laundryViewModelProvider.notifier).loadOrders(),
          color: AppTheme.accent,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s12, AppTheme.s16, 88),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              if (state.error != null) ...[
                ErrorBanner(state.error!),
                const SizedBox(height: AppTheme.s12),
              ],
              if (state.orders.length > 5) ...[
                NeuField(controller: _search, label: '', hint: 'Find by tag or name', onChanged: (_) => setState(() {})),
                const SizedBox(height: AppTheme.s12),
              ],
              Row(
                children: [
                  FilterDropdownButton(options: filters, selected: _filter, onSelect: (v) => setState(() => _filter = v)),
                  const Spacer(),
                  HkViewToggle(view: _view, onSelect: (v) => setState(() => _view = v)),
                ],
              ),
              const SizedBox(height: AppTheme.s12),
              if (shown.isEmpty)
                NeuNotice(
                  icon: Icons.local_laundry_service_outlined,
                  message: query.isNotEmpty
                      ? 'No match. Check the tag number or the name.'
                      : switch (_filter) {
                          'WASH' => 'Nothing in the wash. Tap + to add one when a guest hands in clothes.',
                          'BACK' => 'Nothing waiting to be handed over. Orders move here when you receive them from the wash.',
                          'DELIVERED' => 'Nothing handed over yet. Orders move here when you hand the clothes back.',
                          _ => 'No laundry yet. Tap + to add one when a guest hands in clothes.',
                        },
                )
              else if (_view == 'table')
                _OrderTable(
                  orders: shown,
                  busy: state.submitting,
                  onReceive: (o) => showGuestLaundryReceiveScreen(context, o),
                  onDeliver: _confirmDeliver,
                  onCancel: _confirmCancel,
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
        ),
        Positioned(
          right: AppTheme.s16,
          bottom: AppTheme.s16,
          child: FloatingActionButton(
            backgroundColor: AppTheme.accent,
            foregroundColor: Colors.white,
            elevation: 2,
            onPressed: () => showGuestLaundryFormScreen(context),
            child: const Icon(Icons.add_rounded),
          ),
        ),
      ],
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
      padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s12 - 2, AppTheme.s12, AppTheme.s12 - 2),
      margin: const EdgeInsets.only(bottom: AppTheme.s8 - 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2.5),
                decoration: BoxDecoration(color: AppTheme.accent.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(999)),
                child: Text('#${order.tagNumber}', style: const TextStyle(color: AppTheme.accent, fontWeight: FontWeight.w800, fontSize: 10.5)),
              ),
              const SizedBox(width: AppTheme.s8 - 2),
              Expanded(
                child: Text(
                  '${order.guestName.isEmpty ? 'Walk-in' : order.guestName}${order.roomNumber != null ? ' · Room ${order.roomNumber}' : ''}',
                  style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 13),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2.5),
                decoration: BoxDecoration(color: statusColor.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
                child: Text(statusLabel, style: TextStyle(color: statusColor, fontSize: 10, fontWeight: FontWeight.w700)),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            order.items.map((i) => '${i.name} ×${i.quantity}').join(', '),
            style: const TextStyle(color: AppTheme.text, fontSize: 12),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 3),
          Row(
            children: [
              Text('${order.pieces} ${order.pieces == 1 ? 'piece' : 'pieces'} · ${formatPrice(order.total)}', style: const TextStyle(color: AppTheme.muted, fontSize: 11)),
              const Spacer(),
              Text(formatDateTime(order.receivedAt), style: const TextStyle(color: AppTheme.muted, fontSize: 10.5)),
            ],
          ),
          if (order.isOpen) ...[
            const SizedBox(height: AppTheme.s8 - 2),
            Row(
              children: [
                if (order.status == 'READY')
                  CompactActionButton(label: 'Hand over', color: AppTheme.vacant, primary: true, onTap: busy ? null : onDeliver)
                else
                  CompactActionButton(label: 'Receive', color: AppTheme.accent, primary: true, onTap: busy ? null : onReceive),
                const SizedBox(width: 6),
                CompactActionButton(label: 'Cancel', color: AppTheme.danger, onTap: busy ? null : onCancel),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// Every order as a classic spreadsheet — one fixed-width column per field,
/// scrolling sideways rather than cramming onto a phone-width screen. Same
/// construction as the linen history table (linen_tab.dart's _HistoryTable)
/// and the expense register's own table view.
class _OrderTable extends StatelessWidget {
  final List<LaundryOrder> orders;
  final bool busy;
  final ValueChanged<LaundryOrder> onReceive;
  final ValueChanged<LaundryOrder> onDeliver;
  final ValueChanged<LaundryOrder> onCancel;

  const _OrderTable({required this.orders, required this.busy, required this.onReceive, required this.onDeliver, required this.onCancel});

  static const _tagW = 52.0;
  static const _guestW = 150.0;
  static const _itemsW = 160.0;
  static const _piecesW = 56.0;
  static const _totalW = 80.0;
  static const _whenW = 110.0;
  static const _statusW = 96.0;
  static const _actionsW = 160.0;

  @override
  Widget build(BuildContext context) {
    final width = _tagW + _guestW + _itemsW + _piecesW + _totalW + _whenW + _statusW + _actionsW;

    return NeuCard(
      padding: EdgeInsets.zero,
      radius: AppTheme.rMedium,
      shadow: AppTheme.subtle,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: SizedBox(
            width: width,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  decoration: const BoxDecoration(
                    color: AppTheme.sidebarBrandWash,
                    border: Border(bottom: BorderSide(color: AppTheme.sidebarBrandWashEdge, width: 0.8)),
                  ),
                  child: const Row(
                    children: [
                      _OrderHeaderCell('Tag', width: _tagW),
                      _OrderHeaderCell('Guest / Room', width: _guestW, alignStart: true),
                      _OrderHeaderCell('Items', width: _itemsW, alignStart: true),
                      _OrderHeaderCell('Pieces', width: _piecesW),
                      _OrderHeaderCell('Total', width: _totalW),
                      _OrderHeaderCell('Received', width: _whenW),
                      _OrderHeaderCell('Status', width: _statusW),
                      _OrderHeaderCell('Action', width: _actionsW),
                    ],
                  ),
                ),
                for (var i = 0; i < orders.length; i++)
                  _OrderTableRow(
                    order: orders[i],
                    shaded: i.isOdd,
                    busy: busy,
                    onReceive: () => onReceive(orders[i]),
                    onDeliver: () => onDeliver(orders[i]),
                    onCancel: () => onCancel(orders[i]),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _OrderHeaderCell extends StatelessWidget {
  final String label;
  final double width;
  final bool alignStart;
  const _OrderHeaderCell(this.label, {required this.width, this.alignStart = false});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 10),
        child: Text(
          label.toUpperCase(),
          textAlign: alignStart ? TextAlign.left : TextAlign.center,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(color: AppTheme.sidebarBrandInk, fontSize: 10, fontWeight: FontWeight.w800, letterSpacing: 0.3),
        ),
      ),
    );
  }
}

class _OrderTableRow extends StatelessWidget {
  final LaundryOrder order;
  final bool shaded;
  final bool busy;
  final VoidCallback onReceive;
  final VoidCallback onDeliver;
  final VoidCallback onCancel;

  const _OrderTableRow({
    required this.order,
    required this.shaded,
    required this.busy,
    required this.onReceive,
    required this.onDeliver,
    required this.onCancel,
  });

  @override
  Widget build(BuildContext context) {
    final statusLabel = kLaundryStatusLabel[order.status] ?? order.status;
    final statusColor = switch (order.status) {
      'DELIVERED' => AppTheme.vacant,
      'READY' => AppTheme.checkedIn,
      'CANCELLED' => AppTheme.muted,
      _ => AppTheme.edit,
    };

    Widget cell(double width, Widget child, {bool alignStart = false}) => SizedBox(
      width: width,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 10),
        child: Align(alignment: alignStart ? Alignment.centerLeft : Alignment.center, child: child),
      ),
    );
    Widget text(String s, {bool alignStart = false, TextStyle? style}) => Text(
      s,
      maxLines: alignStart ? 2 : 1,
      overflow: TextOverflow.ellipsis,
      style: style ?? const TextStyle(color: AppTheme.text, fontSize: 12.5),
    );

    return Container(
      decoration: BoxDecoration(
        color: shaded ? AppTheme.border.withValues(alpha: 0.25) : AppTheme.card,
        border: const Border(bottom: BorderSide(color: AppTheme.border, width: 0.8)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          cell(_OrderTable._tagW, text('#${order.tagNumber}', style: const TextStyle(color: AppTheme.accent, fontWeight: FontWeight.w800, fontSize: 12.5))),
          cell(
            _OrderTable._guestW,
            alignStart: true,
            text(
              '${order.guestName.isEmpty ? 'Walk-in' : order.guestName}${order.roomNumber != null ? ' · Room ${order.roomNumber}' : ''}',
              alignStart: true,
              style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 12.5),
            ),
          ),
          cell(_OrderTable._itemsW, alignStart: true, text(order.items.map((i) => '${i.name} ×${i.quantity}').join(', '), alignStart: true)),
          cell(_OrderTable._piecesW, text('${order.pieces}')),
          cell(_OrderTable._totalW, text(formatPrice(order.total), style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 12.5))),
          cell(_OrderTable._whenW, text(formatDateTime(order.receivedAt), style: const TextStyle(color: AppTheme.muted, fontSize: 11.5))),
          cell(_OrderTable._statusW, StatusPill(label: statusLabel, color: statusColor)),
          cell(
            _OrderTable._actionsW,
            order.isOpen
                ? FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (order.status == 'READY')
                          CompactActionButton(label: 'Hand over', color: AppTheme.vacant, onTap: busy ? null : onDeliver)
                        else
                          CompactActionButton(label: 'Receive', color: AppTheme.accent, onTap: busy ? null : onReceive),
                        const SizedBox(width: 6),
                        CompactActionButton(label: 'Cancel', color: AppTheme.danger, onTap: busy ? null : onCancel),
                      ],
                    ),
                  )
                : const SizedBox.shrink(),
          ),
        ],
      ),
    );
  }
}
