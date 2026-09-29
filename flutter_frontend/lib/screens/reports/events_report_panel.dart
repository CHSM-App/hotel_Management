import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/report.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'report_widgets.dart';

/// Events & functions register — mirrors the web's Reports > Events &
/// functions tab (the `activeTab === 'events'` block in ReportsPanel.jsx):
/// the period stat grid, then every function in the range.
class EventsReportPanel extends ConsumerWidget {
  const EventsReportPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(reportsViewModelProvider).events;
    final analytics = ref.watch(reportsViewModelProvider).analyticsOverview?.valueOrNull;

    return ListView(
      padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s4, AppTheme.s16, AppTheme.s32),
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        switch (async) {
          null || AsyncLoading() => const ReportLoading(),
          AsyncError(:final error) => ReportError(message: error.toString()),
          AsyncData(:final value) => _Loaded(report: value, analytics: analytics),
          _ => const SizedBox.shrink(),
        },
      ],
    );
  }
}

class _Loaded extends StatelessWidget {
  final EventsReport report;
  final AnalyticsOverview? analytics;

  const _Loaded({required this.report, this.analytics});

  @override
  Widget build(BuildContext context) {
    final s = report.summary;
    final venueRows = [
      for (final v in analytics?.venueUtilization ?? const <VenueUtilization>[]) (v.venueName, v.eventCount),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (venueRows.isNotEmpty) ...[
          ReportBarList(
            title: 'Venue utilisation',
            rows: venueRows,
            color: AppTheme.checkout,
            formatValue: (v) => '${v.round()} booking${v.round() == 1 ? '' : 's'}',
          ),
          const SizedBox(height: AppTheme.s16),
        ],
        StatGrid(
          items: [
            StatItem(label: 'Functions', value: '${s.totalEvents}'),
            StatItem(label: 'Settled', value: '${s.statusCount('SETTLED')}'),
            StatItem(label: 'Confirmed', value: '${s.statusCount('CONFIRMED')}'),
            StatItem(label: 'Cancelled', value: '${s.cancelled.count}'),
            StatItem(label: 'Total value', value: formatPrice(s.totals.totalAmount), accent: true),
            StatItem(label: 'Advance held', value: formatPrice(s.totals.advanceAmount)),
          ],
        ),
        const SizedBox(height: AppTheme.s16),
        CollapsibleRegister(
          title: 'Functions & events',
          child: report.events.isEmpty
              ? const NeuNotice(
                  icon: Icons.celebration_rounded,
                  message: 'No functions in this period.',
                )
              : ReportDataTable(
                  columns: const [
                    ReportTableColumn('Bill no.', width: 78),
                    ReportTableColumn('Function', width: 130),
                    ReportTableColumn('Organiser', width: 130),
                    ReportTableColumn('Venue', width: 100),
                    ReportTableColumn('Date', width: 90),
                    ReportTableColumn('Pax', width: 50, align: TextAlign.right),
                    ReportTableColumn('Status', width: 90),
                    ReportTableColumn('Advance', width: 84, align: TextAlign.right),
                    ReportTableColumn('Total', width: 90, align: TextAlign.right),
                    ReportTableColumn('Balance due', width: 90, align: TextAlign.right),
                  ],
                  rows: [for (final ev in report.events) _eventRow(ev)],
                  totals: [
                    'Total', '', '', '', '', '',
                    '${s.totalEvents}',
                    formatPrice(s.totals.advanceAmount),
                    formatPrice(s.totals.totalAmount),
                    formatPrice(s.totals.balanceDue),
                  ],
                ),
        ),
      ],
    );
  }

  List<String> _eventRow(ReportEventRow ev) => [
    ev.invoiceNumber ?? '—',
    ev.title,
    ev.organiserName ?? '—',
    ev.venueName ?? '—',
    formatIsoDate(_dateOnly(ev.startAt)),
    '${ev.pax}',
    kEventStatusLabel[ev.status] ?? ev.status,
    ev.advanceAmount > 0 ? formatPrice(ev.advanceAmount) : '—',
    formatPrice(ev.totalAmount),
    ev.balanceDue > 0 ? formatPrice(ev.balanceDue) : '—',
  ];

  static String _dateOnly(String iso) {
    if (iso.isEmpty) return iso;
    final parsed = DateTime.tryParse(iso);
    if (parsed == null) return iso;
    final local = parsed.toLocal();
    return '${local.year}-${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')}';
  }
}
