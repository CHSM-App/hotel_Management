import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/asset.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/reports_viewmodel.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'report_widgets.dart';

/// Reports > Assets — mirrors AssetsReportPanel.jsx's read-only view over the
/// asset register and its work orders.
///
/// Scoped down from the web version: no donut/rank breakdowns, and no
/// PDF/Excel export yet — the app already has a full Asset inventory feature
/// elsewhere (screens/assets/) with its own detail screens; this tab is the
/// report-shaped summary the web's Reports page adds on top.
class AssetsReportTab extends ConsumerWidget {
  const AssetsReportTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(reportsViewModelProvider).assetsReport;

    return ListView(
      padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s4, AppTheme.s16, AppTheme.s32),
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        switch (async) {
          null || AsyncLoading() => const ReportLoading(),
          AsyncError(:final error) => ReportError(message: error.toString()),
          AsyncData(:final value) => _Loaded(data: value),
          _ => const SizedBox.shrink(),
        },
      ],
    );
  }
}

num _repairCost(WorkOrder wo) => (wo.partsCost ?? 0) + (wo.laborCost ?? 0);

bool _expiringSoon(String? dateStr) {
  if (dateStr == null || dateStr.isEmpty) return false;
  final d = DateTime.tryParse(dateStr);
  if (d == null) return false;
  final days = d.difference(DateTime.now()).inDays;
  return days >= 0 && days <= 30;
}

class _Loaded extends StatelessWidget {
  final AssetsReportData data;

  const _Loaded({required this.data});

  @override
  Widget build(BuildContext context) {
    final purchaseValue = data.assets.fold<num>(0, (sum, a) => sum + (a.purchaseCost ?? 0));
    final repairSpend = data.workOrders.fold<num>(0, (sum, wo) => sum + _repairCost(wo));
    final openWorkOrders = data.workOrders.where((wo) => wo.status != 'CLOSED').length;
    final expiringSoon = data.assets
        .where((a) => _expiringSoon(a.warrantyExpiry) || _expiringSoon(a.amcExpiry))
        .length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        StatGrid(
          items: [
            StatItem(label: 'Purchase value', value: formatPrice(purchaseValue), accent: true),
            StatItem(label: 'Repair spend', value: formatPrice(repairSpend)),
            StatItem(label: 'Open work orders', value: '$openWorkOrders'),
            StatItem(label: 'Warranty/AMC expiring', value: '$expiringSoon'),
          ],
        ),
        const SizedBox(height: AppTheme.s16),
        Text('Asset register', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: AppTheme.s8),
        if (data.assets.isEmpty)
          const NeuNotice(icon: Icons.inventory_2_outlined, message: 'No assets on the register yet.')
        else
          ReportDataTable(
            columns: const [
              ReportTableColumn('Asset', width: 140),
              ReportTableColumn('Category', width: 110),
              ReportTableColumn('Status', width: 90),
              ReportTableColumn('Purchased', width: 90),
              ReportTableColumn('Cost', width: 90, align: TextAlign.right),
              ReportTableColumn('Vendor', width: 110),
            ],
            rows: [
              for (final a in data.assets)
                [
                  a.name,
                  a.categoryName,
                  kAssetStatusLabel[a.status] ?? a.status,
                  formatIsoDate(a.purchaseDate),
                  a.purchaseCost != null ? formatPrice(a.purchaseCost) : '—',
                  a.vendorName ?? '—',
                ],
            ],
            totals: ['Total', '', '', '', formatPrice(purchaseValue), ''],
          ),
        const SizedBox(height: AppTheme.s16),
        Text('Work orders', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: AppTheme.s8),
        if (data.workOrders.isEmpty)
          const NeuNotice(icon: Icons.build_outlined, message: 'No work orders logged yet.')
        else
          ReportDataTable(
            columns: const [
              ReportTableColumn('Asset', width: 130),
              ReportTableColumn('Issue', width: 100),
              ReportTableColumn('Status', width: 90),
              ReportTableColumn('Opened', width: 90),
              ReportTableColumn('Vendor', width: 110),
              ReportTableColumn('Cost', width: 90, align: TextAlign.right),
            ],
            rows: [
              for (final wo in data.workOrders)
                [
                  wo.assetName,
                  kIssueTypeLabel[wo.issueType] ?? wo.issueType,
                  kWorkOrderStatusLabel[wo.status] ?? wo.status,
                  formatIsoDate(wo.openedAt),
                  wo.vendorName ?? '—',
                  formatPrice(_repairCost(wo)),
                ],
            ],
            totals: ['Total', '', '', '', '', formatPrice(repairSpend)],
          ),
      ],
    );
  }
}
