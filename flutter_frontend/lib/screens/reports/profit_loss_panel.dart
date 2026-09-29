import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/report.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'report_widgets.dart';

/// Profit & Loss — mirrors the web's Reports > Profit & Loss tab: the
/// Screener-style multi-year history table first (the same one PL_HISTORY_ROWS
/// drives in ReportsPanel.jsx), then the single-period statement for the
/// screen's own date range.
///
/// PDF/Excel export is deliberately not built for this tab yet — it is the
/// newest and most complex report here, and getting the native statement and
/// history table right took priority; see the Reports task notes for the
/// follow-up.
class ProfitLossPanel extends ConsumerWidget {
  const ProfitLossPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(reportsViewModelProvider);
    final vm = ref.read(reportsViewModelProvider.notifier);

    return ListView(
      padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s4, AppTheme.s16, AppTheme.s32),
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        _GranularityBar(
          granularity: state.plGranularity,
          onChanged: vm.setPlGranularity,
        ),
        const SizedBox(height: AppTheme.s8),
        switch (state.plHistory) {
          null || AsyncLoading() => const ReportLoading(),
          AsyncError(:final error) => ReportError(message: error.toString()),
          AsyncData(:final value) => _HistoryTable(history: value),
          _ => const SizedBox.shrink(),
        },
        const SizedBox(height: AppTheme.s24),
        Text('This period', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: AppTheme.s8),
        switch (state.profitLoss) {
          null || AsyncLoading() => const ReportLoading(),
          AsyncError(:final error) => ReportError(message: error.toString()),
          AsyncData(:final value) => _PeriodStatement(report: value),
          _ => const SizedBox.shrink(),
        },
      ],
    );
  }
}

class _GranularityBar extends StatelessWidget {
  final String granularity;
  final ValueChanged<String> onChanged;

  const _GranularityBar({required this.granularity, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    Widget chip(String key, String label) {
      final selected = granularity == key;
      return Expanded(
        child: GestureDetector(
          onTap: () => onChanged(key),
          child: selected
              ? NeuPressed(
                  radius: AppTheme.rMedium,
                  padding: const EdgeInsets.symmetric(vertical: AppTheme.s8),
                  child: Center(
                    child: Text(label, style: const TextStyle(color: AppTheme.accent, fontWeight: FontWeight.w600)),
                  ),
                )
              : NeuCard(
                  radius: AppTheme.rMedium,
                  shadow: AppTheme.subtle,
                  padding: const EdgeInsets.symmetric(vertical: AppTheme.s8),
                  child: Center(child: Text(label)),
                ),
        ),
      );
    }

    return Row(
      children: [
        chip('year', 'Yearly'),
        const SizedBox(width: AppTheme.s8),
        chip('month', 'Monthly'),
      ],
    );
  }
}

class _HistoryTable extends StatelessWidget {
  final ProfitLossHistory history;

  const _HistoryTable({required this.history});

  @override
  Widget build(BuildContext context) {
    if (history.columns.isEmpty) {
      return const NeuNotice(
        icon: Icons.insert_chart_outlined_rounded,
        message: 'Not enough billed history yet to build a Profit & Loss statement.',
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Profit & Loss — multi-period', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: AppTheme.s8),
        ReportDataTable(
          columns: [
            const ReportTableColumn('Particulars', width: 150),
            for (final c in history.columns) ReportTableColumn(c.label, width: 90, align: TextAlign.right),
          ],
          rows: [
            for (final row in kPlHistoryRows)
              [
                row.label,
                for (final c in history.columns) _cell(row, c),
              ],
          ],
        ),
        const SizedBox(height: AppTheme.s8),
        Text(
          'Financial years run April to March. TTM covers the trailing 12 months.',
          style: Theme.of(context).textTheme.labelSmall,
        ),
      ],
    );
  }

  String _cell(PLHistoryRowSpec row, ProfitLossHistoryColumn column) {
    final raw = row.value(column);
    if (raw == null) return '—';
    if (row.kind == PLHistoryRowKind.percent) return '${raw.toStringAsFixed(2)}%';
    return formatPrice(raw);
  }
}

class _PeriodStatement extends StatelessWidget {
  final ProfitLossReport report;

  const _PeriodStatement({required this.report});

  @override
  Widget build(BuildContext context) {
    final netLoss = report.netProfit < 0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        StatGrid(
          items: [
            StatItem(label: 'Revenue', value: formatPrice(report.revenue.totalRevenue)),
            StatItem(label: 'Expenses', value: formatPrice(report.expenses.totalExpenses)),
            StatItem(label: 'Depreciation', value: formatPrice(report.depreciation.totalDepreciation)),
            StatItem(
              label: netLoss ? 'Net loss' : 'Net profit',
              value: formatPrice(report.netProfit.abs()),
              accent: true,
            ),
          ],
        ),
        const SizedBox(height: AppTheme.s16),
        Text('Revenue by stream', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: AppTheme.s8),
        ReportDataTable(
          columns: const [
            ReportTableColumn('Stream', width: 140),
            ReportTableColumn('Amount', width: 110, align: TextAlign.right),
          ],
          rows: [
            ['Rooms', formatPrice(report.revenue.roomRevenue)],
            ['Functions', formatPrice(report.revenue.functionRevenue)],
            ['Food', formatPrice(report.revenue.foodRevenue)],
          ],
        ),
        const SizedBox(height: AppTheme.s16),
        Text('Expenses by category', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: AppTheme.s8),
        if (report.expenses.byCategory.isEmpty)
          const NeuNotice(icon: Icons.receipt_long_rounded, message: 'No expenses logged in this period.')
        else
          ReportDataTable(
            columns: const [
              ReportTableColumn('Category', width: 160),
              ReportTableColumn('Amount', width: 110, align: TextAlign.right),
            ],
            rows: [
              for (final c in report.expenses.byCategory) [c.categoryName, formatPrice(c.amount)],
            ],
          ),
        const SizedBox(height: AppTheme.s16),
        Text('Depreciation — asset book values', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: AppTheme.s8),
        if (report.depreciation.skipped.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: AppTheme.s8),
            child: NeuNotice(
              icon: Icons.info_outline_rounded,
              message:
                  '${report.depreciation.skipped.length} asset${report.depreciation.skipped.length == 1 ? '' : 's'} '
                  'not depreciated: ${report.depreciation.skipped.map((s) => '${s.name} (${s.reason})').join(', ')}',
            ),
          ),
        if (report.depreciation.byAsset.isEmpty)
          const NeuNotice(
            icon: Icons.inventory_2_outlined,
            message: 'No assets have a purchase cost, date, and category depreciation rate set.',
          )
        else
          ReportDataTable(
            columns: const [
              ReportTableColumn('Asset', width: 140),
              ReportTableColumn('Category', width: 110),
              ReportTableColumn('Depreciation', width: 100, align: TextAlign.right),
              ReportTableColumn('Book value', width: 100, align: TextAlign.right),
            ],
            rows: [
              for (final a in report.depreciation.byAsset)
                [a.name, a.categoryName, formatPrice(a.periodDepreciation), formatPrice(a.bookValue)],
            ],
          ),
      ],
    );
  }
}
