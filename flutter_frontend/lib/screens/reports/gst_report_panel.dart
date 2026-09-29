import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/report.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'report_widgets.dart';

/// The GST filing summary — mirrors the web's Reports > GST summary tab: the
/// footed totals, the split by document type, and every issued bill.
class GstReportPanel extends ConsumerWidget {
  const GstReportPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(reportsViewModelProvider).gst;
    final occupancy = ref.watch(reportsViewModelProvider).occupancy?.valueOrNull;

    return ListView(
      padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s4, AppTheme.s16, AppTheme.s32),
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        switch (async) {
          null || AsyncLoading() => const ReportLoading(),
          AsyncError(:final error) => ReportError(message: error.toString()),
          AsyncData(:final value) => _Loaded(report: value, occupancy: occupancy),
          _ => const SizedBox.shrink(),
        },
      ],
    );
  }
}

class _Loaded extends StatelessWidget {
  final GstSummaryReport report;
  final OccupancyReport? occupancy;

  const _Loaded({required this.report, this.occupancy});

  @override
  Widget build(BuildContext context) {
    final totals = report.totals;
    final byDoc = report.byDocumentType.entries.toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        StatGrid(
          items: [
            StatItem(label: 'Bills issued', value: '${totals.count}'),
            StatItem(label: 'Room charges', value: formatPrice(totals.roomSubtotal)),
            StatItem(label: 'CGST', value: formatPrice(totals.cgstAmount)),
            StatItem(label: 'SGST', value: formatPrice(totals.sgstAmount)),
            StatItem(label: 'Total revenue', value: formatPrice(totals.totalAmount), accent: true),
          ],
        ),
        if (byDoc.isNotEmpty) ...[
          const SizedBox(height: AppTheme.s16),
          Text('By document type', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: AppTheme.s8),
          ReportDataTable(
            columns: const [
              ReportTableColumn('Document', width: 130),
              ReportTableColumn('Bills', width: 60, align: TextAlign.right),
              ReportTableColumn('Room charges', width: 100, align: TextAlign.right),
              ReportTableColumn('CGST', width: 90, align: TextAlign.right),
              ReportTableColumn('SGST', width: 90, align: TextAlign.right),
              ReportTableColumn('Total', width: 100, align: TextAlign.right),
            ],
            rows: [
              for (final entry in byDoc)
                [
                  kDocumentTypeLabel[entry.key] ?? entry.key,
                  '${entry.value.count}',
                  formatPrice(entry.value.roomSubtotal),
                  formatPrice(entry.value.cgstAmount),
                  formatPrice(entry.value.sgstAmount),
                  formatPrice(entry.value.totalAmount),
                ],
            ],
            totals: [
              'Total',
              '${totals.count}',
              formatPrice(totals.roomSubtotal),
              formatPrice(totals.cgstAmount),
              formatPrice(totals.sgstAmount),
              formatPrice(totals.totalAmount),
            ],
          ),
        ],
        const SizedBox(height: AppTheme.s16),
        Text('Bills', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: AppTheme.s8),
        if (report.invoices.isEmpty)
          const NeuNotice(
            icon: Icons.receipt_rounded,
            message: 'No bills issued in this date range.',
          )
        else
          ReportDataTable(
            columns: const [
              ReportTableColumn('Bill no.', width: 90),
              ReportTableColumn('Document', width: 90),
              ReportTableColumn('Guest', width: 130),
              ReportTableColumn('Date', width: 90),
              ReportTableColumn('CGST', width: 80, align: TextAlign.right),
              ReportTableColumn('SGST', width: 80, align: TextAlign.right),
              ReportTableColumn('Total', width: 90, align: TextAlign.right),
            ],
            rows: [
              for (final inv in report.invoices)
                [
                  inv.invoiceNumber ?? '—',
                  kDocumentTypeLabel[inv.documentType] ?? inv.documentType ?? '—',
                  inv.guestName ?? '—',
                  formatIsoDate(inv.createdAt),
                  formatPrice(inv.cgstAmount),
                  formatPrice(inv.sgstAmount),
                  formatPrice(inv.totalAmount),
                ],
            ],
            totals: [
              'Total', '', '', '',
              formatPrice(totals.cgstAmount),
              formatPrice(totals.sgstAmount),
              formatPrice(totals.totalAmount),
            ],
          ),
        if (occupancy != null && occupancy!.totalRooms > 0) ...[
          const SizedBox(height: AppTheme.s16),
          Text('Daily occupancy', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: AppTheme.s8),
          ReportDataTable(
            columns: const [
              ReportTableColumn('Date', width: 110),
              ReportTableColumn('Occupied', width: 90, align: TextAlign.right),
              ReportTableColumn('Occupancy', width: 90, align: TextAlign.right),
            ],
            rows: [
              for (final day in occupancy!.days)
                [
                  formatIsoDate(day.date),
                  '${day.occupiedRooms} / ${day.totalRooms}',
                  '${day.occupancyPercent}%',
                ],
            ],
          ),
        ],
      ],
    );
  }
}
