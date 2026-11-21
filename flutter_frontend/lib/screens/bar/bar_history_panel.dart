import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/compact_date_picker.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'bar_bill_screen.dart';
import 'bar_common.dart';

/// Issued bills (`bills: true`) or every billed / cancelled order, over a
/// date range — the bar's two look-back lists share one screen.
class BarHistoryPanel extends ConsumerStatefulWidget {
  final bool bills;

  const BarHistoryPanel({super.key, required this.bills});

  @override
  ConsumerState<BarHistoryPanel> createState() => _BarHistoryPanelState();
}

class _BarHistoryPanelState extends ConsumerState<BarHistoryPanel> {
  late DateTimeRange _range = () {
    final now = DateUtils.dateOnly(DateTime.now());
    return DateTimeRange(start: now, end: now);
  }();

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() {
    final vm = ref.read(barViewModelProvider.notifier);
    final f = barIso(_range.start), t = barIso(_range.end);
    return widget.bills ? vm.loadBills(f, t) : vm.loadHistory(f, t);
  }

  Future<void> _pick() async {
    final now = DateTime.now();
    final r = await showAppDateRangePicker(
      context: context,
      initialDateRange: _range,
      firstDate: DateTime(now.year - 3),
      lastDate: now,
    );
    if (r == null) return;
    setState(() => _range = r);
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final bar = ref.watch(barViewModelProvider);
    final rows = widget.bills ? bar.bills.length : bar.history.length;
    final label = barIso(_range.start) == barIso(_range.end) ? formatIsoDate(barIso(_range.start)) : '${formatIsoDate(barIso(_range.start))} – ${formatIsoDate(barIso(_range.end))}';
    return Column(
      children: [
        Padding(
          padding: EdgeInsets.fromLTRB(AppTheme.gutter(context), AppTheme.s8, AppTheme.gutter(context), 0),
          child: Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(onPressed: _pick, icon: const Icon(Icons.date_range_rounded, size: 18), label: Text(label)),
          ),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _load,
            child: bar.isLoading && rows == 0
                ? const Center(child: CircularProgressIndicator())
                : rows == 0
                ? ListView(children: [NeuNotice(icon: Icons.history_rounded, message: bar.error ?? (widget.bills ? 'No bills in this period.' : 'No orders in this period.'))])
                : ListView(
                    padding: EdgeInsets.all(AppTheme.gutter(context)),
                    children: widget.bills
                        ? [
                            for (final b in bar.bills)
                              NeuCard(
                                margin: const EdgeInsets.only(bottom: AppTheme.s8),
                                onTap: () async {
                                  final bill = await ref.read(barViewModelProvider.notifier).loadBill(b.id);
                                  if (bill != null && context.mounted) {
                                    Navigator.push(context, MaterialPageRoute(builder: (_) => BarBillScreen(bill: bill)));
                                  }
                                },
                                child: Row(
                                  children: [
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text('Bill ${b.billNumber}', style: const TextStyle(fontWeight: FontWeight.w800, color: AppTheme.heading)),
                                          Text('${formatIsoDate((b.billDate ?? '').split('T').first)}${(b.customerName ?? '').isEmpty ? '' : ' · ${b.customerName}'}', style: const TextStyle(color: AppTheme.muted, fontSize: 12.5)),
                                        ],
                                      ),
                                    ),
                                    Text(formatPrice(b.total), style: const TextStyle(fontWeight: FontWeight.w800)),
                                  ],
                                ),
                              ),
                          ]
                        : [
                            for (final o in bar.history)
                              NeuCard(
                                margin: const EdgeInsets.only(bottom: AppTheme.s8),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        Text('#${o.orderNumber}', style: const TextStyle(fontWeight: FontWeight.w900)),
                                        const SizedBox(width: 8),
                                        BarChip(o.label),
                                        const SizedBox(width: 6),
                                        BarChip(
                                          o.status == 'CANCELLED' ? 'Cancelled' : o.roomInvoiceNumber != null ? 'On room bill · ${o.roomInvoiceNumber}' : 'Bill ${o.billNumber ?? ''}',
                                          color: o.status == 'CANCELLED' ? AppTheme.danger : AppTheme.vacant,
                                        ),
                                        const Spacer(),
                                        Text(formatPrice(o.subtotal), style: const TextStyle(fontWeight: FontWeight.w800)),
                                      ],
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      [...o.items.map((i) => '${i.name} ${i.size} × ${i.quantity}'), ...o.foodItems.map((f) => '${f.name} × ${f.quantity}')].join(', '),
                                      style: const TextStyle(color: AppTheme.muted, fontSize: 12.5),
                                    ),
                                  ],
                                ),
                              ),
                          ],
                  ),
          ),
        ),
      ],
    );
  }
}
