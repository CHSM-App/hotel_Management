import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/income.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'report_widgets.dart';

/// Reports > Other Income — mirrors IncomeReportPanel.jsx's read-only view
/// over the full income history. There is no separate Income feature
/// elsewhere in this app yet (unlike Expenses/Assets), so this tab is also
/// the first place income entries show up on the Flutter side — read-only,
/// same as the web report it mirrors (opened with `onClose={null}`).
///
/// Scoped down from the web version: no trend chart or donut/rank
/// breakdowns. PDF/Excel export is IncomeReportPdf/IncomeReportExcel
/// (income_report_pdf.dart/income_report_excel.dart), wired up in
/// reports_screen.dart.
class IncomeReportTab extends ConsumerWidget {
  const IncomeReportTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(reportsViewModelProvider).incomeReport;

    return ListView(
      padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s4, AppTheme.s16, AppTheme.s32),
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        switch (async) {
          null || AsyncLoading() => const ReportLoading(),
          AsyncError(:final error) => ReportError(message: error.toString()),
          AsyncData(:final value) => _Loaded(income: value),
          _ => const SizedBox.shrink(),
        },
      ],
    );
  }
}

class _Loaded extends StatelessWidget {
  final List<IncomeEntry> income;

  const _Loaded({required this.income});

  @override
  Widget build(BuildContext context) {
    final total = income.fold<num>(0, (sum, e) => sum + e.amount);
    final received = income.fold<num>(0, (sum, e) => sum + (e.amountReceived ?? 0));
    final byCategory = <String, num>{};
    for (final e in income) {
      byCategory[e.categoryName] = (byCategory[e.categoryName] ?? 0) + e.amount;
    }
    final topCategory = byCategory.entries.isEmpty
        ? null
        : (byCategory.entries.toList()..sort((a, b) => b.value.compareTo(a.value))).first;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        StatGrid(
          items: [
            StatItem(label: 'Total income', value: formatPrice(total), accent: true),
            StatItem(label: 'Received so far', value: formatPrice(received)),
            StatItem(label: 'Outstanding', value: formatPrice(total - received)),
            StatItem(label: 'Top category', value: topCategory?.key ?? '—'),
          ],
        ),
        const SizedBox(height: AppTheme.s16),
        Text('All income', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: AppTheme.s8),
        if (income.isEmpty)
          const NeuNotice(icon: Icons.savings_outlined, message: 'No income logged yet.')
        else
          ReportDataTable(
            columns: const [
              ReportTableColumn('Date', width: 90),
              ReportTableColumn('Title', width: 140),
              ReportTableColumn('Category', width: 110),
              ReportTableColumn('Payer', width: 110),
              ReportTableColumn('Amount', width: 90, align: TextAlign.right),
              ReportTableColumn('Received', width: 90, align: TextAlign.right),
              ReportTableColumn('Status', width: 90),
            ],
            rows: [
              for (final e in income)
                [
                  formatIsoDate(e.incomeDate),
                  e.title,
                  e.categoryName,
                  e.payerName ?? '—',
                  formatPrice(e.amount),
                  e.amountReceived != null ? formatPrice(e.amountReceived) : '—',
                  kIncomeStatusLabel[e.paymentStatus] ?? 'Received',
                ],
            ],
            totals: ['Total', '', '', '', formatPrice(total), formatPrice(received), ''],
          ),
      ],
    );
  }
}
