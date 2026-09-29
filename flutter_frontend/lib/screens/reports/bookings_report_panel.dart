import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/report.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'booking_register_rows.dart';
import 'report_widgets.dart';

/// The booking register: the same stat grid and data table the web
/// dashboard's Reports > Bookings tab shows — a horizontally scrollable
/// grid rather than the web's fixed-width one, since a phone has no room for
/// nineteen columns side by side. The column set and cell values are shared
/// with [BookingReportPdf]'s register (see booking_register_rows.dart), so
/// the screen and the downloaded PDF never disagree.
class BookingsReportPanel extends ConsumerWidget {
  const BookingsReportPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(reportsViewModelProvider).bookings;
    final analytics = ref.watch(reportsViewModelProvider).roomsAnalytics?.valueOrNull;

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
  final BookingsReport report;
  final RoomsAnalytics? analytics;

  const _Loaded({required this.report, this.analytics});

  static const _columnWidths = <double>[
    76, 68, 120, 52, 78, 62, 78, 62, 40, 76, 74, 78, 70, 70, 60, 78, 76, 76, 90,
  ];

  @override
  Widget build(BuildContext context) {
    final s = report.summary;
    final cancelled = s.statusCount('CANCELLED');
    final categoryRows = [
      for (final c in analytics?.occupancyByCategory ?? const <CategoryOccupancy>[])
        (c.categoryName, c.occupancyPercent),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (categoryRows.isNotEmpty) ...[
          ReportBarList(title: 'Occupancy by room category', rows: categoryRows),
          const SizedBox(height: AppTheme.s16),
        ],
        Text('This period at a glance', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: AppTheme.s8),
        StatGrid(
          items: [
            StatItem(label: 'Bookings', value: '${s.totalBookings}'),
            StatItem(label: 'Checked out', value: '${s.statusCount('CHECKED_OUT')}'),
            StatItem(label: 'Cancelled', value: '$cancelled'),
            StatItem(label: 'Room nights', value: '${s.roomNights}'),
            StatItem(label: 'Billed', value: formatPrice(s.billedAmount), accent: true),
            StatItem(label: 'Advance collected', value: formatPrice(s.advanceCollected)),
            StatItem(label: 'Total collected', value: formatPrice(s.totalCollected)),
            if (s.cancellationChargesKept > 0)
              StatItem(
                label: 'Cancellation charges',
                value: formatPrice(s.cancellationChargesKept),
              ),
          ],
        ),
        const SizedBox(height: AppTheme.s16),
        CollapsibleRegister(
          title: 'Register',
          child: report.bookings.isEmpty
              ? const NeuNotice(
                  icon: Icons.receipt_long_rounded,
                  message: 'No bookings arrived in this period.',
                )
              : ReportDataTable(
                  columns: [
                    for (var i = 0; i < kRegisterColumns.length; i++)
                      ReportTableColumn(
                        kRegisterColumns[i].label,
                        width: _columnWidths[i],
                        align: kRegisterColumns[i].rightAlign ? TextAlign.right : TextAlign.left,
                      ),
                  ],
                  rows: [for (final b in report.bookings) registerRow(b)],
                  totals: registerTotalsRow(s, s.bills),
                ),
        ),
      ],
    );
  }
}
