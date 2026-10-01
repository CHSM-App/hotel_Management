import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/expense.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'report_widgets.dart';

/// Category donut slice colors, in assignment order — mirrors
/// ExpensesReportPanel.jsx's CATEGORY_COLORS (brand, accent, then four more
/// fixed hues), reusing AppTheme's own tokens where one already fits.
const _kCategoryColors = <Color>[
  AppTheme.accent,
  AppTheme.draft,
  Color(0xFF2FA0A0),
  AppTheme.checkout,
  Color(0xFF7A5FD1),
  Color(0xFF3A8FC7),
];

/// Reports > Expenses — mirrors ExpensesReportPanel.jsx's read-only view over
/// the full expense history, filtered to [fromDate]/[toDate] — held by
/// [ReportsScreen] and shown in the same header spot as the server-ranged
/// tabs' picker, just filtering the already-loaded list instead of
/// triggering a refetch.
///
/// The app already has a full Expenses feature elsewhere (screens/expenses/)
/// with its own detail screens; this tab is the report-shaped summary the
/// web's Reports page adds on top, not a second place to manage expenses.
/// PDF/Excel export is ExpenseReportPdf/ExpenseReportExcel
/// (expense_report_pdf.dart/expense_report_excel.dart), wired up in
/// reports_screen.dart.
class ExpensesReportTab extends ConsumerWidget {
  final String fromDate;
  final String toDate;

  const ExpensesReportTab({super.key, required this.fromDate, required this.toDate});

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
          AsyncData(:final value) => _Loaded(
            expenses: [
              for (final e in value)
                if (e.expenseDate.compareTo(fromDate) >= 0 && e.expenseDate.compareTo(toDate) <= 0) e,
            ],
          ),
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
    final categoryEntries = byCategory.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
    final topCategory = categoryEntries.isEmpty ? null : categoryEntries.first;

    final byVendor = <String, (num amount, int count)>{};
    for (final e in expenses) {
      final vendor = e.vendorName;
      if (vendor == null) continue;
      final entry = byVendor[vendor] ?? (0, 0);
      byVendor[vendor] = (entry.$1 + e.amount, entry.$2 + 1);
    }
    final vendorEntries = byVendor.entries.toList()..sort((a, b) => b.value.$1.compareTo(a.value.$1));

    // Spend by month for the current calendar year — the same "12 points,
    // one per month" shape ReportTrendChart already draws for revenue, so
    // this reads as the same chart language rather than a new one invented
    // for expenses. Mirrors ExpensesReportPanel.jsx's monthlyTrend.
    final year = DateTime.now().year;
    final monthlyTotals = List<num>.filled(12, 0);
    for (final e in expenses) {
      final d = DateTime.tryParse(e.expenseDate);
      if (d != null && d.year == year) monthlyTotals[d.month - 1] += e.amount;
    }
    final monthDates = [for (var m = 1; m <= 12; m++) '$year-${m.toString().padLeft(2, '0')}-01'];

    final donutSlices = [
      for (var i = 0; i < categoryEntries.length && i < 6; i++)
        DonutSlice(
          label: categoryEntries[i].key,
          value: categoryEntries[i].value,
          color: _kCategoryColors[i % _kCategoryColors.length],
        ),
    ];

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
        if (expenses.isNotEmpty) ...[
          const SizedBox(height: AppTheme.s16),
          ReportTrendChart(
            title: 'Spend by month, $year',
            values: monthlyTotals,
            firstLabel: formatShortDate(monthDates.first),
            midLabel: formatShortDate(monthDates[5]),
            lastLabel: formatShortDate(monthDates.last),
            formatValue: formatPrice,
          ),
        ],
        if (donutSlices.isNotEmpty) ...[
          const SizedBox(height: AppTheme.s16),
          ReportDonut(
            title: "Where it's going",
            slices: donutSlices,
            centerLabel: formatPrice(total),
            centerSub: 'Total',
            formatValue: formatPrice,
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
                (v.key, '${v.value.$2} expense${v.value.$2 == 1 ? '' : 's'}', formatPrice(v.value.$1)),
            ],
          ),
        ],
        const SizedBox(height: AppTheme.s16),
        CollapsibleRegister(
          title: 'All expenses',
          child: expenses.isEmpty
              ? const NeuNotice(icon: Icons.receipt_long_rounded, message: 'No expenses logged yet.')
              : ReportDataTable(
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
        ),
      ],
    );
  }
}
