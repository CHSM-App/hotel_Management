import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/expense.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'report_widgets.dart';

/// Reports > Expenses — mirrors ExpensesReportPanel.jsx's read-only view over
/// the full expense history (not the shared date range the other tabs use).
///
/// Scoped down from the web version: no month-by-month trend chart or
/// donut/rank breakdowns — the app already has a full Expenses feature
/// elsewhere (screens/expenses/) with its own detail screens; this tab is the
/// report-shaped summary the web's Reports page adds on top, not a second
/// place to manage expenses. PDF/Excel export is ExpenseReportPdf/
/// ExpenseReportExcel (expense_report_pdf.dart/expense_report_excel.dart),
/// wired up in reports_screen.dart.
class ExpensesReportTab extends ConsumerWidget {
  const ExpensesReportTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(reportsViewModelProvider).expensesReport;

    return ListView(
      padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s4, AppTheme.s16, AppTheme.s32),
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        switch (async) {
          null || AsyncLoading() => const ReportLoading(),
          AsyncError(:final error) => ReportError(message: error.toString()),
          AsyncData(:final value) => _Loaded(expenses: value),
          _ => const SizedBox.shrink(),
        },
      ],
    );
  }
}

class _Loaded extends StatelessWidget {
  final List<Expense> expenses;

  const _Loaded({required this.expenses});

  @override
  Widget build(BuildContext context) {
    final total = expenses.fold<num>(0, (sum, e) => sum + e.amount);
    final paid = expenses.fold<num>(0, (sum, e) => sum + (e.amountPaid ?? 0));
    final byCategory = <String, num>{};
    for (final e in expenses) {
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
            StatItem(label: 'Total spend', value: formatPrice(total), accent: true),
            StatItem(label: 'Paid so far', value: formatPrice(paid)),
            StatItem(label: 'Outstanding', value: formatPrice(total - paid)),
            StatItem(label: 'Top category', value: topCategory?.key ?? '—'),
          ],
        ),
        const SizedBox(height: AppTheme.s16),
        Text('All expenses', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: AppTheme.s8),
        if (expenses.isEmpty)
          const NeuNotice(icon: Icons.receipt_long_rounded, message: 'No expenses logged yet.')
        else
          ReportDataTable(
            columns: const [
              ReportTableColumn('Date', width: 90),
              ReportTableColumn('Title', width: 140),
              ReportTableColumn('Category', width: 110),
              ReportTableColumn('Vendor', width: 110),
              ReportTableColumn('Amount', width: 90, align: TextAlign.right),
              ReportTableColumn('Paid', width: 90, align: TextAlign.right),
              ReportTableColumn('Status', width: 90),
            ],
            rows: [
              for (final e in expenses)
                [
                  formatIsoDate(e.expenseDate),
                  e.title,
                  e.categoryName,
                  e.vendorName ?? '—',
                  formatPrice(e.amount),
                  e.amountPaid != null ? formatPrice(e.amountPaid) : '—',
                  kPaymentStatusLabel[e.paymentStatus] ?? 'Paid',
                ],
            ],
            totals: ['Total', '', '', '', formatPrice(total), formatPrice(paid), ''],
          ),
      ],
    );
  }
}
