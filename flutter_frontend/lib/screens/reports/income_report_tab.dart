import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/income.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'report_widgets.dart';

/// Category donut slice colors, in assignment order — mirrors
/// IncomeReportPanel.jsx's CATEGORY_COLORS (brand, accent, then four more
/// fixed hues), reusing AppTheme's own tokens where one already fits.
const _kCategoryColors = <Color>[
  AppTheme.accent,
  AppTheme.draft,
  Color(0xFF2FA0A0),
  AppTheme.checkout,
  Color(0xFF7A5FD1),
  Color(0xFF3A8FC7),
];

/// Reports > Other Income — mirrors IncomeReportPanel.jsx's read-only view
/// over the full income history, filtered to [fromDate]/[toDate] — held by
/// [ReportsScreen] and shown in the same header spot as the server-ranged
/// tabs' picker, just filtering the already-loaded list instead of
/// triggering a refetch. There is no separate Income feature elsewhere in
/// this app yet (unlike Expenses/Assets), so this tab is also the first
/// place income entries show up on the Flutter side — read-only, same as
/// the web report it mirrors (opened with `onClose={null}`).
///
/// PDF/Excel export is IncomeReportPdf/IncomeReportExcel
/// (income_report_pdf.dart/income_report_excel.dart), wired up in
/// reports_screen.dart.
class IncomeReportTab extends ConsumerWidget {
  final String fromDate;
  final String toDate;

  const IncomeReportTab({super.key, required this.fromDate, required this.toDate});

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
          AsyncData(:final value) => _Loaded(
            income: [
              for (final e in value)
                if (e.incomeDate.compareTo(fromDate) >= 0 && e.incomeDate.compareTo(toDate) <= 0) e,
            ],
          ),
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
    final categoryEntries = byCategory.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
    final topCategory = categoryEntries.isEmpty ? null : categoryEntries.first;

    final byPayer = <String, (num amount, int count)>{};
    for (final e in income) {
      final payer = e.payerName;
      if (payer == null) continue;
      final entry = byPayer[payer] ?? (0, 0);
      byPayer[payer] = (entry.$1 + e.amount, entry.$2 + 1);
    }
    final payerEntries = byPayer.entries.toList()..sort((a, b) => b.value.$1.compareTo(a.value.$1));

    // Income by month for the current calendar year — same shape as
    // ExpensesReportTab's monthlyTotals, mirroring IncomeReportPanel.jsx's
    // own monthlyTrend.
    final year = DateTime.now().year;
    final monthlyTotals = List<num>.filled(12, 0);
    for (final e in income) {
      final d = DateTime.tryParse(e.incomeDate);
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
            StatItem(label: 'Total income', value: formatPrice(total), accent: true),
            StatItem(label: 'Received so far', value: formatPrice(received)),
            StatItem(label: 'Outstanding', value: formatPrice(total - received)),
            StatItem(label: 'Top category', value: topCategory?.key ?? '—'),
          ],
        ),
        if (income.isNotEmpty) ...[
          const SizedBox(height: AppTheme.s16),
          ReportTrendChart(
            title: 'Income by month, $year',
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
            title: "Where it's coming from",
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
        if (payerEntries.isNotEmpty) ...[
          const SizedBox(height: AppTheme.s16),
          ReportRankList(
            title: 'Top payers',
            rows: [
              for (final p in payerEntries.take(8))
                (p.key, '${p.value.$2} entr${p.value.$2 == 1 ? 'y' : 'ies'}', formatPrice(p.value.$1)),
            ],
          ),
        ],
        const SizedBox(height: AppTheme.s16),
        CollapsibleRegister(
          title: 'All income',
          child: income.isEmpty
              ? const NeuNotice(icon: Icons.savings_outlined, message: 'No income logged yet.')
              : ReportDataTable(
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
        ),
      ],
    );
  }
}
