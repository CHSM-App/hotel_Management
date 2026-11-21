import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_error_message.dart';
import '../../domain/models/bar.dart';
import '../../presentation/providers/usecase_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../../widgets/pill_tabs.dart';
import '../bar/bar_common.dart';
import '../theme.dart';

/// Loads all three bar reports for a period in one go.
Future<BarReport> loadBarReport(WidgetRef ref, String from, String to) async {
  final uc = ref.read(barUsecaseProvider);
  final sales = await uc.salesReport(from, to);
  final stock = await uc.stockReport(from, to);
  final bills = await uc.bills(from, to);
  return BarReport(sales: sales, stock: stock, bills: bills);
}

/// Bar report: Sales / Stock / Bills for the range chosen above the tabs.
class BarReportPanel extends ConsumerStatefulWidget {
  final String fromDate;
  final String toDate;

  const BarReportPanel({super.key, required this.fromDate, required this.toDate});

  @override
  ConsumerState<BarReportPanel> createState() => _BarReportPanelState();
}

class _BarReportPanelState extends ConsumerState<BarReportPanel> {
  String _view = 'sales';
  BarReport? _data;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant BarReportPanel old) {
    super.didUpdateWidget(old);
    if (old.fromDate != widget.fromDate || old.toDate != widget.toDate) _load();
  }

  Future<void> _load() async {
    if (widget.toDate.compareTo(widget.fromDate) < 0) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final d = await loadBarReport(ref, widget.fromDate, widget.toDate);
      if (mounted) setState(() => _data = d);
    } catch (e) {
      if (mounted) setState(() => _error = apiErrorMessage(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Widget _kpi(String label, String value) => Expanded(
    child: NeuCard(
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(color: AppTheme.muted, fontSize: 12)),
          const SizedBox(height: 2),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: AppTheme.heading)),
        ],
      ),
    ),
  );

  Widget _sales(BarSales s) => Column(
    children: [
      Row(children: [_kpi('Total sales', formatPrice(s.total)), const SizedBox(width: 8), _kpi('Bills', '${s.bills}')]),
      const SizedBox(height: 8),
      Row(children: [_kpi('Drinks', formatPrice(s.drinks)), const SizedBox(width: 8), _kpi('Food', formatPrice(s.food))]),
      const SizedBox(height: 8),
      Row(children: [_kpi('Drinks tax', formatPrice(s.tax)), const SizedBox(width: 8), _kpi('On room bills', formatPrice(s.roomTotal))]),
      const SizedBox(height: AppTheme.s12),
      if (s.byPayment.isNotEmpty)
        BarSection(title: 'Payments', child: Column(children: [for (final e in s.byPayment.entries) _row(e.key, formatPrice(e.value))])),
      if (s.byCategory.isNotEmpty) ...[
        const SizedBox(height: AppTheme.s8),
        BarSection(title: 'By category', child: Column(children: [for (final c in s.byCategory) _row('${c.category}${c.ml > 0 ? ' · ${c.ml} ml' : ''}', formatPrice(c.amount))])),
      ],
      if (s.byItem.isNotEmpty) ...[
        const SizedBox(height: AppTheme.s8),
        BarSection(title: 'Top items', child: Column(children: [for (final i in s.byItem.take(15)) _row('${i.name}${i.size.isEmpty ? '' : ' · ${i.size}'} × ${i.quantity}', formatPrice(i.amount))])),
      ],
      if (s.byDay.isNotEmpty) ...[
        const SizedBox(height: AppTheme.s8),
        BarSection(title: 'By day', child: Column(children: [for (final d in s.byDay) _row('${formatIsoDate(d.date)} · ${d.bills} bill${d.bills == 1 ? '' : 's'}', formatPrice(d.total))])),
      ],
    ],
  );

  Widget _row(String l, String r) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 3),
    child: Row(children: [Expanded(child: Text(l)), Text(r, style: const TextStyle(fontWeight: FontWeight.w700))]),
  );

  Widget _stock(List<BarStockRow> rows) => Column(
    children: [
      for (final p in rows)
        NeuCard(
          margin: const EdgeInsets.only(bottom: AppTheme.s8),
          padding: const EdgeInsets.all(AppTheme.s12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [Expanded(child: Text(p.name, style: const TextStyle(fontWeight: FontWeight.w800))), if (p.isLow) const BarChip('Low', color: AppTheme.danger)]),
              const SizedBox(height: 4),
              Text('Opening ${p.opening.text} · In ${p.purchased.text} · Sold ${p.sold.text}', style: const TextStyle(fontSize: 12.5, color: AppTheme.text)),
              Text('Wastage ${p.wastage.text} · Closing ${p.closing.text} · Now ${p.current.text}', style: const TextStyle(fontSize: 12.5, color: AppTheme.text)),
            ],
          ),
        ),
    ],
  );

  Widget _bills(List<BarBillRow> rows) => Column(
    children: [
      for (final b in rows)
        NeuCard(
          margin: const EdgeInsets.only(bottom: AppTheme.s8),
          padding: const EdgeInsets.all(AppTheme.s12),
          child: Row(
            children: [
              Expanded(child: Text('Bill ${b.billNumber} · ${formatIsoDate((b.billDate ?? '').split('T').first)}${(b.customerName ?? '').isEmpty ? '' : ' · ${b.customerName}'}')),
              Text(formatPrice(b.total), style: const TextStyle(fontWeight: FontWeight.w800)),
            ],
          ),
        ),
      if (rows.isEmpty) const NeuNotice(icon: Icons.receipt_long_rounded, message: 'No bills in this period.'),
    ],
  );

  @override
  Widget build(BuildContext context) {
    final d = _data;
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: EdgeInsets.fromLTRB(AppTheme.gutter(context), 0, AppTheme.gutter(context), AppTheme.s24),
      children: [
        PillTabs(
          selected: _view,
          onSelect: (k) => setState(() => _view = k),
          tabs: const [
            PillTab('sales', 'Sales', Icons.bar_chart_rounded),
            PillTab('stock', 'Stock', Icons.inventory_2_rounded),
            PillTab('bills', 'Bills', Icons.receipt_long_rounded),
          ],
        ),
        const SizedBox(height: AppTheme.s12),
        if (_loading && d == null)
          const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()))
        else if (_error != null && d == null)
          NeuNotice(icon: Icons.error_outline_rounded, message: _error!)
        else if (d != null)
          switch (_view) {
            'stock' => _stock(d.stock),
            'bills' => _bills(d.bills),
            _ => _sales(d.sales),
          },
      ],
    );
  }
}
