import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/report.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'report_widgets.dart';

/// Food orders register — mirrors the web's Reports > Food orders tab.
class FoodOrdersReportPanel extends ConsumerWidget {
  const FoodOrdersReportPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(reportsViewModelProvider).foodOrders;

    return ListView(
      padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s4, AppTheme.s16, AppTheme.s32),
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        switch (async) {
          null || AsyncLoading() => const ReportLoading(),
          AsyncError(:final error) => ReportError(message: error.toString()),
          AsyncData(:final value) => _Loaded(report: value),
          _ => const SizedBox.shrink(),
        },
      ],
    );
  }
}

class _Loaded extends StatelessWidget {
  final FoodOrdersReport report;

  const _Loaded({required this.report});

  @override
  Widget build(BuildContext context) {
    final s = report.summary;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        StatGrid(
          items: [
            StatItem(label: 'Orders', value: '${s.totalOrders}'),
            StatItem(label: 'Delivered', value: '${s.deliveredCount}'),
            StatItem(label: 'Cancelled', value: '${s.cancelledCount}'),
            StatItem(
              label: 'Billed',
              value: formatPrice(s.billedValue),
              accent: true,
            ),
          ],
        ),
        const SizedBox(height: AppTheme.s16),
        Text('Food orders', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: AppTheme.s8),
        if (report.orders.isEmpty)
          const NeuNotice(
            icon: Icons.room_service_rounded,
            message: 'No food orders in this period.',
          )
        else
          ReportDataTable(
            columns: const [
              ReportTableColumn('Order', width: 66),
              ReportTableColumn('Placed', width: 90),
              ReportTableColumn('Source', width: 90),
              ReportTableColumn('Guest', width: 110),
              ReportTableColumn('Items', width: 50, align: TextAlign.right),
              ReportTableColumn('Status', width: 90),
              ReportTableColumn('Bill no.', width: 80),
              ReportTableColumn('Amount', width: 84, align: TextAlign.right),
            ],
            rows: [for (final o in report.orders) _orderRow(o)],
            totals: [
              'Total', '', '', '', '${s.totalOrders}', '', '',
              formatPrice(report.orders.fold<num>(0, (sum, o) => sum + o.subtotal)),
            ],
          ),
      ],
    );
  }

  List<String> _orderRow(ReportFoodOrderRow o) => [
    '#${o.orderNumber}',
    formatDateTime(o.placedAt),
    '${kOrderSourceLabel[o.source] ?? o.source}${_place(o)}',
    o.guestName ?? '—',
    '${o.itemCount}',
    kOrderStatusLabel[o.status] ?? o.status,
    o.invoiceNumber ?? '—',
    formatPrice(o.subtotal),
  ];

  String _place(ReportFoodOrderRow o) {
    final place = o.roomNumber ?? o.tableLabel;
    return place == null ? '' : ' · $place';
  }
}
