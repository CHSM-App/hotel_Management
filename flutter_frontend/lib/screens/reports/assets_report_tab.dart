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
/// asset register and its work orders, filtered to [fromDate]/[toDate] —
/// held by [ReportsScreen] and shown in the same header spot as the
/// server-ranged tabs' picker, just filtering the already-loaded lists
/// instead of triggering a refetch.
///
/// Scoped down from the web version: no purchase-value-by-category donut — the app
/// already has a full Asset inventory feature elsewhere (screens/assets/)
/// with its own detail screens; this tab is the report-shaped summary the
/// web's Reports page adds on top. PDF/Excel export is
/// AssetReportPdf/AssetReportExcel (asset_report_pdf.dart/
/// asset_report_excel.dart), wired up in reports_screen.dart.
class AssetsReportTab extends ConsumerWidget {
  final String fromDate;
  final String toDate;

  const AssetsReportTab({super.key, required this.fromDate, required this.toDate});

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
          AsyncData(:final value) => _Loaded(
            data: AssetsReportData(
              assets: [
                for (final a in value.assets)
                  if (_inRange(a.purchaseDate)) a,
              ],
              workOrders: [
                for (final wo in value.workOrders)
                  if (_inRange(wo.openedAt.length >= 10 ? wo.openedAt.substring(0, 10) : wo.openedAt)) wo,
              ],
            ),
          ),
          _ => const SizedBox.shrink(),
        },
      ],
    );
  }

  bool _inRange(String date) {
    if (date.isEmpty) return false;
    return date.compareTo(fromDate) >= 0 && date.compareTo(toDate) <= 0;
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

    final byStatus = <String, int>{'IN_USE': 0, 'UNDER_REPAIR': 0, 'RETIRED': 0};
    for (final a in data.assets) {
      byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
    }
    final statusRows = [
      for (final entry in byStatus.entries) (kAssetStatusLabel[entry.key] ?? entry.key, entry.value),
    ];

    final byCategory = <String, num>{};
    for (final a in data.assets) {
      byCategory[a.categoryName] = (byCategory[a.categoryName] ?? 0) + (a.purchaseCost ?? 0);
    }
    final categoryEntries = byCategory.entries.toList()..sort((a, b) => b.value.compareTo(a.value));

    final byVendor = <String, (num amount, int count)>{};
    for (final a in data.assets) {
      final vendor = a.vendorName;
      if (vendor == null || (a.purchaseCost ?? 0) == 0) continue;
      final entry = byVendor[vendor] ?? (0, 0);
      byVendor[vendor] = (entry.$1 + (a.purchaseCost ?? 0), entry.$2 + 1);
    }
    for (final wo in data.workOrders) {
      final vendor = wo.vendorName;
      final cost = _repairCost(wo);
      if (vendor == null || cost == 0) continue;
      final entry = byVendor[vendor] ?? (0, 0);
      byVendor[vendor] = (entry.$1 + cost, entry.$2 + 1);
    }
    final vendorEntries = byVendor.entries.toList()..sort((a, b) => b.value.$1.compareTo(a.value.$1));

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
        if (data.assets.isNotEmpty) ...[
          const SizedBox(height: AppTheme.s16),
          ReportBarList(
            title: 'By status',
            rows: statusRows,
            formatValue: (v) => '${v.round()} asset${v.round() == 1 ? '' : 's'}',
          ),
        ],
        if (categoryEntries.isNotEmpty) ...[
          const SizedBox(height: AppTheme.s16),
          ReportBarList(
            title: 'Top categories',
            rows: [for (final c in categoryEntries.take(8)) (c.key, c.value)],
            formatValue: formatPrice,
          ),
        ],
        if (vendorEntries.isNotEmpty) ...[
          const SizedBox(height: AppTheme.s16),
          ReportRankList(
            title: 'Top vendors',
            rows: [
              for (final v in vendorEntries.take(8))
                (v.key, '${v.value.$2} entr${v.value.$2 == 1 ? 'y' : 'ies'}', formatPrice(v.value.$1)),
            ],
          ),
        ],
        const SizedBox(height: AppTheme.s16),
        CollapsibleRegister(
          title: 'Asset register',
          child: data.assets.isEmpty
              ? const NeuNotice(icon: Icons.inventory_2_outlined, message: 'No assets on the register yet.')
              : ReportDataTable(
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
        ),
        const SizedBox(height: AppTheme.s16),
        CollapsibleRegister(
          title: 'Work orders',
          child: data.workOrders.isEmpty
              ? const NeuNotice(icon: Icons.build_outlined, message: 'No work orders logged yet.')
              : ReportDataTable(
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
        ),
      ],
    );
  }
}
