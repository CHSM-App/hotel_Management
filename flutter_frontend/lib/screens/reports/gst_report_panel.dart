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
  final GstSummaryReport report;

  const _Loaded({required this.report});

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
          NeuCard(
            padding: const EdgeInsets.all(AppTheme.s16),
            child: Column(
              children: [
                for (final entry in byDoc) ...[
                  _DocTypeRow(type: entry.key, totals: entry.value),
                  if (entry.key != byDoc.last.key)
                    const Divider(height: AppTheme.s16, color: AppTheme.border),
                ],
              ],
            ),
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
          for (final inv in report.invoices)
            Padding(
              padding: const EdgeInsets.only(bottom: AppTheme.s12),
              child: _InvoiceCard(invoice: inv),
            ),
      ],
    );
  }
}

class _DocTypeRow extends StatelessWidget {
  final String type;
  final GstDocumentTotals totals;

  const _DocTypeRow({required this.type, required this.totals});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          flex: 2,
          child: Text(
            kDocumentTypeLabel[type] ?? type,
            style: const TextStyle(color: AppTheme.heading, fontSize: 13, fontWeight: FontWeight.w500),
            overflow: TextOverflow.ellipsis,
          ),
        ),
        Expanded(
          child: Text(
            '${totals.count}',
            style: Theme.of(context).textTheme.bodyMedium,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        Expanded(
          flex: 2,
          child: Text(
            formatPrice(totals.totalAmount),
            textAlign: TextAlign.right,
            style: Theme.of(context).textTheme.titleSmall?.copyWith(color: AppTheme.accent),
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}

class _InvoiceCard extends StatelessWidget {
  final GstInvoiceRow invoice;

  const _InvoiceCard({required this.invoice});

  @override
  Widget build(BuildContext context) {
    final inv = invoice;
    return NeuCard(
      padding: const EdgeInsets.all(AppTheme.s16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  inv.invoiceNumber ?? '—',
                  style: Theme.of(context).textTheme.titleSmall,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: AppTheme.s8),
              Text(
                formatPrice(inv.totalAmount),
                style: Theme.of(context).textTheme.titleSmall?.copyWith(color: AppTheme.accent),
              ),
            ],
          ),
          const SizedBox(height: 2),
          Text(
            inv.guestName ?? '—',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppTheme.text),
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: AppTheme.s8),
          Row(
            children: [
              Expanded(
                child: Text(
                  kDocumentTypeLabel[inv.documentType] ?? inv.documentType ?? '—',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w400),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: AppTheme.s8),
              Text(
                formatIsoDate(inv.createdAt),
                style: Theme.of(context).textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w400),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              Flexible(
                child: Text(
                  'CGST ${formatPrice(inv.cgstAmount)}',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w400),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: AppTheme.s12),
              Flexible(
                child: Text(
                  'SGST ${formatPrice(inv.sgstAmount)}',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w400),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
