import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/laundry.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/h_scroll_table.dart';
import '../../widgets/neu.dart';
import '../housekeeping/housekeeping_parts.dart' show FilterOption, FilterDropdownButton, HkSearchBar, HkViewToggle, StatusPill, CompactActionButton;
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
          // In table view the scroll is the rows', a level below the
          // table's horizontal scroller.
          notificationPredicate: (n) => n.metrics.axis == Axis.vertical,
          onRefresh: () => ref.read(laundryViewModelProvider.notifier).loadOrders(),
          color: AppTheme.accent,
          child: TablePageBody(
            table: _view == 'table',
            padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s12, AppTheme.s16, 88),
            children: [
              if (state.error != null) ...[
                ErrorBanner(state.error!),
                const SizedBox(height: AppTheme.s12),
              ],
              HkSearchBar(
                controller: _search,
                onChanged: (_) => setState(() {}),
                hint: 'Find by tag or name',
                filter: FilterDropdownButton(compact: true, options: filters, selected: _filter, onSelect: (v) => setState(() => _filter = v)),
                viewToggle: HkViewToggle(view: _view, onSelect: (v) => setState(() => _view = v)),
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

/// What an order sorts on for each sortable column — mirrors guestSortRow on
/// the web, which sorts Received/Delivered on the timestamp rather than the
/// formatted date+time text the cell actually shows. Null marks a column
/// that isn't sortable (Items is free text, Action is buttons).
int? _compareOrders(LaundryOrder a, LaundryOrder b, int col) {
  switch (col) {
    case 0:
      return a.tagNumber.compareTo(b.tagNumber);
    case 1:
      return (a.guestName.isEmpty ? 'Walk-in' : a.guestName).compareTo(b.guestName.isEmpty ? 'Walk-in' : b.guestName);
    case 3:
      return a.pieces.compareTo(b.pieces);
    case 4:
      return a.total.compareTo(b.total);
    case 5:
      return (DateTime.tryParse(a.receivedAt) ?? DateTime(0)).compareTo(DateTime.tryParse(b.receivedAt) ?? DateTime(0));
    case 6:
      return a.status.compareTo(b.status);
    default:
      return null;
  }
}

/// Every order as a classic spreadsheet — one fixed-width column per field,
/// scrolling sideways rather than cramming onto a phone-width screen. Same
/// construction as the linen history table (linen_tab.dart's _HistoryTable)
/// and the expense register's own table view. A heading sorts by its
/// column; tapping it again turns it round — mirrors SheetTable on the web.
class _OrderTable extends StatefulWidget {
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
  State<_OrderTable> createState() => _OrderTableState();
}

class _OrderTableState extends State<_OrderTable> {
  int? _sortCol;
  int _sortDir = 1;

  void _toggleSort(int col) => setState(() {
    if (_sortCol == col) {
      _sortDir = -_sortDir;
    } else {
      _sortCol = col;
      _sortDir = 1;
    }
  });

  @override
  Widget build(BuildContext context) {
    final width =
        _OrderTable._tagW +
        _OrderTable._guestW +
        _OrderTable._itemsW +
        _OrderTable._piecesW +
        _OrderTable._totalW +
        _OrderTable._whenW +
        _OrderTable._statusW +
        _OrderTable._actionsW;

    final orders = [...widget.orders];
    final sortCol = _sortCol;
    if (sortCol != null) {
      orders.sort((a, b) => (_compareOrders(a, b, sortCol) ?? 0) * _sortDir);
    }

    return NeuCard(
      padding: EdgeInsets.zero,
      radius: AppTheme.rMedium,
      shadow: AppTheme.subtle,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        child: HScrollTable(
          rowsScrollbar: true,
          child: SizedBox(
            width: width,
            child: StickyHeaderTable(
              header: Container(
                  decoration: const BoxDecoration(
                    color: AppTheme.sidebarBrandWash,
                    border: Border(bottom: BorderSide(color: AppTheme.sidebarBrandWashEdge, width: 0.8)),
                  ),
                  child: Row(
                    children: [
                      _orderHeader(0, 'Tag', _OrderTable._tagW),
                      _orderHeader(1, 'Guest / Room', _OrderTable._guestW, alignStart: true),
                      _orderHeader(2, 'Items', _OrderTable._itemsW, alignStart: true, sortable: false),
                      _orderHeader(3, 'Pieces', _OrderTable._piecesW),
                      _orderHeader(4, 'Total', _OrderTable._totalW),
                      _orderHeader(5, 'Received', _OrderTable._whenW),
                      _orderHeader(6, 'Status', _OrderTable._statusW),
                      _orderHeader(7, 'Action', _OrderTable._actionsW, sortable: false),
                    ],
                  ),
                ),
              rows: [
                      for (var i = 0; i < orders.length; i++)
                        _OrderTableRow(
                          order: orders[i],
                          shaded: i.isOdd,
                          busy: widget.busy,
                          onReceive: () => widget.onReceive(orders[i]),
                          onDeliver: () => widget.onDeliver(orders[i]),
                          onCancel: () => widget.onCancel(orders[i]),
                        ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _orderHeader(int col, String label, double width, {bool alignStart = false, bool sortable = true}) {
    if (!sortable) return _OrderHeaderCell(label, width: width, alignStart: alignStart);
    return _SortableOrderHeaderCell(
      label,
      width: width,
      alignStart: alignStart,
      sortDir: _sortCol == col ? _sortDir : null,
      onTap: () => _toggleSort(col),
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
          style: const TextStyle(color: Colors.black, fontSize: 10, fontWeight: FontWeight.w800, letterSpacing: 0.3),
        ),
      ),
    );
  }
}

/// An [_OrderHeaderCell] that sorts its column on tap, with the same
/// ▲/▼/⇅ cue the web's hk-sort button uses.
class _SortableOrderHeaderCell extends StatelessWidget {
  final String label;
  final double width;
  final bool alignStart;
  final int? sortDir;
  final VoidCallback onTap;

  const _SortableOrderHeaderCell(this.label, {required this.width, this.alignStart = false, required this.sortDir, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final icon = sortDir == null ? Icons.unfold_more_rounded : (sortDir == 1 ? Icons.arrow_drop_up_rounded : Icons.arrow_drop_down_rounded);
    return SizedBox(
      width: width,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppTheme.s4, vertical: 6),
          child: Row(
            mainAxisAlignment: alignStart ? MainAxisAlignment.start : MainAxisAlignment.center,
            children: [
              Flexible(
                child: Text(
                  label.toUpperCase(),
                  textAlign: alignStart ? TextAlign.left : TextAlign.center,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: sortDir != null ? AppTheme.accent : Colors.black,
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.3,
                  ),
                ),
              ),
              Icon(icon, size: 14, color: sortDir != null ? AppTheme.accent : AppTheme.sidebarBrandInk),
            ],
          ),
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
