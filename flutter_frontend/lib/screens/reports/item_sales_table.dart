import 'package:flutter/material.dart';

import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import 'report_widgets.dart';

/// One row of an item-wise sales table.
typedef ItemSale = ({String name, String variant, int quantity, double amount});

/// Item-wise sales for a period: item, size/portion, quantity sold, sale
/// amount and share of the total, footed with totals. Shared by the bar and
/// restaurant reports.
class ItemSalesTable extends StatelessWidget {
  final String variantLabel;
  final List<ItemSale> rows;
  final String emptyMessage;

  const ItemSalesTable({super.key, required this.variantLabel, required this.rows, this.emptyMessage = 'No sales in this period.'});

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) return NeuNotice(icon: Icons.receipt_long_rounded, message: emptyMessage);
    final qty = rows.fold<int>(0, (s, r) => s + r.quantity);
    final total = rows.fold<double>(0, (s, r) => s + r.amount);
    return ReportDataTable(
      columns: [
        const ReportTableColumn('#', width: 36),
        const ReportTableColumn('Item', width: 170),
        ReportTableColumn(variantLabel, width: 90),
        const ReportTableColumn('Qty sold', width: 70, align: TextAlign.right),
        const ReportTableColumn('Sale amount', width: 100, align: TextAlign.right),
        const ReportTableColumn('Share', width: 60, align: TextAlign.right),
      ],
      rows: [
        for (var i = 0; i < rows.length; i++)
          [
            '${i + 1}',
            rows[i].name,
            rows[i].variant.isEmpty ? '-' : rows[i].variant,
            '${rows[i].quantity}',
            formatPrice(rows[i].amount),
            total > 0 ? '${(rows[i].amount * 100 / total).toStringAsFixed(1)}%' : '-',
          ],
      ],
      totals: ['', 'Total', '', '$qty', formatPrice(total), total > 0 ? '100%' : ''],
    );
  }
}
